# ADR-002: A PowerShell helper does every append and the tail

> Status: SUPERSEDED BY ADR-006
> Date: 2026-11-04
> Architecture: docs/architecture.md (v1)

## Context
The mod API's `$.fs` can only write a whole file, and reads at most 4 MiB at a time. Read-then-
write by several sessions at once would lose lines, and the log will pass 4 MiB.
`$.process.run` runs a command once; `$.process.spawn` runs one for the session's life and streams
its output.

## Decision
The mod ships `bus.ps1`. `append` opens `bus.jsonl` in append mode with an exclusive write lock,
retrying for up to 2 s if another writer holds it, and writes one whole line. `tail -From <offset>`
runs for the session's life, checks about once a second for new bytes past the offset, and prints
each complete new line; if the file shrank (cleared) it restarts from 0.

## Alternatives Considered

| Option | Why not chosen |
|--------|-----------------|
| `$.fs.read` + `$.fs.write` | Lost lines under concurrent writes; 4 MiB read cap |
| Poll `$.fs.stat` from a `$.clock.every` timer, then read | Still needs a whole-file read past 4 MiB |
| Node.js helper | Not guaranteed to be installed; PowerShell is on every Windows 11 machine |
| `FileSystemWatcher` events only | Known to drop events; a once-a-second check is simpler and meets the 5 s target |

## Consequences
- Easy: safe concurrent appends; reads only new bytes, so log size does not matter.
- Harder: one PowerShell process per session (about 60 MB, risk A5); each send costs a PowerShell
  start (about 0.3 to 0.5 s), well inside the 5 s target. Windows only, which matches the PRD.

## Related
- Architecture section: 3 Bus helper, NFR-001, NFR-003
