> Component: session-hub plugin
> Built at commit: 4f42b4dcfde029abd329f6fe81e55da10e6c5221 + uncommitted working tree   Date: 2026-11-04
> Code roots: plugin
# Graph Report - C:\Users\muhammedali.khan\source\repos\session-hub\plugin  (2026-11-04)

## Corpus Check
- 21 files · ~19,251 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 258 nodes · 551 edges · 16 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Bus Message Model
- Heartbeat Lifecycle
- Join Sequence
- Join Guards and State
- Bus Client Append
- Shared Folder Paths
- TypeScript Build Config
- Hub Away and Heartbeat Concepts
- PowerShell Bus Test Helpers
- F-001 Spike and Self-test
- Bus PowerShell Script
- Plugin Type Declarations

## God Nodes (most connected - your core abstractions)
1. `register()` - 19 edges
2. `buildPresence()` - 17 edges
3. `presencePath()` - 16 edges
4. `compilerOptions` - 13 edges
5. `join()` - 13 edges
6. `parsePresence()` - 13 edges
7. `parseLine()` - 10 edges
8. `leaveSession()` - 10 edges
9. `claimName()` - 9 edges
10. `statusFor()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `sent` --calls--> `buildMessage()`  [EXTRACTED]
  tests/e2e-roundtrip.mjs → hooks/message.ts
- `sentBytes` --calls--> `serializeMessage()`  [EXTRACTED]
  tests/e2e-roundtrip.mjs → hooks/message.ts
- `Rig` --calls--> `buildPresence()`  [EXTRACTED]
  hooks/heartbeat.test.ts → hooks/presence.ts
- `stored()` --calls--> `parsePresence()`  [EXTRACTED]
  hooks/heartbeat.test.ts → hooks/presence.ts
- `joinedAs()` --calls--> `buildPresence()`  [EXTRACTED]
  hooks/hub-watch.test.ts → hooks/presence.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **/hub-join four-step sequence** — plugin_readme_hub_join, plugin_readme_presence_name_check, plugin_readme_bus_tail, plugin_readme_join_failure_rollback [EXTRACTED 1.00]

## Communities (16 total, 0 thin omitted)

### Community 0 - "Bus Message Model"
Cohesion: 0.07
Nodes (34): BuildDeps, buildMessage(), BusMessage, fail(), isRecord(), isValidSessionName(), KINDS, MessageInput (+26 more)

### Community 1 - "Heartbeat Lifecycle"
Cohesion: 0.09
Nodes (29): FileDeps, Heartbeat, HEARTBEAT_MS, HeartbeatDeps, HeartbeatIdentity, messageOf(), startHeartbeat(), ID (+21 more)

### Community 2 - "Join Sequence"
Cohesion: 0.12
Nodes (26): ADR-0003, join(), LeaveGuard, messageOf(), READY_TIMEOUT_MS, removeIfOurs(), Chunk, Listener (+18 more)

### Community 3 - "Join Guards and State"
Cohesion: 0.11
Nodes (27): guardedJoin(), guardedLeave(), JoinDeps, Joined, JoinResult, JoinState, NOW, otherPresence (+19 more)

### Community 4 - "Bus Client Append"
Cohesion: 0.16
Nodes (24): appendArgv(), appendMessage(), ensureBusFile(), helperPath(), removeFile(), RunFn, runWithPath(), toBase64() (+16 more)

### Community 5 - "Shared Folder Paths"
Cohesion: 0.17
Nodes (16): EnvReader, resolveSharedFolder(), SHARED_FOLDER_NAME, sharedFolderFor(), buildSteps(), formatRows(), POWERSHELL, runSelfTest() (+8 more)

### Community 6 - "TypeScript Build Config"
Cohesion: 0.11
Nodes (18): .claude-plugin/types, es2023, hooks, tests, compilerOptions, jsx, jsxFactory, jsxFragmentFactory (+10 more)

### Community 7 - "Hub Away and Heartbeat Concepts"
Cohesion: 0.14
Nodes (15): Away is only a flag; queued work kept (FR-012), Bus helper append verb, Bus helper (bin/bus.ps1), Bus helper tail verb, Heartbeat and /hub-leave (F-006), Hub away (F-007), /hub-join (F-005), Hub-away watcher (hooks/hub-watch.ts) (+7 more)

### Community 8 - "PowerShell Bus Test Helpers"
Cohesion: 0.17
Nodes (6): Invoke-BusAppendProcess(), Start-AppendLoop(), Start-MutexHolder(), Start-Ps51(), Update-BusTail(), Wait-BusTail()

### Community 9 - "F-001 Spike and Self-test"
Cohesion: 0.29
Nodes (7): F-001 permission spike, Manual test (F-001), Message model (build, serialise, parse), Mod reads USERPROFILE via $.env.get (no process.env), Self-test steps (a)-(f), Session Hub mod, Shared folder (%USERPROFILE%\.claude-session-hub)

### Community 10 - "Bus PowerShell Script"
Cohesion: 0.70
Nodes (4): Initialize-BusNative(), Invoke-BusAppend(), Invoke-BusTail(), Write-BusError()

### Community 11 - "Plugin Type Declarations"
Cohesion: 0.40
Nodes (4): claude-code, JoinedIdentity, ListenerPos, PluginState

## Knowledge Gaps
- **81 isolated node(s):** `BuildDeps`, `MessageInput`, `MessageKind`, `ParseResult`, `SelfTestApi` (+76 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `types` connect `Join Sequence` to `Heartbeat Lifecycle`, `TypeScript Build Config`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Why does `include` connect `TypeScript Build Config` to `Join Sequence`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **What connects `BuildDeps`, `MessageInput`, `MessageKind` to the rest of the system?**
  _81 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bus Message Model` be split into smaller, more focused modules?**
  _Cohesion score 0.07435897435897436 - nodes in this community are weakly interconnected._
- **Should `Heartbeat Lifecycle` be split into smaller, more focused modules?**
  _Cohesion score 0.0945945945945946 - nodes in this community are weakly interconnected._
- **Should `Join Sequence` be split into smaller, more focused modules?**
  _Cohesion score 0.12310606060606061 - nodes in this community are weakly interconnected._
- **Should `Join Guards and State` be split into smaller, more focused modules?**
  _Cohesion score 0.10752688172043011 - nodes in this community are weakly interconnected._