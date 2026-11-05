> Component: session-hub plugin
> Built at commit: d332e99472b787394705fe16d0edd8af75b7991e + uncommitted working tree   Date: 2026-11-04
> Code roots: plugin/hooks, plugin/bin, plugin/tests, plugin/tests/stress
# Graph Report - C:\Users\muhammedali.khan\source\repos\session-hub\plugin  (2026-11-04)

## Corpus Check
- 22 files · ~36,109 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 372 nodes · 863 edges · 21 communities (20 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Presence Heartbeat
- Bus Client and Hub Prompt
- Listener Inbox Filter
- Join and Leave Sequence
- Shared Folder Paths
- Plugin Build Configuration
- History Command
- Delivery and Authority Check
- Bus Client Scripts
- PowerShell Test Helpers
- Bus PowerShell Helper
- Concurrency Stress Test
- Plugin Type Declarations
- Roster Pane Test

## God Nodes (most connected - your core abstractions)
1. `buildPresence()` - 25 edges
2. `register()` - 20 edges
3. `parsePresence()` - 16 edges
4. `presencePath()` - 15 edges
5. `join()` - 15 edges
6. `buildMessage()` - 13 edges
7. `compilerOptions` - 13 edges
8. `parseLine()` - 12 edges
9. `JoinState` - 11 edges
10. `serializeMessage()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `sent` --calls--> `buildMessage()`  [EXTRACTED]
  tests/e2e-roundtrip.mjs → hooks/message.ts
- `sentBytes` --calls--> `serializeMessage()`  [EXTRACTED]
  tests/e2e-roundtrip.mjs → hooks/message.ts
- `append()` --calls--> `serializeMessage()`  [EXTRACTED]
  tests/e2e-join.mjs → hooks/message.ts
- `hubFile()` --calls--> `buildPresence()`  [EXTRACTED]
  hooks/deliver.test.ts → hooks/presence.ts
- `make()` --calls--> `buildPresence()`  [EXTRACTED]
  hooks/send.test.ts → hooks/presence.ts

## Import Cycles
- None detected.

## Communities (21 total, 1 thin omitted)

### Community 0 - "Presence Heartbeat"
Cohesion: 0.07
Nodes (58): ADR-0003, FileDeps, Heartbeat, HEARTBEAT_MS, HeartbeatDeps, HeartbeatIdentity, messageOf(), startHeartbeat() (+50 more)

### Community 1 - "Bus Client and Hub Prompt"
Cohesion: 0.08
Nodes (53): appendMessage(), ensureBusFile(), helperPath(), removeFile(), runWithPath(), HUB_PROMPT_ID, hubPromptText(), withHubSection() (+45 more)

### Community 2 - "Listener Inbox Filter"
Cohesion: 0.06
Nodes (48): createInbox(), HOLD_LIMIT, Inbox, InboxDeps, SEEN_LIMIT, joinRig(), line(), rig() (+40 more)

### Community 3 - "Join and Leave Sequence"
Cohesion: 0.08
Nodes (36): Rig, joinedAs(), guardedJoin(), guardedLeave(), Joined, JoinResult, JoinState, NOW (+28 more)

### Community 4 - "Shared Folder Paths"
Cohesion: 0.17
Nodes (17): EnvReader, resolveSharedFolder(), SHARED_FOLDER_NAME, sharedFolderFor(), buildSteps(), formatRows(), message(), POWERSHELL (+9 more)

### Community 5 - "Plugin Build Configuration"
Cohesion: 0.10
Nodes (19): .claude-plugin/types, es2023, hooks, tests, types, compilerOptions, jsx, jsxFactory (+11 more)

### Community 6 - "History Command"
Cohesion: 0.18
Nodes (17): lastArgv(), clockOf(), firstLine(), formatHistory(), handleHistory(), HISTORY_DEFAULT, HISTORY_MAX, HISTORY_USAGE (+9 more)

### Community 7 - "Delivery and Authority Check"
Cohesion: 0.17
Nodes (14): ADR-0005, DeliverDeps, frameFor(), HubCheckDeps, makeIsFromLiveHub(), orderFrame(), preview(), replyFrame() (+6 more)

### Community 8 - "Bus Client Scripts"
Cohesion: 0.25
Nodes (10): appendArgv(), clearArgv(), clearBus(), RunFn, toBase64(), ENSURE_BUS_SCRIPT, REMOVE_FILE_SCRIPT, ClearDeps (+2 more)

### Community 9 - "PowerShell Test Helpers"
Cohesion: 0.17
Nodes (6): Invoke-BusAppendProcess(), Start-AppendLoop(), Start-MutexHolder(), Start-Ps51(), Update-BusTail(), Wait-BusTail()

### Community 10 - "Bus PowerShell Helper"
Cohesion: 0.50
Nodes (8): Initialize-BusNative(), Invoke-BusAppend(), Invoke-BusClear(), Invoke-BusLast(), Invoke-BusTail(), Read-BusArchives(), Read-BusLines(), Write-BusError()

### Community 11 - "Concurrency Stress Test"
Cohesion: 0.60
Nodes (5): Get-ExpectedPad(), Get-FileLineCount(), Invoke-Iteration(), Read-WholeLines(), Start-StressWriter()

### Community 12 - "Plugin Type Declarations"
Cohesion: 0.33
Nodes (5): claude-code, JoinedIdentity, ListenerPos, PluginState, RosterRow

## Knowledge Gaps
- **93 isolated node(s):** `ParseResult`, `FileDeps`, `TickResult`, `CompleteJoinHooks`, `LeaveReport` (+88 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `types` connect `Plugin Build Configuration` to `Bus Client and Hub Prompt`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `register()` (e.g. with `handleBusLine()` and `onPos()`) actually correct?**
  _`register()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ParseResult`, `FileDeps`, `TickResult` to the rest of the system?**
  _93 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Presence Heartbeat` be split into smaller, more focused modules?**
  _Cohesion score 0.06811263318112633 - nodes in this community are weakly interconnected._
- **Should `Bus Client and Hub Prompt` be split into smaller, more focused modules?**
  _Cohesion score 0.0768361581920904 - nodes in this community are weakly interconnected._
- **Should `Listener Inbox Filter` be split into smaller, more focused modules?**
  _Cohesion score 0.06170598911070781 - nodes in this community are weakly interconnected._
- **Should `Join and Leave Sequence` be split into smaller, more focused modules?**
  _Cohesion score 0.07862679955703211 - nodes in this community are weakly interconnected._