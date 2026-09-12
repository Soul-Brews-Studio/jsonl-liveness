# Verification — 2026-09-11

## BEFORE

Preserve the table; add a live popup, readable tools, equal-height desktop panels,
1-second updates, recent-message previews and time-first/on-demand hash checks.
Keep real transcripts read-only and publish only the standalone app.

## STUCK → repaired (actual failures)

- Regression initially failed: `Expected to contain: open=""` — latest tool was
  collapsed. Default expansion plus natural-flow output now passes.
- Browser screenshot capture cropped the page at zoom. Same-page CDP viewport
  capture fixed the evidence; synthetic screenshots were inspected.
- Browser refresh reported `The selected host did not return a JSONL snapshot`
  against an older backend without revision tokens. Optional-token compatibility
  now has a regression test. Old fingerprints without revision proof are not
  presented as current verified revisions.
- Strict TypeScript caught required revision fields missing in legacy fixtures.
  The optional wire field repairs compatibility; new scans always emit it.
- Review caught the inert modal blocking Home, invalid body focus restoration,
  and caches disagreeing about same-size/restored-mtime rewrites. Home is inside
  the dialog, focus has an explicit fallback, and shared stat revisions now cover
  scanner/preview/detail/hash staleness without per-poll hashes.

## DONE / evidence

- **28 Bun tests, 219 assertions, 0 failures**.
- React DOM + two real HTTP fixture servers: **PASS** — popup/Esc/Home/Back/Forward,
  refresh and memory-only token reconnect, aliases, live appends, newest-first,
  no nested tool-output clipping, stable disclosures/reading position, bounded
  rereads, explicit hash requests, timing, themes, host switching, safe text.
- `python3 tui-smoke.py`: **PASS** including failure cleanup and unchanged transcript.
- `python3 remote-smoke.py`: **PASS**, authenticated cross-client name round trip.
- `bun run build:web`: **PASS**, Tailwind + production React bundle ~214 KB.
- Strict TypeScript and unused-local/parameter checks: **PASS** with existing
  cached Bun/Node declaration roots. No separate lint configuration exists.
- `git diff --check`: **PASS**.
- Ego Browser: synthetic tutorial observed and captured. Equal-height desktop
  panels measured **354.5px each**, page/viewport **720px**, sidebar starts at top.
  Expanded tool output used normal flow, before controls with no overlap.
  A real append appeared automatically; naming, hash check, both themes, Home,
  Esc, browser Back/Forward and reload were observed. Task space finished.
- Real backend: 3,890 files, zero read errors; normal refreshes reuse unchanged
  tails. No transcript content or real session identifiers are published.

## Original charter Verify (run from worktree root)

```sh
cd ψ/lab/01-jsonl-liveness/app && bun test && bun run . --once --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["files"]), "files,", sum(1 for f in d["files"] if f["class"]=="hot"), "hot")'
```

Actual output:

```text
bun test v1.3.14 (0d9b296a)

server.test.ts:
(pass) host routing normalizes HTTP/HTTPS, rejects credentials and non-origin URLs [1.00ms]
(pass) real HTTP snapshots and aliases preserve transcript and remain after restart [43.15ms]
(pass) backend enforces origin, token, content type and non-loopback binding [18.12ms]
(pass) SSE sends initial snapshot and later name changes [20.02ms]
(pass) serializes concurrent name writes and isolates failing subscribers [18.77ms]
(pass) serves the browser bundle and rejects a shell without its JavaScript [17.99ms]

names.test.ts:
(pass) names persist independently without changing the transcript; empty clears [2.29ms]
(pass) ID matching rejects collisions, supports exact path and Unicode names [0.37ms]
(pass) TUI keeps ID visible alongside alias, filters and bounds rows [2.35ms]

details.test.ts:
(pass) details expose text and tools, never partial records or thinking [2.13ms]
(pass) detail tail is bounded, omits leading fragments and reports malformed records [2.04ms]
(pass) authenticated detail API rejects unknown paths and symlink escape [16.98ms]
(pass) session timing uses recorded timestamps and file mtime, not turn completion or inactivity [1.82ms]
(pass) start time reads a bounded head, leaves unknown timestamps unknown [2.07ms]
(pass) event identities survive larger windows; workflow results are not session ends [0.99ms]
(pass) visible-row preview finds text behind system events, caches and invalidates on writes [23.97ms]

liveness.test.ts:
(pass) all path tiers [0.06ms]
(pass) exact class boundaries [0.06ms]
(pass) holds back partial lines, including long suffixes and split UTF-8 [2.50ms]
(pass) fixture turns hot when touched and reports tail metadata [1.34ms]

fingerprint.test.ts:
(pass) stat-only refresh reuses tails; SHA-256 is computed only on demand and cached by revision [9.81ms]
(pass) hash endpoint requires auth, validates scan membership and rejects root escape [17.59ms]

display.test.ts:
(pass) human-readable project, size and age [0.08ms]
(pass) display identifies agents beyond the agent- prefix and bounds watch rows [0.52ms]

web.test.ts:
(pass) both theme palettes keep text and accent controls legible [0.83ms]
(pass) components can render independently and escape transcript content [4.97ms]
(pass) popup tools can default open without nested output clipping [0.44ms]
(pass) host client accepts older snapshots and validates optional revision tokens [0.12ms]

 28 pass
 0 fail
 219 expect() calls
Ran 28 tests across 7 files. [255.00ms]
3890 files, 0 hot
```

## Remaining limits

Mobile pixel layout and browser local-network permission dialogs were not certified.
Live means complete-message polling, not per-token streaming; scan/client cycles
can add latency. Start/end are bounded evidence, not guessed process state.
No database is implemented. Full-file hashing remains explicit and can be slow
for large files. Tutorial images contain synthetic fixtures only.

## September 12 checkpoint

Added terminal live details, Paper theme, and separate file/message/event time labels.

Charter verification (`bun test && bun run . --once --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["files"]), "files,", sum(1 for f in d["files"] if f["class"]=="hot"), "hot")'`):

```text
29 pass
0 fail
245 expect() calls
Ran 29 tests across 8 files.
3890 files, 0 hot
```

Local and authenticated-remote PTY smoke tests passed, including Enter/back, live
append, partial-record holdback, Paper colors, naming, and terminal restoration.
React DOM/HTTP smoke and strict TypeScript checks passed. Paper persistence and
light colors were also verified in the browser using synthetic data.
