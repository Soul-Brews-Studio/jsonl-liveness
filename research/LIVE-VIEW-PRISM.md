# Live conversation review — 2026-09-11

Scope: our JSONL web client, preserving the host-selected backend and read-only
transcripts. User reference: `http://127.0.0.1:5173/`, inspected through local HTTP,
`maw peek idea-11sep-fri2026-cc-chat-ui --lines 120`, and the reference project's
existing `.impeccable/review/tool-panel-desktop.png`. No control of the user's
browser was taken. This is an implementation review, not a visual-test claim.

## 🔍 Lens 1: Archaeologist — What actually happened?

| Evidence | Finding |
|---|---|
| User's two live screenshots | List and alias sidebar work, but only metadata is visible. |
| `app/web/index.html` before this change | A wide data table relegates session content to a narrow sidebar. |
| Reference screenshot | Sessions navigate into a broad conversation with readable command/output disclosures. |
| `app/liveness.ts` | List scanning reads only the final complete record and cannot provide conversation history. |

## 🐛 Lens 2: Bug Hunter — What can fail?

| Risk | Required guard |
|---|---|
| Delayed details arrive after switching session/host | Abort + captured generation, path and request identity. |
| A writer is midway through a line | Hold back all uncommitted suffix bytes. |
| Polling replaces open tools or moves reading position | Preserve disclosures; follow only when enabled and already near the end. |
| Unknown timestamps look definitive | Mark unavailable; show time provenance; never equate an old mtime/end-turn with session end. |
| Transcript content becomes HTML | Use textContent, no execution or remote resource loading. |

## 💀 Lens 3: Skeptic — What should we redo?

The metadata-first sidebar solves file inspection, not the user's live-reading
need. Calling every fresh file "working" or every assistant stop "completed"
would be misleading. A chat-shaped interface must not imply it can send messages:
this app remains read-only. Bounded history is a deliberate limitation, not a
complete transcript or token-by-token stream.

## 🏗️ Lens 4: Architect — What changes structurally?

| Before | After |
|---|---|
| Table dominates, metadata sidebar | Live mode: compact roster + full-width conversation; Table mode retained. |
| Last complete type/role only | Selected-session-only 256 KiB tail, optionally 1 MiB, at most 100 records/events. |
| Age only | Visible start (first recorded head timestamp), explicit end if present, file last update. |
| Metadata polling | Shared snapshot polling detects changes; only the selected changed transcript is reread. |

A small bounded head (64 KiB) supplies start time, without indexing the entire
corpus. Unknown start/end stays unknown. Architect accepts this bounded approach;
Auditor still requires honest UI limits and append/scroll regression tests.

## 📋 Lens 5: Auditor — What must be proved before shipping?

| Check | Evidence required |
|---|---|
| Live append becomes visible without manual Refresh | Fixture HTTP + actual bundled DOM client, automatic poll. |
| Start/end/update semantics | Unit tests for timestamp-less heads, explicit completion, resumed session, partial end marker. |
| Selection and host isolation | Delayed-response DOM regression; authenticated API path checks. |
| Read-only invariants | Fixture byte/mtime preservation, bounded head/tail counters. |
| Layout and accessibility | Preserve keyboard controls and responsive styles; fresh browser automation remains unavailable under the prior user-control stop. |

**Cross-lens summary:** Make the conversation primary, keep the table as a second
view, and preserve read-only behavior. Live means newly completed JSONL records
appearing on the 2-second polling cycle; it is not process-health detection or
unrestricted full-history streaming. Visual review is separate from API/DOM proof.

## React + Tailwind follow-through (same five lenses, post-build pass)

| Lens | Verified result / remaining concern |
|---|---|
| Archaeologist | User explicitly requested React/Tailwind and a Van Gogh theme after the dependency-free prototype. Installed pinned packages with `npm install --offline --ignore-scripts --no-audit --no-fund`. |
| Bug Hunter | React keyed tool entries preserve disclosure DOM across appends; DOM regression passes for delayed selection results, follow-off scroll position, partial records and pending-name draft isolation. |
| Skeptic | A painterly theme should not bury operational data. Palette changes only: dark blue surfaces, sunflower accent, warm cream text; no fake chat composer, process state or token streaming. |
| Architect | Five typed components separate session list, conversation, event, timing and naming. `useBackend` owns HTTP/polling, while Tailwind semantic tokens define both themes. Core scanner/TUI remain free of third-party runtime imports. |
| Auditor | Bun tests and fixture HTTP/DOM runs prove functionality; static palette contrast tests prove the chosen text token pairs, not rendered browser contrast. Fresh browser layout verification remains a stated gap, not a reason to mislabel DOM evidence. |

**Cross-lens conclusion:** The requested live React/Tailwind view is implemented
without expanding transcript writes or connecting to the reference application's
backend. The component boundary and theme tokens make reuse practical; browser
visual QA is still distinct from the automated functional proof.

## Latest user refinement

Table is restored as the default. Clicking any row (or its accessible session
button) opens the live reading view; Table returns to the preserved overview.
The DOM regression first reproduced the wrong default, then passed after this
change. This preserves the interface the user liked rather than imposing a new
landing view.

## Navigation follow-up

The running server initially predated Back support. Detail navigation now writes
a session ID into the URL and handles popstate; an explicit Back-to-sessions
action preserves table state. The DOM harness checks browser History Back/Forward
and a fresh client remount at the detail URL (including loss of memory-only token).
The served production bundle was confirmed to contain the Back button and
popstate handler after restart. This is not a claim of new browser visual QA.

## Final popup / time-first review (latest user overrides)

- Archaeologist: the user prefers the original table, not a separate replacement
  workspace. Table stays Home; row clicks open a native live dialog.
- Bug Hunter: a single dialog scrollport and natural-flow tool output repair the
  reported clipping. The latest tool opens by default, while manual toggles stop
  following. Home is also inside the modal; focus returns to the selected row.
- Skeptic: “Live” means complete-message polling every second, not token streaming.
  Newest-first and Jump-to-latest are explicit choices, not a forced order change.
- Architect: time/size/ctime/inode revisions invalidate caches; only explicit
  SHA-256 requests read full files. No hash work runs inside polling.
- Auditor: Ego Browser observed synthetic appends, tools, timestamps, aliases,
  themes, reload, Home/Esc/Back/Forward. Desktop panels measured equal at 354.5px
  with a 720px viewport and no page-height overflow. Screenshots and reproduction
  live in `tutorials/live-sessions.md`. This supersedes the earlier browser gap;
  mobile and browser local-network-permission behavior remain unverified.
