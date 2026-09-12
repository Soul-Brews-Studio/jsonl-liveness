# Host-selectable JSONL Studio: implementation and verification plan

Latest user objective: research studio.buildwithoracle.com `?host=`, implement the
corresponding backend connection model, and provide browser + terminal clients.

## Invariants
- Source transcripts remain read-only; metadata names are stored separately.
- Preserve existing Bun CLI flags and one-shot JSON contract (additive fields only).
- Zero runtime packages; Bun/TypeScript plus browser platform APIs.
- No pushes, merges, production mutations, or changes outside this lab.
- Public-source research and the requested backend/client networking are authorized
  by the newer task; other charter restrictions remain.

## Deliverables and proof
1. Research deployed Studio host normalization and session API schemas. Record
   URLs, deployed asset identity, source evidence, and compatibility boundaries.
2. Shared backend: cached non-overlapping scans, snapshot + naming API, live events,
   health, strict origin/host handling, loopback default, optional bearer auth.
   Test actual HTTP/SSE, errors, alias persistence, input rejection, and source
   file bytes/mtime invariance using isolated fixtures.
3. User clarification: ONLY our browser/TUI with the same host connection pattern.
   No hosted Studio API compatibility or Oracle knowledge endpoints required.
   Keep research on the upstream protocol, but do not clone unrelated APIs.
4. Browser UI selects an API with `?host=`, displays and filters live sessions,
   edits aliases, handles disconnected/pause states and small screens.
5. TUI/CLI can select the same backend using `--host`; naming round-trips through
   the service and appears in both clients. Local CLI remains functional.
6. Run original charter Verify, unit/integration tests, strict typecheck/build,
   and PTY tests. Perform browser visual/interaction checks once user restores
   control; preserve that gap explicitly until then.
7. Document commands and real output, commit only lab changes on
   agents/01-jsonl-liveness; no push/merge.

Browser automation is presently paused by an explicit user-control tool stop.
