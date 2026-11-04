> Component: session-hub plugin
> Built at commit: d03d6d7161f47d15d4cd49a8c783a7ae0c2d0708 + uncommitted working tree   Date: 2026-11-04
> Code roots: plugin/hooks, plugin/bin, plugin/tests
# Graph Report - C:\Users\muhammedali.khan\source\repos\session-hub\plugin  (2026-11-04)

## Corpus Check
- 37 files · ~24,234 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 263 nodes · 658 edges · 15 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Listener Inbox Filter
- Presence Heartbeat
- Bus Client Append
- Leave and Release
- Join Sequence
- Join Test Rig
- Shared Folder Paths
- Delivery and Authority Check
- PowerShell Test Helpers
- Send Tool
- Bus PowerShell Helper

## God Nodes (most connected - your core abstractions)
1. `register()` - 25 edges
2. `buildPresence()` - 23 edges
3. `presencePath()` - 18 edges
4. `join()` - 16 edges
5. `parsePresence()` - 15 edges
6. `buildMessage()` - 13 edges
7. `leaveSession()` - 11 edges
8. `parseLine()` - 11 edges
9. `serializeMessage()` - 10 edges
10. `claimName()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `sent` --calls--> `buildMessage()`  [EXTRACTED]
  tests/e2e-roundtrip.mjs → hooks/message.ts
- `sentBytes` --calls--> `serializeMessage()`  [EXTRACTED]
  tests/e2e-roundtrip.mjs → hooks/message.ts
- `hubFile()` --calls--> `buildPresence()`  [EXTRACTED]
  hooks/deliver.test.ts → hooks/presence.ts
- `Rig` --calls--> `buildPresence()`  [EXTRACTED]
  hooks/heartbeat.test.ts → hooks/presence.ts
- `append()` --calls--> `serializeMessage()`  [EXTRACTED]
  tests/e2e-join.mjs → hooks/message.ts

## Import Cycles
- None detected.

## Communities (15 total, 0 thin omitted)

### Community 0 - "Listener Inbox Filter"
Cohesion: 0.07
Nodes (39): createInbox(), HOLD_LIMIT, Inbox, InboxDeps, SEEN_LIMIT, joinRig(), line(), rig() (+31 more)

### Community 1 - "Presence Heartbeat"
Cohesion: 0.11
Nodes (28): FileDeps, HEARTBEAT_MS, HeartbeatDeps, HeartbeatIdentity, messageOf(), startHeartbeat(), ID, Rig (+20 more)

### Community 2 - "Bus Client Append"
Cohesion: 0.16
Nodes (26): appendArgv(), appendMessage(), ensureBusFile(), helperPath(), removeFile(), RunFn, runWithPath(), toBase64() (+18 more)

### Community 3 - "Leave and Release"
Cohesion: 0.11
Nodes (22): guardedLeave(), Joined, removeIfOurs(), CompleteJoinHooks, END_JOIN_WAIT_MS, endSession(), LeaveDeps, LeaveReport (+14 more)

### Community 4 - "Join Sequence"
Cohesion: 0.16
Nodes (18): Heartbeat, JoinDeps, JoinResult, JoinState, LeaveGuard, READY_TIMEOUT_MS, NOW, otherPresence (+10 more)

### Community 5 - "Join Test Rig"
Cohesion: 0.14
Nodes (20): ADR-0003, joinedAs(), join(), messageOf(), mine(), Rig, isValidSessionName(), buildPresence() (+12 more)

### Community 6 - "Shared Folder Paths"
Cohesion: 0.17
Nodes (17): EnvReader, resolveSharedFolder(), SHARED_FOLDER_NAME, sharedFolderFor(), buildSteps(), formatRows(), message(), POWERSHELL (+9 more)

### Community 7 - "Delivery and Authority Check"
Cohesion: 0.17
Nodes (14): ADR-0005, DeliverDeps, frameFor(), HubCheckDeps, makeIsFromLiveHub(), orderFrame(), preview(), replyFrame() (+6 more)

### Community 8 - "PowerShell Test Helpers"
Cohesion: 0.17
Nodes (6): Invoke-BusAppendProcess(), Start-AppendLoop(), Start-MutexHolder(), Start-Ps51(), Update-BusTail(), Wait-BusTail()

### Community 9 - "Send Tool"
Cohesion: 0.20
Nodes (12): BROADCAST, BuildDeps, handleSend(), HUB_NAME, messageOf(), refuse(), SEND_DESCRIPTION, SEND_SCHEMA (+4 more)

### Community 10 - "Bus PowerShell Helper"
Cohesion: 0.70
Nodes (4): Initialize-BusNative(), Invoke-BusAppend(), Invoke-BusTail(), Write-BusError()

## Knowledge Gaps
- **61 isolated node(s):** `NOW`, `isFromLiveHub`, `HubCheckDeps`, `ADR-0005`, `T0` (+56 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `buildMessage()` connect `Listener Inbox Filter` to `Send Tool`, `Leave and Release`, `Join Sequence`, `Join Test Rig`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `buildPresence()` connect `Join Test Rig` to `Presence Heartbeat`, `Bus Client Append`, `Leave and Release`, `Join Sequence`, `Delivery and Authority Check`, `Send Tool`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `presencePath()` connect `Bus Client Append` to `Presence Heartbeat`, `Leave and Release`, `Join Sequence`, `Join Test Rig`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `register()` (e.g. with `handleBusLine()` and `onPos()`) actually correct?**
  _`register()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `NOW`, `isFromLiveHub`, `HubCheckDeps` to the rest of the system?**
  _61 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Listener Inbox Filter` be split into smaller, more focused modules?**
  _Cohesion score 0.0730804810360777 - nodes in this community are weakly interconnected._
- **Should `Presence Heartbeat` be split into smaller, more focused modules?**
  _Cohesion score 0.1092436974789916 - nodes in this community are weakly interconnected._