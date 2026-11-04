# Project Management: Session Hub — talking between Claude Code sessions

> Status: ACTIVE
> Tranche: v1
> Version: v2
> Last updated: 2026-11-04
> PRD: docs/prd.md (built against v4)
> Architecture: docs/architecture.md (built against v3)

## Phases & Milestones

| Phase | Goal | Status |
|-------|------|--------|
| Phase 1 | Foundation: the mod loads in every account with no permission prompts, and lines can be safely written to and streamed from the shared file | Planned |
| Phase 2 | Presence: sessions join by name, keep a heartbeat, and know whether the Hub is there | Planned |
| Phase 3 | Messaging: the Hub gives orders, workers act and reply, both ways, with the Hub's authority checked | Planned |
| Phase 4 | Visibility: the person sees who is alive, reads the history, and can clear it | Planned |
| Phase 5 | Across accounts: installed and proven end to end with three signed-in accounts | Planned |

## Feature Backlog

| ID | Feature | Phase | Priority | Status | Acceptance Criteria |
|----|---------|-------|----------|--------|---------------------|
| F-001 | Mod skeleton + permission spike | 1 | Must | Planned | The mod loads in a session of two different accounts. From a `session.start` hook it creates the shared folder, writes, reads and lists a file there, and runs `powershell.exe` via `$.process.run` and `$.process.spawn`, with **no permission prompt** in any permission mode the user uses (proves NFR-009 / risk A7). If any step prompts, stop and raise it before Phase 2 |
| F-002 | Bus helper: `append` | 1 | Must | Planned | `bus.ps1 append` writes exactly one whole line to `bus.jsonl`, creating file and folder if missing. 10 processes appending 100 lines each at once give 1,000 valid JSON lines, none lost or torn (NFR-003). Retries a locked file for up to 2 s, then exits non-zero with a clear error |
| F-003 | Bus helper: `tail` | 1 | Must | Planned | `bus.ps1 tail -From <offset>` prints every complete new line within 2 s of it being appended, never a partial line, and keeps running. If the file shrinks below the offset it restarts from 0. Reads only new bytes (works on a 50 MB file) |
| F-004 | Message model | 1 | Must | Planned | One module builds and parses a bus line with `id, ts, from, fromSession, to, kind, replyTo, body` (Architecture §4). A malformed line is skipped and logged, never crashes the listener |
| F-005 | `/hub-join <name>` | 2 | Must | Planned | Claims `presence\<name>.json`. A name held by a live session (heartbeat under 30 s), including `Hub`, is refused with a message asking for another name. Two sessions claiming the same free name at once: exactly one wins (re-read check, ADR-003). Logs an `info` join line on the bus. The status line shows the joined name and role |
| F-006 | Heartbeat and leave | 2 | Must | Planned | Joined session rewrites its presence file at least every 10 s. `/hub-leave` deletes it and logs a leave line. A session that ends or crashes has its name free within 30 s |
| F-007 | Hub-away state | 2 | Must | Planned | A worker whose view of `presence\Hub.json` is missing or older than 30 s shows `Hub away — waiting`, keeps any queued work, and returns to normal when the Hub is back (FR-012) |
| F-008 | `send` tool | 3 | Must | Planned | Registered so the model can call it with `to` and `body` only. The mod stamps `id, ts, from, fromSession, kind`. In the Hub: `kind: order`, `to` any name or `*`. In a worker: always `to: Hub`, `kind: reply`, `replyTo` optional so a worker can start a message (FR-003, FR-004). Refused if the session has not joined. The tool's description tells the model never to send secrets |
| F-009 | Listener | 3 | Must | Planned | On join, spawns `bus.ps1 tail` from the current end of the file. Keeps lines for its name or `*`, drops its own and repeats (same `id`). Offset and seen ids live in `$.state`, so a mod reload neither replays nor skips (FR-006, FR-015) |
| F-010 | Delivery | 3 | Must | Planned | A valid Hub order is queued with `$.prompt.submit` as `[Hub order #<id> to <name>] <body>`; an idle session starts working within 5 s, a busy one runs it after its current turn. In the Hub, a reply is queued as `[Reply from <name> to #<id>] <body>`. Everything else is a notice the model does not read (ADR-004) |
| F-011 | Hub authority check | 3 | Must | Planned | An `order` is acted on only if `from` is `Hub` and `fromSession` equals the `sessionId` in a fresh `presence\Hub.json`. A hand-written line claiming `from: Hub` with another session id is shown as a notice and never queued (FR-008, ADR-005) |
| F-012 | Presence pane + `list_sessions` | 4 | Must | Planned | A pane lists every live session: name, role, account, last seen, refreshing at least every 10 s. The Hub model can call `list_sessions` and gets the same list. Stale sessions drop off within 30 s (FR-011) |
| F-013 | `/hub-history` | 4 | Should | Planned | Shows the last 50 messages (time, from → to, kind, first line of body). The full log stays a readable plain file at the shared folder path (FR-013) |
| F-014 | `/hub-clear` | 4 | Should | Planned | Only the Hub may run it; it empties `bus.jsonl` and logs nothing secret. Every live listener carries on and receives the next new message (FR-014) |
| F-015 | Install for every account | 5 | Must | Planned | A README gives the steps to install the mod into each `CLAUDE_CONFIG_DIR`. The shared folder path is a mod option, defaulting to `%USERPROFILE%\.claude-session-hub`, and is the same in every account (FR-016) |
| F-016 | End-to-end proof, three accounts | 5 | Must | Planned | With three accounts signed in: Hub orders `Reports`, `Reports` works and replies "done", Hub acts on the reply; Hub sends to `*` and both workers act; a worker messages the Hub unasked; a worker's fake order is ignored; Hub closes and workers show Hub away; a taken name is refused. Every message lands in under 5 s, and no permission prompt appears |

## Dependencies

| Item | Depends On | Blocks | Notes |
|------|-----------|--------|-------|
| F-001 | — | everything | If the spike shows prompts, the design needs revisiting before Phase 2 |
| F-002 | F-001 | F-005, F-008 | |
| F-003 | F-001 | F-009 | |
| F-004 | — | F-005, F-008, F-009 | |
| F-005 | F-002, F-004 | F-006, F-008 | |
| F-006 | F-005 | F-007, F-011, F-012 | |
| F-007 | F-006 | — | |
| F-008 | F-005 | F-010 | |
| F-009 | F-003, F-004, F-005 | F-010 | |
| F-010 | F-008, F-009 | F-011, F-016 | |
| F-011 | F-006, F-010 | F-016 | |
| F-012 | F-006 | F-016 | |
| F-013 | F-004 | — | |
| F-014 | F-003, F-005 | — | |
| F-015 | F-001 | F-016 | |
| F-016 | F-010 to F-015 | — | Needs three signed-in accounts on this computer |

## Out of Scope (confirmed in PRD)

- Different computers
- More than one Hub
- Human approval before acting
- Workers giving orders, to the Hub or to each other
- Anything that is not a Claude Code session
- Editing or removing single messages
- Same-account delivery through Claude Code's built-in messaging (possible later; Architecture A1)

## Open Items

| ID | Item | Owner | Due |
|----|------|-------|-----|
| PM-001 | Decide which three accounts to use for F-016 | Muhammed | Before Phase 5 |

## Version History

| Version | Date | Change | Triggered By | Approved By |
|---------|------|--------|---------------|-------------|
| v1 | 2026-11-04 | Initial draft | — | — |
| v2 | 2026-11-04 | PMBook approved | Gate approval | Muhammed Ali Khan |
