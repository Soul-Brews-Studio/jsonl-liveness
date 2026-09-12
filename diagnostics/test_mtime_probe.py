import os
from pathlib import Path
import tempfile
import unittest
from mtime_probe import capture, compare
from claude_touch_evidence import inspect


class ProbeTests(unittest.TestCase):
    def test_default_does_not_open_file_or_hash(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(prefix='jsonl-mtime-fixture-') as folder:
            path = Path(folder)/'fixture.jsonl'
            path.write_bytes(b'{}\n')
            with patch('mtime_probe.os.open', side_effect=AssertionError('content opened')), \
                 patch('mtime_probe.hashlib.sha256', side_effect=AssertionError('hash computed')):
                before = capture(path)
                after = capture(path)
            self.assertIsNone(before['sha256'])
            self.assertEqual(compare(before, after)['classification'], 'content-unchecked')
            self.assertIsNone(compare(before, after)['same_sha256'])

    def test_timestamp_only_then_append(self):
        with tempfile.TemporaryDirectory(prefix='jsonl-mtime-fixture-') as folder:
            path = Path(folder)/'fixture.jsonl'
            path.write_bytes(b'{"type":"assistant","timestamp":"2026-09-01T00:00:00Z","text":"PRIVATE"}\n')
            before = capture(path, True)
            os.utime(path, ns=(path.stat().st_atime_ns, before['revision'][0]+1_000_000_000))
            touched = capture(path, True)
            result = compare(before, touched)
            self.assertEqual(result['classification'], 'metadata-only')
            self.assertTrue(result['mtime_changed'])
            self.assertTrue(result['same_sha256'])
            self.assertNotIn('PRIVATE', str(result))
            with path.open('ab') as stream:
                stream.write(b'{"type":"user","timestamp":"2026-09-02T00:00:00Z"}\n{"type":"partial"')
            changed = compare(touched, capture(path, True))
            self.assertEqual(changed['classification'], 'content-changed')
            self.assertEqual(changed['last_complete_events'][-1]['type'], 'user')

    def test_installed_code_probe_on_synthetic_binary(self):
        with tempfile.TemporaryDirectory(prefix='jsonl-code-fixture-') as folder:
            path = Path(folder)/'test-version'
            path.write_bytes(b'utimes as clock; function touch(e){let n=state.sessionFile; helper(n,e)}'
                             b'function helper(n,e){let r=new Date;clock(n,r,r)}'
                             b'var interval=3600000;setInterval(touch,interval,e);'
                             b'export{touch as touchSessionTranscript}')
            self.assertTrue(inspect(path)['hourly_touch_code_confirmed'])
            path.write_bytes(path.read_bytes().replace(b'3600000', b'60000'))
            self.assertFalse(inspect(path)['hourly_touch_code_confirmed'])
            path.write_bytes(b'unsupported executable format')
            with self.assertRaises(ValueError):
                inspect(path)

    def test_capture_does_not_write_and_refuses_symlink(self):
        with tempfile.TemporaryDirectory(prefix='jsonl-mtime-fixture-') as folder:
            path = Path(folder)/'fixture.jsonl'
            path.write_bytes(b'{}\n')
            before = path.stat()
            capture(path, True)
            after = path.stat()
            self.assertEqual((before.st_mtime_ns,before.st_ctime_ns,before.st_size),
                             (after.st_mtime_ns,after.st_ctime_ns,after.st_size))
            link = Path(folder)/'link.jsonl'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                capture(link, True)


if __name__ == '__main__':
    unittest.main()
