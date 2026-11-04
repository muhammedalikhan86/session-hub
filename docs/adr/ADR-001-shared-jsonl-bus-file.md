# ADR-001: Messages travel through one shared JSON Lines file

> Status: ACCEPTED
> Date: 2026-11-04
> Architecture: docs/architecture.md (v1)

## Context
Sessions on one computer, signed in to different Claude accounts, must exchange messages. Each
account has its own config folder, so nothing inside one config folder is visible to the others.
The person also wants one ordered record they can read.

## Decision
All messages are appended, one JSON object per line, to `bus.jsonl` in a shared folder
(`%USERPROFILE%\.claude-session-hub\` by default) that sits outside every account's config folder.

## Alternatives Considered

| Option | Why not chosen |
|--------|-----------------|
| Claude Code's built-in session messaging (`SendMessage`, `$.session.send`) | Works only between sessions of the same signed-in account; this product exists to cross accounts. Also keeps no single readable log |
| One inbox file per session | No single ordered record; a `*` message becomes N writes |
| A small local server (HTTP or named pipe) | Something extra to start and keep alive; more than the problem needs |
| `$.store` | Scoped to one account's config, so other accounts cannot see it |

## Consequences
- Easy: anyone can open the file and read what was said; no server to run.
- Harder: several writers share one file, so appends need care (ADR-002); the file grows until
  cleared.

## Related
- Architecture section: 1 System Context, 3 Shared folder
