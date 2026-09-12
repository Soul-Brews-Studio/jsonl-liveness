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

## Message-vs-touch semantics — September 12

Web/TUI sort by recorded text-message time. File classes still describe mtime;
open status requires explicit Claude PID/session-ID argument evidence, otherwise
unknown. Routine polling is every 2 seconds with no hashing. PID checks cache 10s.

Fresh checks:

```text
39 pass
0 fail
278 expect() calls
Ran 39 tests across 11 files.
3892 files, 2 hot
```

Local/remote PTY smoke, React DOM/HTTP smoke, strict TypeScript and production
build passed. The DOM smoke verifies touch-only updates preserve row order,
complete appends reorder rows, partial records stay hidden and no automatic hash
requests occur. Synthetic presence tests reject shell, fork and conflicting-ID
false matches. Unknown is never interpreted as closed.

Real cold scan: 3892 files, 1608 ms, 3892 message-tail reads. Immediately repeated
unchanged scan: 79 ms, zero message-tail reads, zero last-line reads. This is one
observed run, not a performance guarantee. No process args matched IDs in that
run, so presence was correctly unknown for every row.

Browser DOM verified the new headers and timestamps, with no page overflow at
480 CSS pixels. Screenshot capture timed out twice; full desktop/mobile visual
certification is therefore not claimed. No screenshot was fabricated. Existing
unrelated theme edits were preserved.

## Inline timeline and append UX — September 12

Added `timeline.ts`, `web/timeline-model.ts`, and reusable `Timeline.tsx`; integrated
`GET /api/timeline` into the existing authenticated service. The Timeline route is
`?view=timeline&limit=20` (20/50/100 choices, default 50). No popup or side panel.
The final user preference puts new arrivals at the top by default; the direction
selector also supports bottom appends. Odd/even theme-token zebra rows improve tracking. Refresh clears the local feed and reloads the latest
bounded batch. Cross-grid cell borders replace the full-table nested scroll box. The latest
user revision adds fixed 18rem event reading areas with individual scrollbars
for long text; scrolling within a row disables follow. New arrivals highlight briefly, respecting Reduce Motion.

Safety/performance: max 50 files, 64 KiB tail each, API ceiling 200 events,
3,000 characters per event; existing decoder record/block limits also apply.
Auth/origin/root checks remain in place. Normal polling does not hash anything.
Unchanged stat revisions reuse parsed events; timestamps are recorded event time,
not file mtime. Partial records remain hidden until newline-terminated.

Browser DOM/computed-layout evidence against synthetic fixtures:

```text
1440 px desktop: 20-event limit selected, bottom direction, 0 nested scrollers,
1 px cell gridlines, document height 1610 / viewport height 1000, no dialog.
Top direction: latest synthetic three-line message first, scrollY 0.
390 px mobile: document width 390, table width 358, 0 nested scrollers;
cells stack in a grid, no horizontal page overflow.
New append: data-new=true on arriving row, three inline text lines.
Reduce Motion enabled: animation-name none.
```

Earlier screenshot attempts returned `Page.captureScreenshot` timeout and
`Unable to capture screenshot`; layout was checked through live computed DOM
instead. No new screenshot is claimed or fabricated. The user's screenshot also
confirmed the preceding full-width Paper timeline before the append/grid revision.

Real-machine cached API check: 200 events / 50 files / 3,918 in scope; repeated
requests reported zero tail reads and zero read errors (24 ms then 5 ms).
These are individual observed responses, not a performance guarantee.

The single-scroll geometry receipt above precedes the user's final fixed-row
revision: the full table still has no nested scroll container, but individual
long event cells intentionally scroll now. Transcript text remains bounded.

### Final fixed-row and home animation receipt

Live synthetic desktop inspection after the fixed-row change:

```text
width: 1440; direction: top; limit: 20
first five row heights: [321, 321, 321, 321, 321] px
zebra colors: rgb(255, 250, 240) / rgb(238, 228, 209)
event viewport: 264 px; available text: 1200 px; overflow-y: auto
follow after scrolling inside event: false
```

The home table now uses the same new-message arrival cue. It stays ordered by
recorded message time, and only changed message text/role/time triggers the cue;
mtime-only touches and alias edits do not. Highlights and the New badge fade in
and back out over 1.5 seconds, without fading away the actual transcript text.
Reduced Motion disables the animation; a static cue remains briefly.

Both DOM/HTTP smokes cover newest-first navigation, real automatic append,
partial records, unchanged/touch-only updates, no automatic hash requests,
per-event reading/follow-off, limits, Refresh reset, errors and recovery. The
home smoke additionally checks that a touch does not flash a row but a new
message moves to the top and gets the cue. Strict TypeScript, production build,
PTY checks and `git diff --check` passed. No new dependencies were installed.

Final charter command (from the lab directory):

```sh
cd app && bun test && bun run . --once --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["files"]), "files,", sum(1 for f in d["files"] if f["class"]=="hot"), "hot")'
```

```text
49 pass
0 fail
363 expect() calls
Ran 49 tests across 12 files. [3.57s]
4092 files, 44 hot
```

A final Timeline smoke rerun exposed a harness race: its injected delayed
Refresh clicked while the previous automatic feed could still disable that
button. The test now pauses polling and waits for idle before injecting the
manual-response delay; production refresh semantics were not bypassed.

After synchronization, the Timeline DOM/HTTP smoke passed three consecutive runs; each reported zero fingerprint requests. The home DOM/HTTP smoke also passed.

## Timeline checkbox filters — September 12

Timeline now filters the already-loaded bounded feed without a new transcript
read or hash. It starts with every checkbox enabled, and each choice composes
with the others:

- **Show events:** `Human` (`user` text), `AI output` (assistant/agent text),
  and `Tools & other` (tool input/result plus system/workflow metadata).
- **Show sources:** `Main sessions` (`session`) and `Subagents & workflows`
  (`subagent`, `workflow-agent`, and `workflow-journal`).

The synthetic DOM/HTTP smoke creates a real `subagents/agent-sub111.jsonl`
fixture and verifies multi-checkbox combinations, an intentionally empty
selection, complete restoration, and that checkbox changes issue **zero**
timeline requests. It retains exact project filtering, partial-record holdback,
append animation, natural-height inline reading, Refresh reset, and no automatic hash reads.

## Shared route shell — September 12

Timeline retains the app's centered `max-width: 1800px` shell instead of opting
out to a viewport-wide layout. It still uses normal document scrolling for a
long event stream. Ego Browser checked Timeline → Table → live-session dialog
on the local server: each route had the same 896px inner workspace at a 960px
viewport, no horizontal overflow, and a computed `max-width` of `1800px`.
