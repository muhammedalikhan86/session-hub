# ADR-006: Named mutex for writers, newline-framed polling for readers, rotate on clear

> Status: ACCEPTED
> Date: 2026-11-04
> Architecture: docs/architecture.md (v5)

## Context
ADR-002 made appends safe by opening `bus.jsonl` with an exclusive write share mode. Review found
three problems with the design around it:

1. `/hub-clear` emptied the file in place. A reader at offset 5,000 that next checks after the file
   was cleared **and** refilled past 5,000 would start mid-file: it skips the first new messages and
   reads half a line. Size alone cannot tell "cleared and refilled" from "grew".
2. Clearing by renaming the file is tangled with an exclusive-share lock, since the lock is the open
   file itself.
3. A reader must never act on a half-read line, even though writers write whole lines.

## Decision
**Writers.** Every change to `bus.jsonl` (append and clear) happens while holding one named Windows
mutex, `Local\ClaudeSessionHubBus` (all sessions share one Windows logon, so `Local\` reaches them
all). Inside the mutex an append opens the file, writes the whole line plus `\n` as one write,
flushes, and closes. An abandoned mutex (its holder crashed) is taken over normally. A writer waits
up to 2 s for the mutex, then fails with a clear error.

**Readers** take no lock. They read by byte offset, about once a second, from their offset to the
end of the file. They consume only up to the **last `\n`**; any bytes after it are left unread and the
offset is not moved past them. Each consumed line must also parse as JSON, or it is logged and
skipped. Change notifications are never the trigger. A reader cannot miss a line, because it never
waits for an event, only for its next pass from its own offset.

**Clear** (Hub only), inside the mutex: move `bus.jsonl` to `archive\bus-<UTC timestamp>.jsonl` and
create an empty `bus.jsonl`. Each reader remembers the file's identity (NTFS file ID) with its offset;
if the identity changed, or the size is below the offset, it first reads to the end of the archived
file it was on (by its new name) and then starts the new file from 0.

## Alternatives Considered

| Option | Why not chosen |
|--------|-----------------|
| Keep ADR-002's exclusive-share open as the lock | Works for append, but clear-by-rename then needs extra share flags and is easy to get wrong |
| A lock file created exclusively | Must be cleaned up by hand when a writer crashes; the mutex is released by Windows |
| A semaphore | Allows several holders; exactly one writer is wanted |
| Readers also take the mutex | Not needed for correctness with newline framing; adds waiting for every reader every second |
| Truncate on clear | The "cleared and refilled" case above loses messages |
| File change notifications as the trigger | Known to drop and merge events |

## Consequences
- Easy: one total order of lines; no torn lines; no missed lines, including across a clear;
  crashed writers never block others.
- Harder: readers track a file ID as well as an offset; the archive folder grows until someone
  deletes old archives (acceptable: the PRD keeps history until the person clears it).

## Related
- Architecture section: 3 Bus helper, 4 Data Flow, NFR-003
- Supersedes: ADR-002
