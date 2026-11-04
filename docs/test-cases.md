# Test Cases: Session Hub

> Scope: Tranche v1, Phase 1 (F-001 to F-004). Later phases add their scenarios when they start.
> PMBook: docs/project-management.md (v7)

Each scenario is concrete and runnable. "Auto" = covered by an automated test; "Manual" = a person
must watch for it (permission prompts, mod enablement).

## F-001 — Mod skeleton + permission spike

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-001 | Mod validates | `claude plugin validate plugin` | No errors | Auto |
| TC-002 | Mod type-checks | `npx -p typescript tsc -p plugin` | Exit 0 | Auto |
| TC-003 | Spike self-check, account A | Start `claude --plugin-dir C:\Users\muhammedali.khan\source\repos\session-hub\plugin` signed in as account A; run `/hub-selftest` | Each step (create folder, write, read, list, `$.process.run` PowerShell, `$.process.spawn` PowerShell) reports OK; **no permission prompt appears** | Manual. Confirmed by the user on 2026-11-04: all 6 steps OK, no prompt |
| TC-004 | Spike self-check, account B | Same as TC-003 from a second account (different `CLAUDE_CONFIG_DIR`) at the same time | Same; both accounts' results visible in the shared folder | Manual. Confirmed by the user on 2026-11-04: two accounts, all 6 steps OK, no prompt; account B saw both files |
| TC-005 | Default permission mode | Repeat TC-003 in the permission mode the user normally runs (not bypass) | No prompt | Manual. Confirmed by the user on 2026-11-04: no permission prompt in their normal (non-bypass) permission mode |

## F-002 — Bus helper `append`

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-010 | Creates missing folder and file | Append one line to a path whose folder does not exist | Folder and file exist; file holds exactly that line plus `\n` | Auto |
| TC-011 | Concurrent writers | 10 processes × 100 appends at once | 1,000 lines, every line valid JSON, every expected id present once | Auto |
| TC-012 | Abandoned mutex | Kill a process while it holds the mutex; append from another | Second append succeeds | Auto |
| TC-013 | Mutex timeout | Hold the mutex for 5 s from a test process; append | Exits non-zero with a clear error ("timed out") after the 2 s mutex wait; the test asserts under 4,500 ms wall clock, which includes powershell.exe startup; file unchanged | Auto |
| TC-014 | Non-ASCII body | Append a body with emoji and accented letters | Read back byte-exact as UTF-8 | Auto |
| TC-015 | Bad input rejected | Append an empty line, or one containing LF or CR | Exit 2, file unchanged | Auto |

## F-003 — Bus helper `tail`

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-020 | New line seen fast | Start tail at end; append a line | Printed within 2 s | Auto |
| TC-021 | Half line held back | Write half a line (no `\n`) directly; wait 3 s; write the rest | Nothing printed until the rest arrives; then the whole line once | Auto |
| TC-022 | Starts from offset | File has 5 lines; tail from the offset after line 3 | Prints lines 4 and 5 only | Auto |
| TC-023 | Large file | 50 MB file; tail from its end; append one line | Line printed within 2 s; memory stays small | Auto |
| TC-024 | Burst | Append 500 lines quickly while tailing | All 500 printed once, in order | Auto |
| TC-025 | Position lines | Tail a file; append lines | `#pos <fileid>:<offset>` printed at start and after each batch, offset = bytes consumed | Auto |
| TC-026 | `-From end`, file missing or locked | Tail `-From end` on a missing file; on a briefly locked one | Missing: waits, then reads from 0 once it exists. Locked: still starts at its end | Auto |
| TC-027 | Bad `-From` | Pass `-From` values that are not `<fileid>:<offset>` or `end` | Exit 2 with a message on stderr | Auto |
| TC-028 | File replaced or shrunk | Tail from a different file id, or an offset above the file size | Warning on stderr; restarts at offset 0 (following an archive is F-014) | Auto |

## F-004 — Message model

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-030 | Round trip | Build a message, serialise, parse | Every field equal | Auto |
| TC-031 | Malformed line | Parse `not json`, `{}`, a line missing `to` | Each returns a "skip" result with a reason; nothing throws | Auto |
| TC-032 | Single line | Body containing newlines | Serialised form has no raw newline (escaped) | Auto |
| TC-033 | Ids unique | Build 10,000 messages | 10,000 distinct ids | Auto |

## Phase 1 integration (F-002 + F-003 + F-004 together)

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-040 | Message round trip through the bus | Build and serialise messages (plain, multi-line body, non-ASCII, 5,000 characters, a body that looks like `#pos ...`); `append` each with `bus.ps1` in a scratch folder; `tail` from `end` (to read the file id) and then from `<fileid>:0`; run every non-`#pos` output line through `parseLine` | Each line parses, bodies are identical to what was sent, `#pos` lines are recognisable by their leading `#` and never parse as JSON | Auto (`plugin/tests/bus.roundtrip.Tests.ps1`, which runs `plugin/tests/e2e-roundtrip.mjs` under node with native type stripping; temp folder only; skipped with a visible reason if node is absent; bodies also include one with a backslash and quotes) |
