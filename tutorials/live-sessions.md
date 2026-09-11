# Follow a session in a live popup

For people using JSONL Liveness locally: keep the familiar table, open a session,
watch new messages, inspect a tool, and return without losing your place.
All screenshots and message examples below use synthetic fixtures, not private chats.

## Before you begin

- Install Bun and Node/npm. From this app directory, run `npm ci` and `bun run build:web`.
- Seed the demonstration: `bun tutorials/fixtures.ts`.
- In one terminal start the frontend/backend on its normal port:
  `bun run . --serve --root .local/tutorial-projects`.
- In another terminal start the separately selected demonstration backend:
  `bun run . --serve --port 47883 --root .local/tutorial-projects --allow-origin http://127.0.0.1:47881`.
- These commands use only synthetic files in `.local/tutorial-projects`. Never append
  tutorial messages to your real `~/.claude/projects` files.

## Steps

1. **Open the table** — Visit
   `http://127.0.0.1:47881/?host=127.0.0.1:47883`.
   - **Expected:** Backend host becomes `http://127.0.0.1:47883`, two sessions appear,
     and **Recent message** shows readable text even when the last event is `system`.
   - The host is remembered locally and removed from the URL; tokens are not stored.

   ![Original table with recent messages from two synthetic sessions](images/01-table.png)

2. **Click `tutorial-session`** — Click its row or focus the session-name button
   and press Enter. The desktop table and detail panel have equal viewport-bounded heights.
   - **Expected:** A **Live session** popup opens over the same table. The URL is
     `http://127.0.0.1:47881/?session=tutorial-session`.
   - **Start**, **End**, and **Last update** explain their provenance. An absent
     explicit session-end remains **Not recorded in this tail**.

3. **Inspect a tool** — The latest tool disclosure opens automatically. Click
   **Tool: Bash** to expand its input; click again to collapse it.
   - **Expected:** The fixture command is `bun test`; **Tool result** contains
     `3 pass · 0 fail. Synthetic tutorial output.`
   - The popup has one vertical scroll area. Expanded output takes normal space;
     metadata and the larger-tail button stay after the conversation, not over it.
   - Manually opening a tool stops auto-follow so updates do not steal your place.

   ![Expanded tool output remains readable in a single scrolling popup](images/02-live-popup.png)

4. **Choose the reading direction** — Select **Newest first** under **Order**,
   then **Jump to latest**.
   - **Expected:** The newest event is at the top. **Oldest first** restores
     chronological reading; **Following latest** can be toggled off for manual reading.

5. **Observe a live append** — Leave the popup open and run in a third terminal:
   `bun tutorials/fixtures.ts --append`.
   - **Expected:** “A new synthetic message arrived while the live view was open.”
     appears without clicking Refresh. **Last update** advances.
   - The browser and scanner poll every second; separate scan/client cycles or a slow
     read can add latency. Only complete newline-terminated records appear.

   ![Van Gogh theme and newest-first live messages](images/03-live-append.png)

6. **Cross-check only when needed** — Scroll to **File change check**, then activate
   **Check SHA-256**. Keyboard users can Tab to the button and press Enter.
   - **Expected:** A 64-character hash, **mtimeMs**, and the hash-check time appear.
     Ordinary refreshes do not calculate hashes. **Recheck SHA-256** requests another
     full-file check; the non-forced API can reuse an unchanged cached fingerprint.

7. **Set a display name** — Enter `Demo live session` in **Display name** and
   select **Save name**.
   - **Expected:** **Name saved** appears, the heading/table use the alias, and the
     session ID remains `tutorial-session`. The transcript is unchanged.

8. **Return to the table** — Select **Back to sessions** or **Close**, or press Esc.
   - **Expected:** The popup closes and the existing table/search remain. The
     **JSONL Liveness** title is the Home link (also available inside the popup). Browser Back/Forward reopens/closes
     session routes; reloading a detail URL restores its popup after connection.

9. **Try the theme** — From the table, choose **Van Gogh · Starry Night** in **Theme**,
   then reopen the session.
   - **Expected:** Blue surfaces and sunflower accents appear without changing the
     backend or session. **Midnight** restores the original palette.

## Verify

A new synthetic message appears automatically, the latest tool opens and its output
is not clipped by another panel, and Close/Esc returns to the original table.
`bun test`, `python3 tui-smoke.py`, and `python3 remote-smoke.py` verify core behavior.

## Troubleshooting

- **Disconnected** — Ensure both local servers are running and the selected host
  matches port 47883. A different frontend origin needs its own `--allow-origin`.
- **Token required after refresh** — Re-enter the backend's token in the connection
  form. This is human-only for real credentials; never put tokens in URLs/screenshots.
- **New output does not appear** — Confirm the view is not paused and the new JSONL
  record ends with a newline. An unfinished final record is intentionally withheld.
- **Old UI after source edits** — Rebuild CSS and restart the server, then reload;
  its browser JavaScript is bundled when the server starts.

## Notes

- Interface observed on 2026-09-11 using Ego Browser and synthetic local fixtures.
- The screenshots demonstrate both themes; times/ages naturally differ between steps.
- This is complete-message polling, not token streaming or a terminal-control interface.
- Capture tooling initially cropped screenshots at browser zoom. Direct viewport
  capture through the same Ego page corrected it; no images were fabricated.
