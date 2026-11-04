# ADR-003: Presence and name ownership live in one heartbeat file per session

> Status: ACCEPTED
> Date: 2026-11-04
> Architecture: docs/architecture.md (v1)

## Context
The Hub must know who is alive within 30 s, and a name already held by a live session must be
refused. Heartbeats every 10 s from 10 sessions would add about 86,000 lines a day to the message log.

## Decision
Each joined session owns `presence\<name>.json` (`name, sessionId, account, role, startedAt,
lastSeen`) and rewrites it every 10 s. Alive means `lastSeen` under 30 s old. A name is free if its
file is missing or stale. Join writes the file, waits briefly, re-reads it, and backs off if another
session's id is now there. Leave deletes it. Join and leave are also logged on the bus as `info`
lines, so the history shows them.

> **Amended 2026-11-04 (Architecture v6):** join and leave are logged with their own `kind`
> values, `join` and `leave`, not as `info` lines. The join order in Architecture §4 (v4) made the
> join line the signal the Hub reads, so it needs its own kind. The rest of this decision stands.

## Alternatives Considered

| Option | Why not chosen |
|--------|-----------------|
| Heartbeat lines on the bus | Floods the log the person reads |
| Presence held in memory by the Hub only | Lost when the Hub restarts; workers can't check a name is free without the Hub |
| Checking whether a session's process is running | No clean way from a mod to map a name to a process |

## Consequences
- Easy: presence is cheap and self-healing; a crashed session's name frees itself after 30 s.
- Harder: a tiny race when two sessions claim the same name at once (risk A3, handled by re-read).

## Related
- Architecture section: 3 Presence store, FR-001, FR-002, FR-010
