# Diagnostic proof uses synthetic temporary fixtures only.
prove-mtime:
    PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s diagnostics -p 'test_mtime_probe.py' -v

# Low-CPU default: stat only, no content reads or hashes.
# Output contains per-run file numbers and stat metadata, not chat bodies.
observe-mtime seconds="120":
    python3 diagnostics/mtime_probe.py --seconds {{seconds}}

# Inspect installed Claude code; no Claude execution, no network, no transcript writes.
prove-claude-touch:
    python3 diagnostics/claude_touch_evidence.py

# Fails honestly if the capture did not witness a matching unchanged-content touch.
verify-mtime-report report=".local/mtime-proof.txt":
    python3 diagnostics/summarize_mtime.py {{quote(report)}}

# Explicit forensic opt-in only; full-file hashes once then on stat changes.
observe-mtime-hash seconds="120":
    python3 diagnostics/mtime_probe.py --hash --seconds {{seconds}}
