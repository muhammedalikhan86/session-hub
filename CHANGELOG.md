# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 2026-11-04

Revision 3. Tranche v1, Phase 3.

### feat

- **F-008** `send` tool (`mcp__session-hub__send`). The model sends with `body` (required), `to` and `replyTo` (optional). The mod stamps `id`, `ts`, `from`, `fromSession` and `kind`.
  - In the Hub, an `order` goes to a name or `*`.
  - In a worker, a `reply` always goes to `Hub`, with `replyTo` optional.
  - Refused when not joined.
  - The tool description tells the model never to send secrets.
- **F-009** Listener filter. Keeps lines for this name or `*`. Drops its own lines, other names, repeats and non-JSON lines.
  - Seen ids (last 500) and the read position are kept in `$.state`, so a mod reload neither replays nor skips.
  - Lines that arrive while `/hub-join` completes are held, then delivered in order.
  - A restored session restarts its listener from the stored position.
- **F-010** Delivery.
  - A Hub order becomes `[Hub order #<id> to <name>] <body>` via `$.prompt.submit`.
  - In the Hub, a reply becomes `[Reply from <from> to #<replyTo>] <body>`. An unprompted worker message becomes `[Message from <from>] <body>`.
  - Join, leave, info and ignored lines are toasts the model does not read.
  - A message that arrives after leaving is dropped.
- **F-011** Hub authority check. An order is acted on only if `from` is `Hub` and `fromSession` matches the session id in a fresh (under 30 s) `presence\Hub.json`.
  - A forged `from: Hub` line is a toast, never queued.
  - Messages are delivered in arrival order.

### test

- Unit tests for send, inbox, restore and delivery. The `claude plugin test` count is now 138.
- Pester count is 28.

### docs

- Architecture v8 describes the Phase 3 build.
- Test cases TC-090..TC-0D9.
- Test runbook §6 has the manual Phase 3 checks.
- The README is updated.

### fix

- None this phase.

### Breaking changes

- None.

### Known limits

- Live behaviour is not yet proven: delivery within 5 s, an idle session waking, and the model obeying a framed prompt (PM-003, test runbook §6).
- The `send` tool is not deferred-loaded, so the model may need its tool search to find it.
- The `register.ts` wiring has no unit test.

### Smoke tests

- **Happy path:** the Hub sends a joined worker an order with `send`; the worker receives it as `[Hub order #<id> to <name>] <body>` and the reply comes back as `[Reply from <name> to #<id>] <body>`.
- **Edge case:** a line with `from: Hub` that does not match a fresh `presence\Hub.json` session id is shown as a toast and never queued; `send` is refused when not joined.
- **Regression-sensitive:** after a mod reload the listener neither replays nor skips lines; a session restored from storage resumes from the stored read position.

## [Revision 2] - 2026-11-04

Revision 2. Tranche v1, Phase 2.

### feat

- **F-005** `/hub-join <name>`. Joins the Hub under a name.
  - Checks the name is free. A live name is refused, including `Hub`.
  - Makes sure `bus.jsonl` exists.
  - Starts the listener at the log end and waits for it to be ready.
  - Claims `presence\<name>.json` and re-reads it. If two sessions claim the same name at the same moment, exactly one wins.
  - Appends a `join` line.
  - The status line shows the name and role.
- **F-006** Presence heartbeat, leave and name release.
  - A presence heartbeat every 10 s. If the name has been taken over, the session unjoins and a toast says so.
  - `/hub-leave` stops the heartbeat, logs a `leave` line, and deletes the presence file if it is still this session's.
  - The name is released on session end. `/hub-join` works again after `/clear`.
  - A crashed session's name is freed after 30 s.
  - After a mod reload, the heartbeat and status are restored.
- **F-007** Hub away state for workers. A worker shows `Hub away — waiting` while the Hub's presence is missing or older than 30 s, and returns to normal when the Hub returns. Nothing is stopped while the Hub is away.

### test

- Unit tests for presence, join, listener, heartbeat, leave and hub-watch. The `claude plugin test` count is now 79.
- Pester join end-to-end test `hub-join.Tests.ps1`, run against the real `bus.ps1`. The Pester count is now 28.

### docs

- Architecture v7 describes the Phase 2 build.
- 33 new test cases, TC-050..05A, TC-060..06A, TC-070..075, TC-080..084.
- Test runbook §5 has the manual Phase 2 checks.
- The README has new sections for `/hub-join`, heartbeat and leave, and Hub away.

### fix

- None this phase.

### Breaking changes

- None.

### Known limits

- A restored session does not listen until F-009.

### Smoke tests

- **Happy path:** `/hub-join <name>` shows the name and role on the status line; `/hub-leave` stops the heartbeat and deletes the presence file.
- **Edge case:** `/hub-join` with a live name, including `Hub`, is refused; a crashed session's name is freed after 30 s.
- **Regression-sensitive:** after a mod reload the heartbeat and status are restored; `/hub-join` works again after `/clear`.

## [Revision 1] - 2026-11-04

Tranche v1, Phase 1.

### feat

- **F-001** Mod skeleton + permission spike. Adds the plugin manifest, hook registration, path helpers, and the `/hub-selftest` command.
  - Modules: `plugin/.claude-plugin/plugin.json`, `plugin/hooks/hooks.json`, `plugin/hooks/register.ts`, `plugin/hooks/paths.ts`, `plugin/hooks/selftest.ts`, `plugin/hooks/selftest.test.ts`, `plugin/tsconfig.json`, `plugin/README.md`.
- **F-002** Bus helper `append`. Adds the PowerShell bus helper that appends a line to the bus.
  - Modules: `plugin/bin/bus.ps1`, `plugin/tests/bus.append.Tests.ps1`, `plugin/tests/helpers.ps1`.
- **F-003** Bus helper `tail`. Adds the `tail` subcommand to the bus helper.
  - Modules: `plugin/bin/bus.ps1`, `plugin/tests/bus.tail.Tests.ps1`, `plugin/tests/helpers.ps1`.
- **F-004** Message model. Adds the message model used by the hooks module.
  - Modules: `plugin/hooks/message.ts`, `plugin/hooks/message.test.ts`.
- **Integration** End-to-end round trip (TC-040) across append and tail.
  - Modules: `plugin/tests/e2e-roundtrip.mjs`, `plugin/tests/bus.roundtrip.Tests.ps1`.

### fix

- None this phase.

### Breaking changes

- None. This is the first release.

### Smoke tests

- **Happy path:** start a session with `claude --plugin-dir <repo>\plugin`, run `/hub-selftest`, and confirm all 6 steps report OK with no prompt.
- **Edge case:** append a line containing emoji and accented characters via `bus.ps1`, then read it back with `tail` and confirm it is byte-exact.
- **Regression-sensitive:** two writers appending at the same time never interleave lines (TC-011); a half-written line is never printed by `tail` (TC-021).
