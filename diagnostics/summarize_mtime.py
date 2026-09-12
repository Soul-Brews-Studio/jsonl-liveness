"""Verify a captured report contains an unchanged-content, hourly mtime change."""
import json
from pathlib import Path
import sys

records = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()]
proofs = [r for r in records if r.get('phase') == 'change'
          and r.get('mtime_changed') and r.get('same_inode')
          and isinstance(r.get('sha256_before'), str)
          and r.get('sha256_before') == r.get('sha256_after')
          and r.get('size_before') == r.get('size_after')
          and abs((r['mtime_after_ns']-r['mtime_before_ns'])/1e9-3600) < 5]
if not proofs:
    raise SystemExit('NOT PROVEN: no unchanged-content hourly touch in this capture; observe longer')
for record in proofs:
    print('PROVEN: hourly mtime change with identical whole-file SHA-256')
    print('interval_seconds:', (record['mtime_after_ns']-record['mtime_before_ns'])/1e9)
    print('size_before:', record['size_before'])
    print('size_after:', record['size_after'])
    print('same_inode:', record['same_inode'])
    print('same_sha256:', record['sha256_before'] == record['sha256_after'])
print('PID attribution: not captured; correlate with installed-code evidence separately')
