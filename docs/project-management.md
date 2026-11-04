# Project Management: Session Hub — talking between Claude Code sessions

> Status: ACTIVE
> Tranche: v1
> Version: v14
> Last updated: 2026-11-04
> PRD: docs/prd.md (built against v4)
> Architecture: docs/architecture.md (built against v7)

## Phases & Milestones

| Phase | Goal | Status |
|-------|------|--------|
| Phase 1 | Foundation: the mod loads in every account with no permission prompts, and lines can be safely written to and streamed from the shared file | Done |
| Phase 2 | Presence: sessions join by name, keep a heartbeat, and know whether the Hub is there | Done |
| Phase 3 | Messaging: the Hub gives orders, workers act and reply, both ways, with the Hub's authority checked | Planned |
| Phase 4 | Visibility: the person sees who is alive, reads the history, and can clear it | Planned |
| Phase 5 | Across accounts: installed and proven end to end with three signed-in accounts | Planned |

## Feature Backlog

| ID | Feature | Phase | Priority | Status | Acceptance Criteria |
|----|---------|-------|----------|--------|---------------------|
| F-001 | Mod skeleton + permission spike | 1 | Must | Done | The mod loads in a session of two different accounts. From a `session.start` hook it creates the shared folder, writes, reads and lists a file there, and runs `powershell.exe` via `$.process.run` and `$.process.spawn`, with **no permission prompt** in any permission mode the user uses (proves NFR-009 / risk A7). If any step prompts, stop and raise it before Phase 2 |
| F-002 | Bus helper: `append` | 1 | Must | Done | `bus.ps1 append` takes the named mutex `Local\ClaudeSessionHubBus`, writes exactly one whole line plus newline in one write, flushes and releases; creates file and folder if missing. 10 processes appending 100 lines each at once give 1,000 valid JSON lines, none lost or torn (NFR-003). An abandoned mutex (holder killed mid-write) is taken over. Waits up to 2 s for the mutex, then exits non-zero with a clear error (ADR-006) |
| F-003 | Bus helper: `tail` | 1 | Must | Done | `bus.ps1 tail -From <file id>:<offset>` polls about once a second and prints every complete new line within 2 s of it being appended. Takes bytes only up to the last newline and never moves its offset past an unfinished line (test: a file ending in half a line prints nothing until the rest arrives). Uses no change notifications. Reads only new bytes (works on a 50 MB file). Runs until killed (ADR-006) |
| F-004 | Message model | 1 | Must | Done | One module builds and parses a bus line with `id, ts, from, fromSession, to, kind, replyTo, body` (Architecture §4). A malformed line is skipped and logged, never crashes the listener |
| F-005 | `/hub-join <name>` | 2 | Must | Done | In this order: checks the name is free, starts the listener at the log's current end, claims `presence\<name>.json`, appends a `join` line. A name held by a live session (heartbeat under 30 s), including `Hub`, is refused with a message asking for another name. Two sessions claiming the same free name at once: exactly one wins (re-read check, ADR-003). Test: the Hub sends to the worker the instant it reads the `join` line, and the worker receives it. The status line shows the joined name and role |
| F-006 | Heartbeat and leave | 2 | Must | Done | Joined session rewrites its presence file at least every 10 s. `/hub-leave` deletes it and logs a leave line. A session that ends or crashes has its name free within 30 s |
| F-007 | Hub-away state | 2 | Must | Done | A worker whose view of `presence\Hub.json` is missing or older than 30 s shows `Hub away — waiting`, keeps any queued work, and returns to normal when the Hub is back (FR-012) |
| F-008 | `send` tool | 3 | Must | Planned | Registered so the model can call it with `to` and `body` only. The mod stamps `id, ts, from, fromSession, kind`. In the Hub: `kind: order`, `to` any name or `*`. In a worker: always `to: Hub`, `kind: reply`, `replyTo` optional so a worker can start a message (FR-003, FR-004). Refused if the session has not joined. The tool's description tells the model never to send secrets |
| F-009 | Listener | 3 | Must | Planned | Started by F-005 before the `join` line is sent. Keeps lines for its name or `*`, drops its own and repeats (same `id`); a line that does not parse as JSON is logged and skipped. File id, offset and seen ids live in `$.state`, so a mod reload neither replays nor skips (FR-006, FR-015) |
| F-010 | Delivery | 3 | Must | Planned | A valid Hub order is queued with `$.prompt.submit` as `[Hub order #<id> to <name>] <body>`; an idle session starts working within 5 s, a busy one runs it after its current turn. In the Hub, a reply is queued as `[Reply from <name> to #<id>] <body>`. Everything else is a notice the model does not read (ADR-004) |
| F-011 | Hub authority check | 3 | Must | Planned | An `order` is acted on only if `from` is `Hub` and `fromSession` equals the `sessionId` in a fresh `presence\Hub.json`. A hand-written line claiming `from: Hub` with another session id is shown as a notice and never queued (FR-008, ADR-005) |
| F-012 | Presence pane + `list_sessions` | 4 | Must | Planned | The Hub adds a session to its list when it reads that session's `join` line, and removes it on a `leave` line or when its heartbeat is over 30 s old. A pane lists every live session: name, role, account, last seen, refreshing at least every 10 s. The Hub model can call `list_sessions` and gets the same list (FR-011) |
| F-013 | `/hub-history` | 4 | Should | Planned | Shows the last 50 messages (time, from → to, kind, first line of body). The full log stays a readable plain file at the shared folder path (FR-013) |
| F-014 | `/hub-clear` | 4 | Should | Planned | Only the Hub may run it. Under the bus mutex it moves `bus.jsonl` to `archive\bus-<UTC timestamp>.jsonl` and starts an empty file. Every listener sees the file id change, reads the archived file to its end, then reads the new file from 0 (FR-014, ADR-006) |
| F-017 | Concurrency proof | 4 | Must | Planned | Scripted test, no models needed: 5 writers send 200 lines each while 3 listeners run, and a clear happens in the middle. Every listener receives every line exactly once, in file order, none torn or half-read, and none lost around the clear. Repeated 10 times with no failure (NFR-003) |
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
| F-014 | F-002, F-003, F-005 | F-017 | |
| F-015 | F-001 | F-016 | |
| F-016 | F-010 to F-015, F-017 | — | Needs three signed-in accounts on this computer |
| F-017 | F-002, F-003, F-009, F-014 | F-016 | |

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
| PM-002 | Run the Phase 2 manual checks TC-080..084 and TC-06A (`docs/test-runbook.md` §5) | Muhammed | Before Phase 3 sign-off |

## Version History

| Version | Date | Change | Triggered By | Approved By |
|---------|------|--------|---------------|-------------|
| v1 | 2026-11-04 | Initial draft | — | — |
| v2 | 2026-11-04 | PMBook approved | Gate approval | Muhammed Ali Khan |
| v3 | 2026-11-04 | F-002, F-003, F-005, F-009, F-012, F-014 tightened for mutex writes, complete-line reads, join order and archive-on-clear; added F-017 concurrency proof (Phase 4) | Ripple from Architecture v5 | — |
| v4 | 2026-11-04 | F-001 Done: Reviewer PASS; user ran the self-test in two accounts — no permission prompt, all 6 steps OK, both accounts see the shared folder | Triage edit | — |
| v5 | 2026-11-04 | F-004 Done: Reviewer PASS after 2 iterations | Triage edit | — |
| v6 | 2026-11-04 | F-002 Done: Reviewer PASS first time; F-003 In Progress | Triage edit | — |
| v7 | 2026-11-04 | F-003 Done: Reviewer PASS after 2 iterations | Triage edit | — |
| v8 | 2026-11-04 | Architecture v6 sync (docs now match the Phase 1 build; no backlog change). TC-005 confirmed by the user: no prompt in the normal permission mode | Ripple from Architecture v6 | — |
| v9 | 2026-11-04 | Phase 1 complete: F-001..F-004 Done; Phase 1 Integration PASS after 3 Reviewer-Integration rounds (tsc 0 errors, `claude plugin test` 14/14, Pester 24/24, PS 5.1 parse clean) | Triage edit | — |
| v10 | 2026-11-04 | Phase 2 started; F-005 In Progress | Triage edit | — |
| v11 | 2026-11-04 | F-005 Done: Reviewer PASS after 2 iterations; F-006 In Progress | Triage edit | — |
| v12 | 2026-11-04 | F-006 Done: Reviewer PASS after 4 iterations (fixed a join/session.end race and a `/clear` regression); F-007 In Progress | Triage edit | — |
| v13 | 2026-11-04 | F-007 Done: Reviewer PASS after 2 iterations; Phase 2 features complete, Integration next | Triage edit | — |
| v14 | 2026-11-04 | Phase 2 complete: F-005..F-007 Done; Phase 2 Integration PASS after 3 Reviewer-Integration rounds, all on docs only (tsc 0 errors, `claude plugin test` 79/79, Pester 28/28, PS 5.1 parse clean, no dependencies); Architecture v7 updated during Integration; manual checks TC-080..084 and TC-06A left for the user (PM-002) | Triage edit | — |
