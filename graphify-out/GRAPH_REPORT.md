> Component: session-hub plugin
> Built at commit: 5bf018f2d9f783241d622cf507223f697f2376ff + uncommitted working tree   Date: 2026-11-04
> Code roots: plugin
# Graph Report - C:/Users/muhammedali.khan/source/repos/session-hub/plugin  (2026-11-04)

## Corpus Check
- Corpus is ~6,932 words - fits in a single context window. You may not need a graph.

## Summary
- 107 nodes · 147 edges · 10 communities
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Path Resolution and Registration
- Message Model
- Bus Test Helpers
- Round-trip E2E Harness
- TypeScript Configuration
- Bus Helper Script
- Plugin Config and Type Refs
- Session Hub Overview

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 13 edges
2. `runSelfTest()` - 8 edges
3. `parseLine()` - 6 edges
4. `resolveSharedFolder()` - 6 edges
5. `include` - 5 edges
6. `Bus helper (bin/bus.ps1)` - 5 edges
7. `Invoke-BusTail()` - 4 edges
8. `buildMessage()` - 4 edges
9. `serializeMessage()` - 4 edges
10. `sharedFolderFor()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Self-test steps (a)-(f)` --references--> `runSelfTest()`  [INFERRED]
  README.md → hooks/selftest.ts
- `Shared folder (%USERPROFILE%\.claude-session-hub)` --shares_data_with--> `sharedFolderFor()`  [INFERRED]
  README.md → hooks/paths.ts
- `Bus helper append verb` --references--> `Invoke-BusAppend()`  [EXTRACTED]
  README.md → bin/bus.ps1
- `Bus helper tail verb` --references--> `Invoke-BusTail()`  [EXTRACTED]
  README.md → bin/bus.ps1
- `Shared folder (%USERPROFILE%\.claude-session-hub)` --references--> `resolveSharedFolder()`  [EXTRACTED]
  README.md → hooks/paths.ts

## Import Cycles
- None detected.

## Communities (10 total, 0 thin omitted)

### Community 0 - "Path Resolution and Registration"
Cohesion: 0.14
Nodes (20): EnvReader, resolveSharedFolder(), SHARED_FOLDER_NAME, sharedFolderFor(), register(), buildSteps(), formatRows(), message() (+12 more)

### Community 1 - "Message Model"
Cohesion: 0.16
Nodes (14): BROADCAST, BuildDeps, BusMessage, fail(), isRecord(), isValidSessionName(), KINDS, MessageInput (+6 more)

### Community 2 - "Bus Test Helpers"
Cohesion: 0.17
Nodes (6): Invoke-BusAppendProcess(), Start-AppendLoop(), Start-MutexHolder(), Start-Ps51(), Update-BusTail(), Wait-BusTail()

### Community 3 - "Round-trip E2E Harness"
Cohesion: 0.18
Nodes (13): buildMessage(), serializeMessage(), bodies, busLines, [busScript, busFile], deps, pos, posLines (+5 more)

### Community 4 - "TypeScript Configuration"
Cohesion: 0.14
Nodes (14): es2023, compilerOptions, jsx, jsxFactory, jsxFragmentFactory, lib, module, moduleResolution (+6 more)

### Community 5 - "Bus Helper Script"
Cohesion: 0.33
Nodes (8): Initialize-BusNative(), Invoke-BusAppend(), Invoke-BusTail(), Write-BusError(), Bus helper append verb, Bus helper (bin/bus.ps1), Bus helper tail verb, Bus roundtrip tests (TC-040)

### Community 6 - "Plugin Config and Type Refs"
Cohesion: 0.33
Nodes (5): .claude-plugin/types, hooks, tests, types, include

### Community 7 - "Session Hub Overview"
Cohesion: 0.50
Nodes (4): F-001 permission spike, Message model (build, serialise, parse), Self-test steps (a)-(f), Session Hub mod

## Knowledge Gaps
- **40 isolated node(s):** `deps`, `input`, `good`, `MessageKind`, `MessageInput` (+35 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `message()` connect `Path Resolution and Registration` to `Round-trip E2E Harness`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Why does `Bus helper (bin/bus.ps1)` connect `Bus Helper Script` to `Session Hub Overview`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `Bus roundtrip tests (TC-040)` connect `Bus Helper Script` to `Round-trip E2E Harness`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **What connects `deps`, `input`, `good` to the rest of the system?**
  _40 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Path Resolution and Registration` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._
- **Should `TypeScript Configuration` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._