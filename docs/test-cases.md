# Test Cases: Session Hub

> Scope: Tranche v1, Phases 1 and 2 (F-001 to F-007). Later phases add their scenarios when they start.
> PMBook: docs/project-management.md (v13)

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

"Auto" below names the test that covers it. `hooks/<file>.test.ts` files run under `claude plugin test plugin`
(the mod's own calls are replaced by fakes there); `plugin/tests/hub-join.Tests.ps1` is a Pester file that runs
the real `bus.ps1`.

## F-005 — `/hub-join <name>`

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-050 | Join order | Join under a free name | Order is: name checked, bus file ensured, listener started at the end, first `#pos` seen, presence written, `join` line appended | Auto (`join.test.ts` "join runs in order…") |
| TC-051 | Worker receives the instant the Hub reads the join | Hub tail started beforehand; worker tails from end, waits for its first `#pos`, appends `join`; the Hub answers the instant it reads that line | The worker's tail prints the Hub's order (nothing missed) | Auto (`hub-join.Tests.ps1` "TC-F005-4…", which runs `e2e-join.mjs` against the real `bus.ps1`) |
| TC-052 | Live name refused, Hub included | Join a name whose presence file has `lastSeen` under 30 s old and another session id; repeat with `Hub` | Refused with a message asking for another name; no listener started; the file is untouched | Auto (`presence.test.ts` "a name held by a live session, Hub included, is refused…"; `join.test.ts` "a live name is refused before any listener starts") |
| TC-053 | Stale or own file is free | Join over a file 30 s or older, or one holding this session's id | Join succeeds | Auto (`presence.test.ts` "a stale file (30 s or older)…") |
| TC-054 | Invalid name | `/hub-join` with an empty, over-32, or illegal-character name | Refused with the rule; nothing written, no listener | Auto (`presence.test.ts` "an invalid name is refused…"; `join.test.ts` "an invalid name is refused with the rule") |
| TC-055 | Two claim one name at once | Two sessions claim the same free name together | Exactly one wins (write, 400 ms, re-read); the other backs off and refuses | Auto (`presence.test.ts` "two sessions claiming one free name at once…"). Not run across two real accounts: see TC-080 |
| TC-056 | Bus file ensured, never truncated | `ensureBusFile` on a missing file and folder, and on a file with content | Created when missing; existing content untouched; `removeFile` on a missing file is not an error | Auto (`hub-join.Tests.ps1` "hub-join file helpers", 3 tests) |
| TC-057 | Listener fails to start, or never reports a position | Spawn throws; or no `#pos` within 10 s | Join fails with a reason; the listener is stopped; no presence file written | Auto (`join.test.ts` "a listener that cannot start…", "a listener that never reports a position times out…") |
| TC-058 | Failed join rolls back | The `join` line append fails, or the claim throws after writing | Listener stopped; our presence file removed (a file now owned by someone else is left alone); error reported | Auto (`join.test.ts` "a failed append rolls back…", "a failed append leaves a presence file that now belongs to someone else", "a claim that throws after writing…") |
| TC-059 | One join at a time; none when joined | A second `/hub-join` during a join, or after joining | Refused ("already in progress" / "already joined as X, use /hub-leave first") | Auto (`join.test.ts` "a second join while one is in progress is refused…", "a join that throws clears the flag…"; `leave.test.ts` "already joined points at /hub-leave") |
| TC-05A | Status line | Join as `Hub`, and as a worker | `Session Hub: Hub (Hub)` / `Session Hub: <name> (worker)` | Auto (`join.test.ts` "the status line shows the name and role"). In the real status bar: see TC-080 |

## F-006 — Heartbeat and leave

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-060 | Heartbeat refreshes | A tick while joined | `lastSeen` refreshed, `startedAt` kept; period is at most 10 s and well under the 30 s stale limit | Auto (`heartbeat.test.ts` "the beat period…", "a tick refreshes lastSeen…") |
| TC-061 | Missing file recreated | Delete the presence file while joined | Next beat recreates it | Auto (`heartbeat.test.ts` "a missing file is recreated") |
| TC-062 | Name taken over | The file now holds another session id | Not overwritten; heartbeat stops; `markLost` stops the listener (and Hub watcher), unjoins, clears the stored join, toasts "run /hub-join again" | Auto (`heartbeat.test.ts` "a file now held by another session…"; `leave.test.ts` "losing the name unjoins…", "markLost does nothing while a leave is in progress") |
| TC-063 | Beat failure does not escape | A read or write throws in a beat | Nothing thrown out of the timer; one report per failure streak; `stop` waits for a beat in flight and nothing is written after it | Auto (`heartbeat.test.ts` "a tick that throws…", "stop cancels the timer…") |
| TC-064 | `/hub-leave` order | Leave while joined | Heartbeat stopped, then Hub watcher, then `leave` line, then listener stopped, then presence file removed | Auto (`leave.test.ts` "leave runs in order…") |
| TC-065 | Leave edge cases | Leave when not joined; during a join or another leave; `leave` append fails; file no longer ours; removal fails | Refused with a reason / name still released and the failure reported / foreign file left alone / state cleared | Auto (`leave.test.ts`: "leave when not joined is refused", "a failed leave-line append…", "a presence file that is no longer ours…", "a removal that fails…", "leave is refused during a join…") |
| TC-066 | Session end releases the name | `session.end` while joined | Same release, run once; a second end does nothing | Auto (`leave.test.ts` "session end: the same release, run once…") |
| TC-067 | Session end during a join | `session.end` while a join is pending | A join settling within 500 ms is released once; a slower join releases itself when it completes and never starts a heartbeat | Auto (`leave.test.ts` "session end during a pending join…", "session end waits for a join that settles within the bound…", "a join under s1 still pending after end s1 has returned…") |
| TC-068 | `/clear` then join again | `session.end` for id A, then `/hub-join` under id B (no `session.start`) | B joins and gets a heartbeat; A is still refused | Auto (`leave.test.ts` "session.end (clear, id A) then a join under id B succeeds", "session.end id A then a join under id A is refused", "end A, then a join under B completes through completeJoin…", "a join under B pending when end A runs is kept…"). Real `/clear`: see TC-081 |
| TC-069 | Restore after a mod reload | `session.start` with a stored join: fresh file of ours; stale, foreign or missing file; nothing stored or already joined | Heartbeat and status restored / stored join dropped / nothing done. The listener is **not** restarted (F-009) | Auto (`leave.test.ts` "reload: …", 3 tests). Real reload: see TC-082 |
| TC-06A | Crash frees the name | Kill a joined session | Name is free for another session after 30 s (nobody refreshes `lastSeen`) | Manual. The stale rule itself is covered by TC-053 |

## F-007 — Hub away

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-070 | Hub file missing, malformed or unreadable | Worker checks `presence\Hub.json` | Away | Auto (`hub-watch.test.ts` "a missing Hub file is away", "a malformed Hub file is away", "a read that throws is away…") |
| TC-071 | Stale boundary | `lastSeen` just under 30 s, and 30 s or older | Not away / away | Auto (`hub-watch.test.ts` "a stale Hub file (30 s or older) is away; just under is not") |
| TC-072 | Checked at start, then every 10 s; reports only on change | Away, away, back | The first check reports at start; two reports in total for away, away, back; an `onChange` that throws does not escape | Auto (`hub-watch.test.ts` "a fresh Hub file is not away; the first check reports it, at start", "changes are reported only on a transition…", "an onChange that throws…") |
| TC-073 | Status text | Hub away, then back | `Session Hub: <name> (worker) — Hub away — waiting`, then `Session Hub: <name> (worker)` | Auto (`hub-watch.test.ts` "status text: away carries the literal…"). In the real status bar: see TC-083 |
| TC-074 | Nothing is stopped | Hub goes away | Heartbeat, listener and joined state untouched; `hubAway` flag set (queued work kept, FR-012) | Auto (`hub-watch.test.ts` "Hub away leaves the heartbeat, listener and joined state untouched") |
| TC-075 | Workers only; stops with the heartbeat | Hub-role join, worker join, leave, lost name, session end, restore | No watcher for the Hub; one for a worker; stopped after the heartbeat on leave (waiting for a check in flight, so no status is written after it) and on `markLost`; none for a join released by `endedId`; restored for a worker | Auto (`hub-watch.test.ts`: "a Hub-role join starts no watcher…", "a join released by endedId never starts a watcher", "leave stops the watcher after the heartbeat…", "leave waits for a check in flight…", "markLost stops the watcher", "markLost clears the stored join before…", "restore starts a watcher for a worker only", "stop cancels the timer…") |

## Phase 2 integration (F-005 + F-006 + F-007 together)

These need real Claude Code sessions in separate accounts, which an automated run cannot start. All are manual.

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-080 | Two accounts join | In account A run `/hub-join Hub`; in account B run `/hub-join Reports`; try `/hub-join Hub` from a third session, and the same name from two sessions at the same moment | Status lines read `Session Hub: Hub (Hub)` and `Session Hub: Reports (worker)`; a live name is refused; exactly one of two simultaneous claims wins; no permission prompt in any session | Manual (not yet run) |
| TC-081 | `/clear` | In a joined session run `/clear`, then `/hub-join <name>` | The old name is released (a `leave` line, presence file removed) and the join works under the new session id | Manual (not yet run) |
| TC-082 | Mod reload | Join, reload the mod, check the status line and `presence\<name>.json` | Heartbeat and status line come back; `lastSeen` keeps moving; nothing is received until F-009 | Manual (not yet run) |
| TC-083 | Hub away in the real status bar | With the Hub joined and a worker joined, close the Hub session; wait over 30 s; rejoin the Hub | The worker's status line shows `Hub away — waiting`, then returns to normal; the worker stays joined | Manual (not yet run) |
| TC-084 | Taken-over name | Join, suspend the machine (or stop the heartbeat) for over 30 s, let another session claim the name, resume | The first session unjoins with a toast saying to `/hub-join` again, and does not overwrite the new holder's file | Manual (not yet run) |
