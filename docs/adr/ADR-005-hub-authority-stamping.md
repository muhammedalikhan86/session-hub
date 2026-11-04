# ADR-005: The mod stamps the sender, and orders are checked against the live Hub claim

> Status: ACCEPTED
> Date: 2026-11-04
> Architecture: docs/architecture.md (v1)

## Context
Sessions act on orders with no human check, so only the real Hub may give orders, and the Hub's
identity must not be fakeable by accident (PRD constraint). Everything runs as the same Windows
user, so any program could write the file; the goal is to stop accidents, not a hostile program.

## Decision
The `send` tool takes only `to` and `body` from the model. The mod fills `from` (its joined name),
`fromSession` (its Claude Code session id) and `kind` (`order` only if it holds the name `Hub`,
else `reply`). A receiver acts on an `order` only if `from` is `Hub` **and** `fromSession` matches
the `sessionId` in the current, fresh `presence\Hub.json`.

## Alternatives Considered

| Option | Why not chosen |
|--------|-----------------|
| Trust the `from` field as written | A model or a typo could write `from: Hub` |
| Sign messages with a secret key | Every session runs as the same Windows user and could read the key; adds complexity without real protection here |
| A human approves each order | Ruled out by the PRD |

## Consequences
- Easy: a worker cannot become the Hub by mistake; a stale or restarted Hub's old orders are not
  honoured by sessions that see a new Hub claim.
- Harder: not a security boundary against software running as the same user (stated in NFR-005).

## Related
- Architecture section: 4 Message format, FR-004, FR-008, NFR-005
