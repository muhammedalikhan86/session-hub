# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 2026-11-04

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
