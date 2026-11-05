# Test Cases: Session Hub

> Scope: Tranche v1, Phases 1 to 5 (F-001 to F-017, B-001). F-016 is a manual checklist that has not been run.
> PMBook: docs/project-management.md (v24)

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
| TC-028 | File replaced or shrunk | Tail from a different file id with no archive carrying it, or an offset above the file size | Warning on stderr; restarts at offset 0 (following an archive is TC-0F5..0F9) | Auto |

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
| TC-069 | Restore after a mod reload | `session.start` with a stored join: fresh file of ours; stale, foreign or missing file; nothing stored or already joined | Heartbeat and status restored / stored join dropped / nothing done. The listener is restarted from the stored position (TC-0AA) | Auto (`leave.test.ts` "reload: …", 3 tests). Real reload: see TC-082 |
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
| TC-082 | Mod reload | Join, reload the mod, check the status line and `presence\<name>.json` | Heartbeat and status line come back; `lastSeen` keeps moving; the listener is running again (receiving after a reload is TC-0D7) | Manual (not yet run) |
| TC-083 | Hub away in the real status bar | With the Hub joined and a worker joined, close the Hub session; wait over 30 s; rejoin the Hub | The worker's status line shows `Hub away — waiting`, then returns to normal; the worker stays joined | Manual (not yet run) |
| TC-084 | Taken-over name | Join, suspend the machine (or stop the heartbeat) for over 30 s, let another session claim the name, resume | The first session unjoins with a toast saying to `/hub-join` again, and does not overwrite the new holder's file | Manual (not yet run) |

## F-008 — `send` tool

"Auto" = `plugin/hooks/send.test.ts`, run by `claude plugin test plugin` (the mod's calls are replaced by fakes). The tool's registration and `tool.call` wiring in `register.ts` have no unit test; they are only proven by TC-09A.

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-090 | Not joined | Call `send` before `/hub-join` | Refused; nothing appended | Auto (`send.test.ts` "unjoined is refused and nothing is appended") |
| TC-091 | Hub sends an order | In the Hub, `send` with `to` a name and a body | One line appended with `kind: order`; `id`, `ts`, `from`, `fromSession` come from the mod, not from the model | Auto ("Hub sends an order to a name; stamps come from the mod") |
| TC-092 | Hub broadcast | In the Hub, `send` with `to: "*"` | Appended as an order to `*` | Auto ("Hub can broadcast with *") |
| TC-093 | Bad or self target | In the Hub, `to` empty, invalid or `Hub` | Refused; nothing appended | Auto ("Hub with a bad or self \"to\" is refused") |
| TC-094 | Worker always writes to the Hub | In a worker, `send` with any `to` | Appended with `to: Hub`, `kind: reply` | Auto ("worker always replies to Hub whatever \"to\" says") |
| TC-095 | `replyTo` passed through | In a worker, `send` with `replyTo` | The line carries that `replyTo` | Auto ("worker passes replyTo through when given") |
| TC-096 | Bad body | Empty or non-string `body` | Refused | Auto ("empty or non-string body is refused") |
| TC-097 | Multi-line body | `body` with a newline | Sent as one bus line (newline escaped) | Auto ("a body with a newline is sent") |
| TC-098 | Append failure | The bus helper fails (any non-zero exit: 1, 2 or 3) | An error starting "Not sent" goes back to the model, never a success text | Auto ("an append failure is an error, never a success text") |
| TC-099 | No secrets | Read the tool description | It tells the model never to send secrets (NFR-006) | Auto ("the description tells the model never to send secrets") |
| TC-09A | Registered and callable in a real session | In a joined session ask the model to send a message; check `bus.jsonl` | The model calls `mcp__session-hub__send` (pinned with `isDeferred: false` since B-001, so no tool search is needed), the call raises no permission prompt, and the line appears in `bus.jsonl` | Manual (not yet run). Covers the `register.ts` wiring |

## F-009 — Listener

"Auto" = `plugin/hooks/inbox.test.ts` and `plugin/hooks/restore.test.ts`, run by `claude plugin test plugin`.

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-0A0 | Bad line skipped | A line that is not a JSON message, then a good one | The bad one is logged and skipped; the good one is delivered | Auto (`inbox.test.ts` "an unparseable line is logged and skipped…") |
| TC-0A1 | Own lines dropped | A line from my name, or with my session id | Dropped | Auto ("own lines are dropped, by name and by fromSession") |
| TC-0A2 | Addressing | A line to another name; to me; to `*` | Other name dropped; mine and `*` delivered | Auto ("a line to another name is dropped; to me and to * are delivered") |
| TC-0A3 | Repeat dropped | The same `id` twice | Delivered once | Auto ("a duplicate id is delivered once") |
| TC-0A4 | Seen ids persisted first, and bounded | Deliver lines; add 501 ids | Ids are stored in `$.state` before `onMessage` runs; the oldest is evicted past 500 | Auto ("the seen ids are persisted before onMessage runs", "the seen set is bounded…") |
| TC-0A5 | Replay after a reload | Restore the seen ids and feed a batch already seen | Nothing is delivered twice | Auto ("replay after a reload: restored seen ids stop a repeated batch") |
| TC-0A6 | Name read at line time | Lines arrive while not joined, or after a name change | Nothing delivered while not joined; the current name is used | Auto ("the name is read at line time, and nothing is delivered when not joined") |
| TC-0A7 | Failures never escape; order kept | A persist or `onMessage` throws or rejects; a slow `onMessage` | Nothing thrown; later lines still flow; line 2 is delivered only after line 1 finished | Auto ("a failing persist or onMessage never throws…", "a slow onMessage for line 1 still finishes before line 2…", "a rejecting onMessage is logged…") |
| TC-0A8 | Lines held during a join | Lines for my name or `*` arrive before `/hub-join` completes | Held in order (at most 500, oldest dropped); delivered after the join completes, ahead of any later line; discarded if the join fails; dropped, not held, when no join is in progress | Auto ("lines … that arrive before the join completes are delivered after it, in order…", "a later line is still ordered after held lines…", "held lines are discarded…", "lines are dropped, not held, when no join is in progress", "the hold buffer is bounded…") |
| TC-0A9 | Position stored in order | `#pos` after a batch | Stored only after that batch's lines were persisted and delivered; waits for a slow persist; never past held lines; dropped if the join fails | Auto ("a position is stored after its batch…", "a position still waits for a slow persist", "no position is stored past held lines…", "a held position is dropped when the join fails", "a position that arrives after the name is known but before the held lines are processed waits for them") |
| TC-0AA | Restore restarts the listener | `session.start` with a stored join and a stored `listenerPos`; with none; a listener that fails or never reports a position; leave after restore | Listener starts from the stored position (or `end`); a failure keeps the join and heartbeat and says so in the status; leave stops the restored listener | Auto (`restore.test.ts`, 5 tests). A real reload: see TC-082 and TC-0D7 |
| TC-0AB | Listener wired in a real session | Join two sessions and send a message | The receiver sees it. Needs the `register.ts` wiring (no unit test) | Manual: see TC-0D0 |

## F-010 — Delivery

"Auto" = `plugin/hooks/deliver.test.ts`, run by `claude plugin test plugin`. The tests use a fake `submit`: that a real session wakes, starts a turn and acts on the prompt is proven only by a live run (TC-0D4, TC-0D5, TC-0D6).

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-0B0 | Worker gets an order | A valid Hub order to a worker | Submitted exactly as `[Hub order #<id> to <name>] <body>` plus a reply-hint line (`replyTo "<id>"`) | Auto ("a worker queues an order from the Hub with the exact frame") |
| TC-0B1 | Broadcast order | A valid Hub order to `*` | Framed with this worker's own name | Auto ("a worker names itself in a broadcast order") |
| TC-0B2 | Left meanwhile | The message arrives after the session left | Dropped: not submitted, not noticed | Auto ("a message arriving after the session left is dropped…") |
| TC-0B3 | Worker gets a reply | A `reply` arrives at a worker | A notice only, never submitted | Auto ("a worker receiving a reply gets a notice, never a submit") |
| TC-0B4 | Hub gets a reply | A worker reply with `replyTo` | Submitted as `[Reply from <from> to #<replyTo>] <body>` | Auto ("the Hub queues a reply with the replyTo id") |
| TC-0B5 | Unprompted worker message | A worker line to the Hub with no `replyTo` | Submitted as `[Message from <from>] <body>` | Auto ("the Hub queues an unprompted worker message in its own frame") |
| TC-0B6 | Join and leave | A `join` or `leave` line | A notice in the Hub, only a debug log in a worker; nothing submitted | Auto ("the Hub gets join and leave as notices…", "a worker only logs join and leave") |
| TC-0B7 | Info and Hub-side order | An `info` line; an `order` arriving at the Hub | A notice; never submitted | Auto ("info is a notice, never submitted", "an order arriving at the Hub is a notice, never submitted") |
| TC-0B8 | Submit rejected | `submit` rejects | Logged and toasted; the next message is still delivered; no retry | Auto ("a submit rejection is logged and noticed…") |
| TC-0B9 | Body untouched | A body with newlines or a forged frame | Appended after the real frame unchanged | Auto ("the body passes through unchanged, newlines and a forged frame included") |

## F-011 — Hub authority check

"Auto" = `plugin/hooks/deliver.test.ts` (`makeIsFromLiveHub` and its use in `routeMessage`).

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-0C0 | Only Hub may order | An order from a name other than `Hub`, even with the session id of the live Hub | Notice; never submitted | Auto ("an order that is not from the live Hub is a notice…", "the real check refuses an order not from Hub even when the session id matches") |
| TC-0C1 | Forged Hub line | `from: Hub` with a session id that differs from `presence\Hub.json` | Notice; never submitted | Auto ("a hand-written line claiming from Hub with another session id…") |
| TC-0C2 | Freshness boundary | Hub presence 30 s or older; just under 30 s | Not trusted; trusted | Auto ("a stale Hub presence (30 s or older) is not trusted", "a Hub presence just under 30 s old is trusted") |
| TC-0C3 | Bad Hub file | Missing, malformed or unreadable `Hub.json` | Not trusted | Auto ("a missing…", "a malformed…", "an unreadable Hub presence file is not trusted") |
| TC-0C4 | Session changes during the check | The session leaves, or re-joins under another name, while the file is read | The order is dropped (not submitted, not noticed) | Auto ("a session that leaves during the Hub check…", "a session that re-joins under another name during the Hub check…") |
| TC-0C5 | Check fails | The Hub check itself throws | Logged; the order is not queued | Auto ("a failing Hub check is logged and the order is not queued") |
| TC-0C6 | Forged line in a real session | Append a hand-written `from: Hub` line with `bus.ps1 append` | The worker shows a notice and does nothing | Manual (not yet run): see TC-0D3 |

## Phase 3 integration (F-008 + F-009 + F-010 + F-011 together)

No automated test runs two real sessions: the unit tests above fake the mod engine, and the Pester round trip (TC-040, TC-051) covers only the bus helper and message model. Everything here is manual and needs live Claude Code sessions (`docs/test-runbook.md` section 6). None of it has been run. Until it is, delivery, the idle-session wake, the model obeying a framed prompt and cross-account behaviour are **unverified**.

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-0D0 | Order and reply round trip | Hub and Reports joined; ask the Hub's model to send Reports an order; Reports acts and replies | The worker's session starts a turn from `[Hub order #<id> to Reports] …`; its reply shows in the Hub as `[Reply from Reports to #<id>] …` and the Hub's model acts on it | Manual (not yet run) |
| TC-0D1 | Broadcast | The Hub sends to `*` with two workers joined | Both act; the Hub does not receive its own order | Manual (not yet run) |
| TC-0D2 | Unprompted worker message | A worker's model sends a message with no order to answer | The Hub receives `[Message from <name>] …` | Manual (not yet run) |
| TC-0D3 | Forged Hub line | `bus.ps1 append` a hand-written `from: Hub` order with another session id | The worker shows `Ignored an order from Hub…` and starts no turn | Manual (not yet run) |
| TC-0D4 | Delivery time | Time from the append to the receiving session starting its turn | Under 5 s (NFR-001, FR-006) | Manual (not yet run) |
| TC-0D5 | Idle wake and busy queue | Send an order to an idle worker; send another while the worker is mid-turn | The idle one starts a turn by itself; the busy one runs after the current turn, in order | Manual (not yet run) |
| TC-0D6 | Model obeys the frame | Read what the receiving model does with the framed prompt | It performs the task and answers with the `send` tool, with `replyTo` set | Manual (not yet run). Model behaviour, not code |
| TC-0D7 | Reload then receive | Reload the mod in a joined worker, then send it an order | The listener resumes from the stored position; the order is received once; nothing already seen is replayed | Manual (not yet run) |
| TC-0D8 | No permission prompt | Run TC-0D0 to TC-0D2 in the normal permission mode | No prompt in any session (NFR-009) | Manual (not yet run) |
| TC-0D9 | Three accounts | Hub and two workers in three signed-in accounts | As TC-0D0 and TC-0D1 across accounts | Manual (not yet run). This is F-016 (Phase 4) |

## B-001 — Model guidance for a joined session

"Auto" = `plugin/hooks/hub-prompt.test.ts`, run by `claude plugin test plugin`. The `register.ts` wiring (the `tool.describe` and `prompt.compose` hooks) has no unit test; that the model then picks `send` is only proven by TC-0E2.

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-0E0 | Joined prompt section names the tool and role | Build the section for the Hub and for a worker | Names the session, says to use `mcp__session-hub__send` and not built-in session messaging, never to send secrets; the Hub is told `to` may be a name or `*` and about `list_sessions`; a worker is told it writes to the Hub only and to set `replyTo` | Auto (`hub-prompt.test.ts` "B-001: the joined prompt names the send tool and the session's role"; "F-012: only the Hub is told about list_sessions") |
| TC-0E1 | Section only while joined, added last | Compose with and without a joined session | No section when not joined; one `session-hub:joined` section added last when joined, never duplicated | Auto ("B-001: no section is added when not joined, one is added last when joined") |
| TC-0E2 | The model uses `send` in a real session | Join two sessions (plugin enabled). Ask the Hub's model, with no hint about tools: "Tell Reports to reply pong" | The model calls `mcp__session-hub__send`, not the built-in session messaging or session list; no tool-search step is needed first | Manual (not yet run). The user's live check of B-001 |

## F-012 — Hub session list: pane and `list_sessions`

"Auto" = `plugin/hooks/roster.test.ts` and `plugin/hooks/roster-pane.test.tsx`, run by `claude plugin test plugin`. The tests fake the mod engine; the pane in a real terminal and the `register.ts` wiring (start with the Hub's heartbeat, stop with it) are proven only by TC-0E8.

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-0E3 | Join and leave lines update the list at once | A `join` line, a `leave` line, and a `join` for a listed session | Added with the role its name implies (account `unknown`); removed; fields of a listed session kept | Auto (`roster.test.ts` "F-012: a join line adds…", "a leave line removes…", "a join line for a listed session keeps its fields") |
| TC-0E4 | Presence files are the truth | A stale file, a live file, a file that disagrees with a join line, the Hub's own fresh file, a Hub file 40 s old | Stale dropped, live kept; the file overrides the guess; the Hub is listed with its real last seen and dropped at 40 s (never stamped "now") | Auto ("a stale presence file is removed…", "the presence file overrides…", "a fresh Hub file is listed…", "a Hub file 40 s old is dropped…") |
| TC-0E5 | A leave is not undone by the leaving file | A refresh after a `leave` line while the file still exists; a `leave` from a superseded session id | The session stays out until its file is gone or a `join` arrives; a superseded session's leave does not hide the new owner of the name | Auto ("a refresh does not re-add a session whose leave was applied", "a leave from a superseded session does not hide the new owner of the name") |
| TC-0E6 | Order, loading and refresh timer | Files in any order; non-`.json` and malformed files; ticks and stop | Hub first, then by name; only `.json` read, bad ones skipped; refresh runs at once, on each tick, not after stop | Auto ("the order is the Hub first…", "loading reads only the .json files…", "the refresh runs at once, on each tick, and not after stop") |
| TC-0E7 | `list_sessions` and the pane render | Call as the Hub, as a worker, and unjoined; render the pane with and without sessions | The Hub gets the live rows as JSON; a worker and an unjoined session are refused; the pane lists name, role and account, or says "No live sessions." | Auto (`roster.test.ts` "list_sessions gives the Hub the live rows as JSON", "…refuses a worker", "…refuses a session that has not joined"; `roster-pane.test.tsx` 2 tests) |
| TC-0E8 | Pane and tool in a real Hub | Plugin enabled. Join as Hub; join a worker; leave the worker; stop another worker uncleanly | The pane `Sessions` opens with the Hub, shows the worker within 10 s (at once on its `join` line), drops it on `leave`, and drops the crashed one within about 40 s; `list_sessions` called by the Hub model returns the same rows; the pane closes on `/hub-leave` | Manual (not yet run) |

## F-013 — `/hub-history`

"Auto" = `plugin/hooks/history.test.ts` (formatter and handler) and `plugin/tests/bus.last.Tests.ps1` (the `last` verb, real `bus.ps1`).

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-0E9 | Last N, oldest first | `/hub-history` over a log of more than 50 messages | The last 50, oldest first, under a header naming the log path | Auto (`history.test.ts` "shows at most the last 50 messages…") |
| TC-0EA | Row format | A reply, a broadcast, a multi-line body, a body over 100 characters, a malformed `ts` | `HH:MM:SS from → to kind: first line`; a broadcast reads naturally; only the first line shown; cut at 100 with `…`; a bad `ts` shows `??:??:??` | Auto ("a row is time, from -> to, kind and the body", "a broadcast and a single message read naturally", "only the first line of the body is shown…", "a long first line is cut…", "a malformed ts shows ??:??:??…") |
| TC-0EB | Unreadable lines, empty log | A log with a line that is not a message; an empty or missing log | Skipped and counted in a footer; "No messages yet." plus the path | Auto ("an unreadable line is skipped and counted…", "an empty log says so and names the path") |
| TC-0EC | Count rules and helper failure | No count, 0, `abc`, 9999 | Default 50; usage line for 0 and non-numbers; 9999 capped at 500 with a note; a helper failure is reported with its exit code | Auto ("the count defaults to 50…", "the command asks the helper for the last N lines…", "a capped count is announced, and a helper failure is reported") |
| TC-0ED | `last` verb | N of more than N lines; fewer than N; missing and empty file; an unfinished last line; a file larger than one chunk; non-ASCII; a bad `-Count` | The last N complete lines oldest first; all of them when fewer; nothing and exit 0 for a missing or empty file; the unfinished line and a line cut by a chunk edge never printed; UTF-8 intact; exit 2 for a missing or non-positive count | Auto (`bus.last.Tests.ps1`, 7 tests) |
| TC-0EE | `/hub-history` in a real session | Plugin enabled. Run `/hub-history` and `/hub-history 3` after a round trip, joined and unjoined | Rows match `bus.jsonl`; works without joining; no permission prompt | Manual (not yet run) |

## F-014 — `/hub-clear`

"Auto" = `plugin/hooks/clear.test.ts` (handler) and `plugin/tests/bus.clear.Tests.ps1` (the `clear` verb and `tail` following a clear, real `bus.ps1`).

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-0F0 | Hub clears | The Hub runs `/hub-clear` | The helper is run with `clear`; the reply is `Cleared. Archived to <path>.`; **nothing is appended to the bus, so the new log is empty and workers get no notice** | Auto (`clear.test.ts` "F-014: the Hub clears…") |
| TC-0F1 | Refusals | A worker, and an unjoined session, run `/hub-clear` | `Only the Hub can clear the log.` / `Join as Hub first.`; the helper is not run | Auto ("a worker is refused…", "a session that has not joined is refused") |
| TC-0F2 | Helper failure, missing log | The helper fails; the log is missing | `Could not clear the log: …`; `Cleared. There was no log to archive.` | Auto ("a helper failure is reported", "a missing log is cleared with nothing to archive") |
| TC-0F3 | `clear` verb | Clear a log with content; two clears in a row; a missing bus file; no `-Path`; the mutex held; a reader holding the file open | Content moved byte-exact to `archive\bus-<UTC timestamp>.jsonl` and an empty bus created; two distinct archive names; a missing file is just created (nothing printed, exit 0); exit 2 with no `-Path`; exit 3 after about 2 s with nothing moved; the move works while a reader holds the file open | Auto (`bus.clear.Tests.ps1` "bus.ps1 clear", 6 tests) |
| TC-0F4 | Nothing lost around a clear | A tail running while the bus is cleared and written to | Every line printed once, in order (archive first, then the new file), then `#pos <new id>:0` | Auto (`bus.clear.Tests.ps1` "F-014 prints every line exactly once and in order across a clear…") |
| TC-0F5 | Several clears between two passes | Two clears between two of tail's passes | Every archive is read, in order | Auto ("F-014 two clears between two passes…") |
| TC-0F6 | Unfinished last line in the archive | A half-written last line in the archived file | Skipped with a warning on stderr; the rest is printed | Auto ("F-014 an unfinished last line in the archive is skipped…") |
| TC-0F7 | Restart from an archived position | `tail -From <old id>:<offset>` after the file was archived | The rest of the archive, then the new file from 0 | Auto ("F-014 restart from an archived position…") |
| TC-0F8 | No archive for the old id | A file id with no matching archive | Warns and restarts at 0 (as TC-028) | Auto ("F-014 with no archive for the old id…") |
| TC-0F9 | `/hub-clear` in real sessions | Plugin enabled. Hub and a worker joined, a few messages sent, the Hub runs `/hub-clear`, then sends a new order | `archive\bus-<timestamp>.jsonl` holds the old lines; `bus.jsonl` is empty until the new order; the worker receives the new order once and replays no old one; a worker running `/hub-clear` is refused | Manual (not yet run) |

## F-017 — Concurrency proof (NFR-003)

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-0FA | Full proof | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File plugin/tests/stress/concurrency.ps1` (10 iterations, about 2 min; serial, not beside a real hub) | Per iteration, in a fresh temp bus: 5 writer processes x 200 appends and one `clear` mid-run; archive plus live file hold all 1,000 lines once, each complete; each of 3 real tail listeners printed exactly 1,000 lines, valid JSON and uncorrupted, none duplicated or missing, each writer's sequence increasing, the whole sequence equal to file order. 10 of 10 PASS lines, exit 0 | Auto (script run by hand; exit 1 on any failure) |
| TC-0FB | One iteration in the suite | `Invoke-Pester plugin/tests -CI` | One iteration passes (about 12 s) | Auto (`plugin/tests/concurrency.Tests.ps1`) |

## F-015 — Install and shared-folder option (Phase 5)

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-110 | Unset or blank option gives the default | `configureSharedFolder` with undefined, `''`, `'   '` | `{}` (no path, no warning); `resolveSharedFolder` gives `<USERPROFILE>\.claude-session-hub` | Auto (`plugin/hooks/paths.test.ts`: "unset or blank gives the default and no warning") |
| TC-111 | Valid absolute path used, normalised | `' D:\Hub\ '`, `'D:/Hub//'`, `'\\srv\share\hub\'` | `/` turned to `\`, trailing slashes stripped; resolved folder equals it | Auto (`paths.test.ts`: "a valid absolute path is used with trailing slashes stripped") |
| TC-112 | Bad option falls back with a warning | `'hub'`, `'.\hub'`, `'\hub'`, `'C:hub'`, `'C:\'`, `42` | No path; warning mentions the default folder; default folder resolved; never throws | Auto (`paths.test.ts`: "relative, root-only or non-text values fall back with a warning") |
| TC-113 | Bus and presence paths follow the option (the archive folder is derived by `bus.ps1` from the bus path) | Configure `E:\Shared\Hub` | `bus.jsonl` and `presence\Hub.json` paths are under it | Auto (`paths.test.ts`: "bus and presence paths follow the configured folder") |
| TC-114 | Restore drops a join from another folder | Stored join with presence path under `C:\hub`, now resolving `D:\other` | `restoreJoin` returns `dropped`, stored join cleared once, no listener or heartbeat started | Auto (`plugin/hooks/restore.test.ts`: "a stored join under a different shared folder is dropped, not restored") |
| TC-115 | Same folder in another letter case restores | Folder `c:\HUB` against stored `C:\hub` path | `restored` | Auto (`restore.test.ts`: "the same folder in another letter case still restores") |
| TC-116 | README install steps work | Follow `plugin/README.md` "Install (F-015)" for two accounts, with and without `sharedFolder`; give one a bad value | Both accounts show the same log path in `/hub-history`; the bad value shows the one-line warning toast at session start (wired in `register.ts`, which has no unit test) | Manual (not yet run; `docs/test-runbook.md` section 9 "Before you start" for the two-account half, section 7.5 for the bad value) |

## F-016 — End-to-end proof, three accounts (Phase 5)

Manual only. The user runs it with three signed-in accounts and the plugin enabled (`docs/test-runbook.md` section 9; which accounts: PM-001). None has been run.

| ID | Scenario | Steps | Expected | How |
|----|----------|-------|----------|-----|
| TC-100 | Order, work, reply, act | Hub orders `Reports` to count the files in its working directory and reply with the count, then "done" | Reports starts a turn from `[Hub order #<id> to Reports] …`; the Hub starts a turn from `[Reply from Reports to #<id>] <count> done` and acts on it. Only the frame prefix and the `(reply with the send tool, replyTo "<id>")` line are fixed text; bodies are whatever the model wrote (examples); the count proves the work | Manual (not yet run) |
| TC-101 | Broadcast | Hub sends to `*` with `Reports` and `Tests` joined | Both workers start a turn from `[Hub order #<id> to <name>] …` and reply; the Hub gets one `[Reply from <name> to #<id>] …` from each and does not act on its own order. Only the frame prefix and the `(reply with the send tool, replyTo "<id>")` line are fixed text; bodies are examples | Manual (not yet run) |
| TC-102 | Unprompted worker message | A worker's model sends the Hub a message with no order to answer | The Hub starts a turn from `[Message from <name>] …` | Manual (not yet run) |
| TC-103 | Fake order ignored | `bus.ps1 append` an `order` line with `from: Hub` and a wrong `fromSession`, then one with `from: Tests` | The worker shows `Session Hub: Ignored an order from <name>: only the Hub can give orders` and starts no turn | Manual (not yet run) |
| TC-104 | Hub closes | Exit the Hub with `/exit` (so `session.end` runs) with both workers joined; record the method and when `presence\Hub.json` disappears | Each worker's status reads `Session Hub: <name> (worker) — Hub away — waiting` within about 10 s if Hub.json was removed at close, within about 40 s if it was still present (30 s stale `lastSeen` plus 10 s watcher tick); both stay joined | Manual (not yet run) |
| TC-105 | Taken name refused | A third session runs `/hub-join Reports`, then `/hub-join Hub`, while both are live | `Join refused: The name "<name>" is held by a live session. Choose another name.`; Reports.json's `sessionId` is still terminal 2's session id and `name` is still `Reports` (`Get-Content …\presence\Reports.json \| ConvertFrom-Json \| Select name, sessionId`) | Manual (not yet run) |
| TC-106 | Under 5 s | Time every message in TC-100 to TC-103 from its `bus.jsonl` line to the receiving session's turn or toast | Each under 5 s (NFR-001, FR-006) | Manual (not yet run) |
| TC-107 | No permission prompt | Run TC-100 to TC-105 in the normal permission mode in all three accounts | No prompt in any terminal (NFR-009) | Manual (not yet run) |

## Phase 4 integration (F-012 + F-013 + F-014 + F-017 + B-001 together)

Everything that needs the plugin enabled in real sessions is manual and the user will run it themselves later (`docs/test-runbook.md` section 7): TC-0E2, TC-0E8, TC-0EE and TC-0F9. None has been run. Until they are, the pane, the registered commands and the model's use of `send` are **unverified** in a live session.
