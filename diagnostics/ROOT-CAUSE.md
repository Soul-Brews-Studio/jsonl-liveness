# Root cause: hourly transcript timestamp touch

Verified locally on 2026-09-12 (Asia/Bangkok). No production transcripts were
written, touched, renamed, or deleted by this investigation. No services stopped.

## Finding

Claude Code's installed housekeeping code invokes `touchSessionTranscript` on a
3,600,000 ms interval. Its implementation takes the current session file and uses
`fs.utimes` with the current date (or a store `touch` path). This makes an idle
transcript's **mtime recent without new conversation content**. File-mtime-based
Hot/Warm is therefore not evidence of recent messages or active generation.

Static checks succeeded for installed versions 2.1.259, 2.1.263, and 2.1.269.
The running Claude process associated with the observed project's working
directory uses 2.1.259. This is correlation, not direct syscall PID attribution.

## Actual live proof

A 120-second read-only observation captured 24 changes: 23 content-changing
updates and one unchanged-content update. A new file baseline was also discovered.
Hashing occurred once per baseline and again only after stat changes (50 reads).

```text
PROVEN: hourly mtime change with identical whole-file SHA-256
interval_seconds: 3600.004
size_before: 75616990
size_after: 75616990
same_inode: True
same_sha256: True
PID attribution: not captured; correlate with installed-code evidence separately
```

The identical whole-file hash rules out a net transcript-content change between
these two observations. It cannot rule out an intervening rewrite of identical
bytes. The hourly interval and installed `utimes` code together strongly identify
Claude's housekeeping touch as the cause of this observed freshness false signal.
Do not generalize it to every update: real metadata/message appends were also seen.

## Reproduce

From the lab's `app/` directory:

```sh
just prove-mtime
just prove-claude-touch
just observe-mtime-hash 120 > .local/mtime-proof.txt
just verify-mtime-report
```

`prove-mtime` now runs 4 fixture tests, all passing: timestamp-only vs append,
partial-line holdback, read-only capture, symlink refusal, installed-code
probe positive/negative cases, and default-mode no-content-read/no-hash checks. Fixture writes occur only in temporary directories.

A short live capture may miss the hourly boundary. The verifier exits nonzero if
proof is absent; increase observation duration (e.g. 3700 seconds), rather than
claiming no writes exist. `.local/mtime-proof.txt` is ignored and local-only.
The probe stores no transcript bodies in its output; file paths are pseudonymized.
It reads entire files once for baseline hashes, then hashes only on stat changes.
This is an explicit diagnostic, not a new full-file polling behavior in the app.

`prove-claude-touch` reads the installed executable, without running Claude or
using the network. Minified symbol names may change between releases, and this
check deliberately fails when its evidence is unavailable.

## Attribution limit

`sudo -n fs_usage` returned `sudo: a password is required`. Sampled open-file
handles did not identify a writable descriptor. Thus no kernel-level writer PID
was captured. No admin credentials were requested or bypassed. The conclusion
combines live unchanged-content evidence with the matching installed code.

## Scope

No UI or classification changes made here. Existing unrelated worktree edits
were left untouched. Keep file freshness distinct from recorded message time in
any subsequent UI change; this diagnostic is evidence, not a repair.

## Low-CPU default (updated after proof)

```sh
just observe-mtime 120
```

Default observation uses only stat metadata every 2 seconds. It does not read
transcript content or calculate hashes, even for file identifiers. It reports
`content-unchecked`, never guesses that unchanged size means unchanged content.
`observe-mtime-hash` / `--hash` is an explicit forensic opt-in, not routine polling.
A fresh 3-second default run observed 26 files with `hash_reads: 0`.

Before this default was changed, a second independent 120-second hash capture
confirmed another hourly unchanged-content touch: interval **3600.001 seconds**,
size **6,147,358 bytes** before/after, same inode and same SHA-256. The capture
completed; no diagnostic monitor remains running from that command.
