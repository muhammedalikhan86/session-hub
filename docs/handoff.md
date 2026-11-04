# Session Hub — Handoff

> Tranche: v1

## Tranche v1 — Phase 1 (Foundation): complete

### What was done

- **F-001 Mod skeleton + permission spike.** Files: `plugin/.claude-plugin/plugin.json`, `plugin/hooks/{hooks.json,register.ts,paths.ts,selftest.ts,selftest.test.ts}`, `plugin/tsconfig.json`, `plugin/README.md`. `/hub-selftest` proves the mod's `$.fs` and `$.process` calls against `%USERPROFILE%\.claude-session-hub` raise no permission prompt. The user verified it in two accounts in normal permission mode: all 6 steps OK, no prompts (resolves risk A7).
- **F-002 `plugin/bin/bus.ps1 append -Path -LineBase64`.** Named mutex `Local\ClaudeSessionHubBus` (2 s wait, abandoned = acquired), one Write + Flush(true), FileShare ReadWrite|Delete. Exit codes: 0 ok, 1 I/O, 2 bad input, 3 mutex timeout. No stdout. Tests: `plugin/tests/bus.append.Tests.ps1` (+ `helpers.ps1`).
- **F-003 `bus.ps1 tail -Path -From <fileid>:<offset>|end`.** Polls every 1 s and consumes only up to the last LF. Prints bus lines verbatim, plus `#pos <fileid>:<offset>` lines at start and after each batch. File id is the NTFS identity hex `<vol>-<indexhigh><indexlow>`. On an id change or shrink it writes a stderr warning and restarts at 0 (reading the archived file first is F-014). A sharing violation at start is retried rather than replayed. Tests: `plugin/tests/bus.tail.Tests.ps1`.
- **F-004 `plugin/hooks/message.ts`.** Exports BusMessage, kinds `order|reply|info|join|leave`, BROADCAST `'*'`, `isValidSessionName` (`^[A-Za-z0-9_-]{1,32}$`), `buildMessage`, `serializeMessage`, and `parseLine` (never throws, rejects an empty body). Tests: `message.test.ts`.
- **Integration.** TC-040 automated round trip: `plugin/tests/e2e-roundtrip.mjs` (node >= 22.18, type stripping) plus `bus.roundtrip.Tests.ps1`. Docs synced: Architecture v6, ADR-003 amended (join/leave are their own kinds), `test-cases.md`, PMBook. `.gitignore` adds `testResults.xml`.

### Current state

Tranche v1 Phase 1 is complete. The mod loads, `/hub-selftest` passes, and the bus helper can append and tail safely, with a tested message model. At the end of Phase 1 the pieces were not yet wired together; `register.ts` now uses `message.ts` and the bus helper (Phases 2 and 3, below). The Phase 1 code was later committed and pushed (main at 4f42b4d); the user commits only on request.

### How to run checks

- `npx -p typescript tsc -p plugin`
- `claude plugin validate plugin`
- `claude plugin test plugin`
- `pwsh -NoProfile -Command "Invoke-Pester plugin/tests -CI"` — run serially. It uses the real named mutex, so do not run it while a real Session Hub is running.
- Manual: `claude --plugin-dir C:\Users\muhammedali.khan\source\repos\session-hub\plugin`, then `/hub-selftest`.

### What's next

Phase 2 (Presence) was next and is now done; see the Phase 2 section below.

### Important context

- Built-in SendMessage only works within one signed-in account, which is why this project exists.
- Only the Hub gives orders.
- The consumer of `tail` (F-009) must check the `#pos ` prefix before calling `parseLine`.
- The mod stores the file id and offset in `$.state` (Architecture §4).
- `claude plugin validate` warns about a missing icon and license; this is a packaging item (F-015).
- Pester 6.2 is installed (the plan assumed 5).
- TC-040 needs node; it skips if node is absent.

## Tranche v1 — Phase 2 (Presence): complete (2026-11-04)

### What was done

- **F-005 `/hub-join`, F-006 heartbeat and leave, F-007 Hub away.** Details are in `docs/architecture.md` v7 §4 and `plugin/README.md`. The parts:
  - `presence.ts`.
  - `join.ts`: the order is name check, `ensureBusFile`, listener to its first `#pos` (10 s timeout), claim with a 400 ms re-read, then the join line.
  - `heartbeat.ts`: beats every 10 s. If another session holds the name, `markLost` runs.
  - `leave.ts`: the order is heartbeat, then watch, then leave line, then listener, then `removeIfOurs`. `endSession` records `endedId`, and the join wait is 500 ms.
  - `restore.ts`.
  - `hub-watch.ts`.

### Current state

Phase 1 and Phase 2 are both done (as of Phase 2 close; Phase 3 is now done too, see below). The Phase 2 code is uncommitted. Main is at 4f42b4d (the Phase 1 commits, already pushed). The user commits on `main` only when they ask.

### Lessons from the retries

1. `/clear` fires `session.end` with a new session id and no `session.start`. State must be keyed on the session id, not reset in `session.start`.
2. `session.end` has a 1.5 s bound.
3. When an await sits between unjoining and `clearStored`, a new join can slip in. Clear first, then await.
4. Reviewers sometimes cannot run commands, so the orchestrator should run the gates itself.

### Known gaps

1. (Closed in Phase 3) After a mod reload a session did not listen; `restore.ts` now restarts the listener from the stored `listenerPos`.
2. A spawned listener cannot be killed directly. It stops at its next output.
3. LICENSE and author are missing. They matter only for the plugin directory.

### Manual checks still to run

These are in `docs/test-runbook.md` §5: TC-080..084 and TC-06A. They need two signed-in accounts, run with `claude --plugin-dir C:\Users\muhammedali.khan\source\repos\session-hub\plugin`. TC-082 and TC-084 may have to be recorded as not run.

### How to test

- `npx -p typescript tsc -p plugin`
- `claude plugin validate plugin`
- `claude plugin test plugin` (138 tests after Phase 3; 79 at Phase 2)
- `pwsh -NoProfile -Command "Invoke-Pester plugin/tests -CI"` (28 tests). Run it serially, not while a hub is running. It needs node 22.18 or later.

### What's next

Phase 3 (Messaging) is now done; see below.

## Tranche v1 — Phase 3 (Messaging): complete (2026-11-04)

### What was done

- **F-008 `send` tool** (`send.ts`): `mcp__session-hub__send`, registered at `session.start`.
- **F-009 inbox and listener** (`inbox.ts`, `restore.ts`): filter for messages addressed to this session, seen ids, and `listenerPos` kept in `$.state`. Messages are held in a buffer during join. Restore restarts the listener from the stored `listenerPos`.
- **F-010 delivery** (`deliver.ts`): messages arrive as frames submitted through `$.prompt.submit`. `onMessage` is awaited in the inbox chain, so submits stay in order. Messages are dropped if the session left mid-route.
- **F-011 Hub authority** (`deliver.ts`, `makeIsFromLiveHub`): an order is accepted only if it is from `Hub`, `presence\Hub.json` is fresh, and its sessionId equals the message's `fromSession`.

### Current state

Messaging works end to end in code and tests. Phase 3 code is uncommitted. Gates: tsc 0 errors, `claude plugin test` 138/138, Pester 28/28, PS 5.1 parse clean. Architecture v8, PMBook v20.

### Open points for the next session

1. Manual checks not run: Phase 2 (PM-002, runbook §5) and Phase 3 (PM-003, runbook §6: TC-09A, TC-0AB, TC-0C6, TC-0D0..0D9). Delivery within 5 s and waking an idle session are unproven live, as is whether the model obeys plugin-submitted prompts.
2. The send tool is not `isDeferred`; the model must find it through ToolSearch.
3. The `register.ts` wiring has no unit test.
4. `claude plugin validate` advisory: the `tool.call` gating hook has no `.catch`. In `handleSend` (`send.ts`), `deps.sessionId()` is outside the try block. A small fix candidate for Phase 4.
5. Validator warnings (pre-existing): missing `author`, plugin-directory icon, and marketplace install line in the README. LICENSE and author matter only for the plugin directory.

### What's next

Phase 4: F-012 presence pane and `list_sessions`, F-013 `/hub-history`, F-014 `/hub-clear`, F-017 concurrency proof.
