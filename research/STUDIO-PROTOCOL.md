# Oracle Studio protocol research — 2026-09-11

## Sources and observed deployment

- https://studio.buildwithoracle.com/ loads
  https://studio.buildwithoracle.com/assets/index-DbD6sSkB.js.
- https://studio.buildwithoracle.com/api/sessions returns 404: the hosted site is
  static; its API runs on a separately selected backend.
- Upstream source checkout: `/opt/Code/github.com/Soul-Brews-Studio/oracle-studio`,
  specifically `src/api/host.ts`, `src/api/oracle.ts`, `src/pages/Sessions.tsx`,
  `src/pages/Pulse.tsx`. Research compared these with the deployed bundle; the
  local host source lacks the deployment's cloud-host cleanup described below.
- Bun HTTP API: https://bun.sh/docs/runtime/http/server (use Bun.serve, explicit
  loopback hostname, request timeout handling; no extra HTTP framework needed).

## Host selection (deployed behavior)

`?host=localhost:47778` stores the raw host in `oracle-studio-host` localStorage,
removes the query parameter and reloads. Bare host:port means HTTP. Explicit
HTTP/HTTPS is honored, trailing slashes removed, `/api` appended. Without stored
host, fallback is `http://localhost:47778` (not the hosted site's origin).

The deployed bundle clears saved hosts containing `.buildwithoracle.com` or
`.workers.dev`. Therefore do not promise those domains work as Studio backends.
Our frontend uses the same explicit-host connection pattern, with stricter
origin-only validation and its own storage key; its default is same-origin.

## Sessions and activity contract

- `GET /api/sessions`: array or `{sessions:[...]}` with `id`, `oracle`,
  `last_seen` (date string or milliseconds), `thread_count`, `learning_count`,
  `trace_count`. The deployed Sessions page loads once, not continuously.
- `GET /api/session/:id/context`: `{id,oracle,threads:[],learnings:[],traces:[]}`.
  Knowledge records are a different domain from JSONL metadata. Our adapter must
  not manufacture learnings, conversations or traces from mtime/type alone.
- `GET /api/feed?limit=200&oracle=...`: `{events,total,active_oracles}`. Each event
  uses `timestamp`, `oracle`, `host`, `event`, `project`, `session_id`, `message`.
  Pulse polls every 3 seconds. It recognizes hook events (UserPromptSubmit,
  PreToolUse, Stop, etc.); a final transcript record is NOT proof of such a hook.
  A JSONL adapter may identify observed writes explicitly as `FileWrite`, never
  substitute fictional hook/process events.
- Terminal preview is a separate MAW server at page-host port 3456 using
  `/api/sessions` and `/api/capture?target=...`. It is not routed through `host=`.
  This lab does not implement terminal control or send messages to agents.

No WebSocket/EventSource/socket.io use was found in this deployed bundle.
Our SSE endpoint is an additional transport for our own clients, not a requirement
for Studio compatibility. HTTP polling remains supported everywhere.

## Compatibility boundary

The user explicitly chose **only our web UI/TUI with the same ?host= connection
pattern**, not compatibility with the hosted Studio Sessions page. Therefore our
backend exposes a purpose-built snapshot/name/event API. The session/feed schemas
above are research evidence, not endpoints we promise to implement.

Browser inspection is currently paused by a user-control stop. Source-level
research is complete; visual verification of our frontend remains outstanding.
