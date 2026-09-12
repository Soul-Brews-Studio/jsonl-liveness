"""Read-only stat-first probe. Reports metadata/hashes, never transcript bodies."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time


def revision(s):
    return (s.st_mtime_ns, s.st_ctime_ns, s.st_size, s.st_ino)


def capture(path, with_hash=False):
    if not with_hash:
        info = path.lstat()
        import stat
        if not stat.S_ISREG(info.st_mode):
            raise OSError("not a regular file")
        return {"revision": revision(info), "sha256": None, "events": []}
    # Never follow a substituted symlink. Compare before/after to reject torn reads.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        digest = hashlib.sha256()
        tail = b''
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            tail = (tail + chunk)[-65536:]
        after = os.fstat(stream.fileno())
    if revision(before) != revision(after) or revision(after) != revision(path.stat()):
        raise RuntimeError('file changed during capture; retry next poll')
    events = []
    # Exclude both a possibly truncated leading record and unfinished suffix.
    lines = tail.split(b'\n')[:-1]
    if after.st_size > len(tail):
        lines = lines[1:]
    for line in lines:
        try:
            value = json.loads(line)
            if not isinstance(value, dict):
                continue
            events.append({key: value.get(key) if isinstance(value.get(key), str) else None
                           for key in ('type', 'subtype', 'timestamp')})
        except (ValueError, UnicodeDecodeError):
            continue
    return {'revision': revision(after), 'sha256': digest.hexdigest(), 'events': events[-3:]}


def compare(before, after):
    same_hash = (before['sha256'] == after['sha256']
                 if before['sha256'] is not None and after['sha256'] is not None else None)
    return {'classification': ('content-unchecked' if same_hash is None else
                               'metadata-only' if same_hash else 'content-changed'),
            'mtime_changed': before['revision'][0] != after['revision'][0],
            'same_sha256': same_hash, 'same_inode': before['revision'][3] == after['revision'][3],
            'size_before': before['revision'][2], 'size_after': after['revision'][2],
            'mtime_before_ns': before['revision'][0], 'mtime_after_ns': after['revision'][0],
            'sha256_before': before['sha256'], 'sha256_after': after['sha256'],
            'last_complete_events': after['events']}


def observe(root, seconds, interval, recent, with_hash=False):
    states = {}
    identities = {}
    hashes = changes = 0
    def emit(value):
        print(json.dumps(value, ensure_ascii=True), flush=True)
    def discover():
        for path in root.rglob('*.jsonl'):
            try:
                if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
                    continue
                if path not in states and time.time() - path.stat().st_mtime <= recent:
                    yield path
            except OSError:
                continue
    for path in discover():
        try:
            states[path] = capture(path, with_hash)
            identities[path] = f"file-{len(identities)+1}"
            hashes += int(with_hash)
        except (OSError, RuntimeError):
            pass
    emit({'phase': 'baseline', 'files': len(states), 'hash_reads': hashes,
          'seconds': seconds, 'mode': 'hash-opt-in' if with_hash else 'stat-only', 'writer_pid': 'not attributed'})
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        for path in list(states) + list(discover()):
            if path not in identities:
                identities[path] = f'file-{len(identities)+1}'
            identity = identities[path]
            try:
                old = states.get(path)
                if old and revision(path.stat()) == old['revision']:
                    continue
                new = capture(path, with_hash)
                hashes += int(with_hash)
                if old:
                    changes += 1
                    emit({'phase': 'change', 'file_key': identity, **compare(old, new)})
                else:
                    emit({'phase': 'new-baseline', 'file_key': identity})
                states[path] = new
            except (OSError, RuntimeError) as error:
                emit({'phase': 'capture-unavailable', 'file_key': identity,
                      'reason': type(error).__name__})
        time.sleep(min(interval, max(0, end-time.monotonic())))
    emit({'phase': 'summary', 'changes': changes, 'hash_reads': hashes,
          'writer_pid': 'not attributed', 'no_change_does_not_rule_out_periodic_writes': True})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.home()/'.claude/projects')
    parser.add_argument('--seconds', type=float, default=120)
    parser.add_argument('--interval', type=float, default=2)
    parser.add_argument('--recent', type=float, default=7200)
    parser.add_argument('--hash', action='store_true', help='Explicit full-file SHA-256 proof; off by default')
    args = parser.parse_args()
    if args.seconds < 0 or args.interval <= 0 or args.recent <= 0:
        parser.error('seconds must be nonnegative; interval/recent must be positive')
    root = args.root.resolve(strict=True)
    if not root.is_dir():
        parser.error('root must be a directory')
    observe(root, args.seconds, args.interval, args.recent, args.hash)
