# Session Hub Test Runbook

Expected results live in `docs/test-cases.md` (TC IDs). This runbook says how to run each check; it does not repeat the expectations.

Covered so far: F-001 (mod skeleton + permission spike), F-002 (`bus.ps1 append`), F-003 (`bus.ps1 tail`), F-004 (`plugin/hooks/message.ts`), and the integration round trip (TC-040). Run all commands from the repo root `C:\Users\muhammedali.khan\source\repos\session-hub`.

## 1. Automated gates

| Gate | Command | TC IDs |
|---|---|---|
| Type-check | `npx -p typescript tsc -p plugin` (expect exit 0) | TC-002, TC-030..033 (hook code compiles) |
| Mod validation | `claude plugin validate plugin` (expect no errors) | TC-001 |
| Mod tests | `claude plugin test plugin` | TC-030..033 (message hook) |
| PowerShell tests | `pwsh -NoProfile -Command "Invoke-Pester plugin/tests -CI"` | TC-010..015, TC-020..028, TC-040 |

Rules for the Pester gate:
- Run it serially: one Pester run at a time. The tests use the real named mutex `Local\ClaudeSessionHubBus`, so parallel runs contend with each other.
- Do not run it while a real Session Hub is running, for the same reason. Close the hub (or every Claude session that loaded the mod) first.
- TC-040 (`plugin/tests/bus.roundtrip.Tests.ps1`) needs node >= 22.18. Check with `node --version`. If node is older, that test cannot run; do not read that as a pass.
- TC-013 asserts under 4,500 ms wall clock, so a heavily loaded machine can produce a false failure. Re-run alone before treating it as real.

## 2. Manual: F-001 permission spike in two accounts (TC-003, TC-004, TC-005)

Do this with two accounts at once, using your normal (non-bypass) permission mode so TC-005 is covered at the same time.

1. Open two terminals. In each, set a different `CLAUDE_CONFIG_DIR` so each signs in as a different account (account A in terminal 1, account B in terminal 2).
2. In each terminal, start:
   `claude --plugin-dir C:\Users\muhammedali.khan\source\repos\session-hub\plugin`
3. Confirm you are in your usual permission mode, not bypass.
4. In each terminal, run `/hub-selftest`.
5. Watch each terminal while it runs. Pass: no permission prompt appears at any point. Any prompt is a failure of TC-003/004/005.
6. Check the status line summary in each terminal. Pass: all six steps are reported OK:
   a. create folder
   b. write
   c. read
   d. list
   e. `$.process.run` PowerShell
   f. `$.process.spawn` PowerShell
7. Open `%USERPROFILE%\.claude-session-hub\selftest\`. Pass: a self-test file from each account is present (two files).
8. From either terminal, run `/hub-selftest` again and confirm it still passes and both accounts' files remain visible (TC-004: account B sees both files).

Record the date and account names when you sign this off in `docs/test-cases.md`.

## 3. Manual: append and tail by hand (F-002, F-003)

These are quick sanity checks. The Pester suite is the authoritative coverage (TC-010..015, TC-020..028).

1. Make a temp folder, for example `$tmp = Join-Path $env:TEMP 'hubcheck'; New-Item -ItemType Directory $tmp`.
2. Window 1, start the tail at the end of a not-yet-existing file:
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File plugin\bin\bus.ps1 tail -Path <tmp>\bus.jsonl -From end`
   Expect a `#pos <fileid>:<offset>` line (TC-025) or, with the file missing, a wait (TC-026).
3. Window 2, make a base64 line and append it:
   ```
   $line = '{"id":"x1","to":"a","body":"hello"}'
   $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($line))
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File plugin\bin\bus.ps1 append -Path <tmp>\bus.jsonl -LineBase64 $b64
   ```
   Expect exit code 0 (`$LASTEXITCODE`).
4. Back in window 1. Pass: the line prints within about 2 s, followed by an updated `#pos` line (TC-020, TC-025).
5. Edge checks:
   - Append an empty string (`-LineBase64 ''` or the base64 of text containing a newline). Expect exit code 2 and no change to the file (TC-015).
   - Run `... tail -Path <tmp>\bus.jsonl -From banana`. Expect exit code 2 with a message on stderr (TC-027).
6. Stop the tail with Ctrl+C and delete the temp folder.

## 4. Message hook (F-004)

No manual flow. Covered by the automated gates: `npx -p typescript tsc -p plugin` and `claude plugin test plugin` (TC-030..033).
