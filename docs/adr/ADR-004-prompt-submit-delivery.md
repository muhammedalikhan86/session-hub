# ADR-004: Orders and replies become prompts through `$.prompt.submit`

> Status: ACCEPTED
> Date: 2026-11-04
> Architecture: docs/architecture.md (v1)

## Context
A session must act on a Hub order with no human check, including when it is idle. If it is busy,
it must finish what it is doing first (PRD US-11).

## Decision
A valid Hub order (and, in the Hub, a reply) is queued with `$.prompt.submit`, which starts a turn
of its own once the session is idle and is never folded into a running turn. The prompt text is
framed, e.g. `[Hub order #<id> to Reports] <body>`, so the model knows the source and the id to
reply to. Every other line the session receives is shown with a notice, which the model never reads.

## Alternatives Considered

| Option | Why not chosen |
|--------|-----------------|
| `$.session.append` a user row | Does not start a turn, so an idle session would never act |
| Pre-fill the prompt box with `$.prompt.fill` | Needs a human to press Enter; PRD says no human check |
| Notify only (`$.ui.notify`) | Same: needs a human |

## Consequences
- Easy: idle sessions wake up; busy sessions are never interrupted.
- Harder: a long queue can run an order late (risk A6). Each order costs a model turn.

## Related
- Architecture section: 2, 4 "What a session does", FR-007, FR-009
