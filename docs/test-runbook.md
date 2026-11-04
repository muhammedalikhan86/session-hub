# Session Hub Test Runbook

Expected results live in `docs/test-cases.md` (TC IDs). This runbook says how to run each check; it does not repeat the expectations.

Covered so far: F-001 (mod skeleton + permission spike), F-002 (`bus.ps1 append`), F-003 (`bus.ps1 tail`), F-004 (`plugin/hooks/message.ts`), F-005 (`/hub-join`), F-006 (heartbeat and leave) and F-007 (Hub away), plus the integration round trip (TC-040). TC-050..075 run under `claude plugin test plugin`, except TC-051 and TC-056, which run under Pester (`plugin/tests/hub-join.Tests.ps1`); TC-06A and TC-080..084 are manual (section 5). Run all commands from the repo root `C:/Users/muhammedali.khan/source/repos/session-hub`.

## 1. Automated gates

| Gate | Command | TC IDs |
|---|---|---|
| Type-check | `npx -p typescript tsc -p plugin` (expect exit 0) | TC-002, TC-030..033 (hook code compiles) |
| Mod validation | `claude plugin validate plugin` (expect no errors) | TC-001 |
| Mod tests | `claude plugin test plugin` | TC-030..033 (message hook), TC-050, TC-052..055, TC-057..059, TC-05A (join, presence), TC-060..069 (heartbeat, leave, session end, restore), TC-070..075 (Hub away) |
| PowerShell tests | `pwsh -NoProfile -Command "Invoke-Pester plugin/tests -CI"` | TC-010..015, TC-020..028, TC-040, TC-051 (`hub-join.Tests.ps1`, id TC-F005-4), TC-056 (`hub-join.Tests.ps1` file helpers) |

Rules for the Pester gate:
- Run it serially: one Pester run at a time. The tests use the real named mutex `Local\ClaudeSessionHubBus`, so parallel runs contend with each other.
- Do not run it while a real Session Hub is running, for the same reason. Close the hub (or every Claude session that loaded the mod) first.
- TC-040 (`plugin/tests/bus.roundtrip.Tests.ps1`) and the hub-join tests TC-051 and TC-056 (`plugin/tests/hub-join.Tests.ps1`, which runs `e2e-join.mjs`) need node >= 22.18. Check with `node --version`. If node is absent they skip with a visible reason; if it is older they cannot run. Do not read either as a pass.
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

## 5. Manual: Phase 2 presence flows (TC-080..084, TC-06A)

Start each session in its own terminal with its own `CLAUDE_CONFIG_DIR` (as in section 2):
`claude --plugin-dir C:\Users\muhammedali.khan\source\repos\session-hub\plugin`
Use your normal (non-bypass) permission mode; any permission prompt in these flows is a failure. Presence files are in `%USERPROFILE%\.claude-session-hub\presence\`, the log is `bus.jsonl` beside it. Before starting, close every other Session Hub session and delete leftover presence files so no stale name interferes. Mark each result in `docs/test-cases.md` with date and accounts.

Recording results: for each TC, record exactly one of **pass**, **fail** or **not run**, with the date and accounts. Use **not run** whenever a flow or sub-step could not be performed (for example no way to reload the mod, or no way to freeze a session); say why. Never record a skipped step as a pass. A fail needs a one-line note of what was seen.

### 5.1 Two accounts join; a live name is refused; a simultaneous claim (TC-080)
1. Terminal 1 (account A): `/hub-join Hub`. Expect `Joined as Hub (hub).` and status `Session Hub: Hub (Hub)`. `presence\Hub.json` exists.
2. Terminal 2 (account B): `/hub-join Reports`. Expect status `Session Hub: Reports (worker)`. `bus.jsonl` has a `join` line from each.
3. Terminal 3 (account C, or a second session): `/hub-join Hub`. Expect `Join refused:` asking for another name; `Hub.json` is unchanged.
4. Simultaneous claim: in terminals 3 and 4, type `/hub-join Tests` in both but do not press Enter; press Enter in both as close together as you can (repeat a few times, running `/hub-leave` in the winner between attempts). Pass: exactly one joins and the other is refused each time.
5. Pass: no permission prompt anywhere; `presence\` holds one file per joined name.

### 5.2 `/clear` then rejoin (TC-081)
1. In a joined worker run `/clear`, then check `presence\` and the tail of `bus.jsonl`. Expect the old presence file gone and a `leave` line for that name.
2. Run `/hub-join <name>` in the same terminal (no restart). Expect it to succeed under the new session id, with a heartbeat (`lastSeen` in the file moves about every 10 s).

### 5.3 Mod reload (TC-082)
1. Join as a worker. Note `startedAt` in `presence\<name>.json`.
2. Reload the mod using whatever your Claude Code version offers for reloading plugins in a running session (check `/help`; if there is none, record TC-082 as **not run**: the unit tests cover the restore logic, not a real reload).
3. Pass: the status line reads `Session Hub: <name> (worker)` again, `startedAt` is unchanged and `lastSeen` keeps advancing. Nothing is received from the bus yet: the listener restart is F-009, not a failure.
4. Optional, stale case: there is no by-hand way to leave the presence file stale at the moment of a reload (a suspended process beats again as soon as it resumes, before any reload can run). Record this sub-step as **not run**; the restore unit tests cover a stale or foreign file being dropped.

### 5.4 Hub away shown in the status bar, then back (TC-083)
1. Join `Hub` in terminal 1 and `Reports` in terminal 2.
2. Close terminal 1 normally (this runs `session.end` and removes `Hub.json`) or, for the crash form, kill it.
3. Within about 10 s of the Hub file going missing (up to 40 s after a crash, once `lastSeen` is 30 s old) terminal 2's status line becomes `Session Hub: Reports (worker) — Hub away — waiting`. Reports stays joined and its heartbeat keeps going.
4. Start the Hub again and run `/hub-join Hub`. Within about 10 s terminal 2 returns to `Session Hub: Reports (worker)`.

### 5.5 Name taken over after sleep (TC-084)
1. Join `Reports` in terminal 2.
2. Freeze that session for over 30 s with no beats: sleep the machine for over 30 s, or suspend the `claude` process with a tool such as Sysinternals `pssuspend <pid>` (resume with `pssuspend -r <pid>`). If neither is practical, this flow cannot be run by hand; say so when recording TC-084 (the unit tests cover the logic).
3. While it is frozen and over 30 s has passed, run `/hub-join Reports` from a second session. It must succeed (the name is stale).
4. Resume the first session. Within about 10 s a toast says the name was taken over and to run `/hub-join` again, and the status reads not joined. The presence file still holds the second session's id (it was not overwritten).

### 5.6 Crash frees the name within 30 s (TC-06A)
1. Join `Reports`. Kill the terminal's `claude` process (Task Manager or `Stop-Process`) so `session.end` does not run.
2. `presence\Reports.json` remains, but its `lastSeen` stops moving.
3. Immediately run `/hub-join Reports` from another session: refused while `lastSeen` is under 30 s old.
4. After 30 s from the last `lastSeen`, `/hub-join Reports` succeeds.
