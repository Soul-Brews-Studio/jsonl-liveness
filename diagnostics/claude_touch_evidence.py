"""Inspect locally installed Claude binary without executing or changing it."""
import argparse
import json
import mmap
from pathlib import Path
import re


def inspect(path):
    with path.open('rb') as stream:
        with mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
            export = re.search(rb'([\w$]+) as touchSessionTranscript', data)
            if not export:
                raise ValueError('touchSessionTranscript export not found; binary format/version differs')
            symbol = export[1]
            start = data.find(b'function '+symbol+b'(')
            if start < 0:
                raise ValueError('function body unavailable')
            body = data[start:start+650]
            schedule = re.search(rb'setInterval\('+re.escape(symbol)+rb',([\w$]+),', data)
            if not schedule:
                raise ValueError('periodic call unavailable')
            interval_name = schedule[1]
            # Restrict to the immediately preceding housekeeping block, not unrelated scopes.
            scope = data[max(0,schedule.start()-12000):schedule.start()]
            assignments = list(re.finditer(rb'\b'+re.escape(interval_name)+rb'=(\d+)\b', scope))
            if not assignments:
                raise ValueError('interval constant unavailable')
            interval = int(assignments[-1][1])
            aliases = re.findall(rb'utimes as ([\w$]+)', data)
            uses_utimes = any(alias+b'(' in body for alias in aliases)
            return {'binary_version': path.name, 'touch_export': symbol.decode(),
                    'uses_current_session_file': b'.sessionFile' in body,
                    'uses_current_date': b'new Date' in body,
                    'calls_fs_utimes': uses_utimes,
                    'scheduled_interval_ms': interval,
                    'hourly_touch_code_confirmed': uses_utimes and interval == 3600000,
                    'scope': 'static installed-code evidence; not syscall PID attribution'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, default=Path.home()/'.local/bin/claude')
    args = parser.parse_args()
    result = inspect(args.binary.resolve(strict=True))
    print(json.dumps(result, indent=2))
    if not result['hourly_touch_code_confirmed']:
        raise SystemExit(1)
