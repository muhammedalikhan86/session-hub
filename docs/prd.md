# PRD: Session Hub — talking between Claude Code sessions

> Status: APPROVED
> Version: v4
> Last updated: 2026-11-04
> Discovery: Phase 0 not applicable — no incumbent process

## Problem Statement

One person often runs several Claude Code sessions on the same computer at once, sometimes signed
in to different Claude accounts. Today those sessions cannot talk to each other. To coordinate them
the person has to copy instructions and results between windows by hand. There is no single place
that directs the work, and no way for one session to hand work to another, or report back.

## Goals

- One session, the **Hub**, directs every other session on the computer. Only the Hub gives orders.
- The Hub can send a message to one named session, or to every active session at once.
- Each session notices a new message within about 5 seconds, and acts on it only if it is the
  addressee (or the message is for everyone).
- Worker sessions reply to the Hub, so a real back-and-forth conversation runs between them.
- The Hub always knows which sessions are alive right now.
- Works across the different Claude accounts signed in on the same computer.
- There is one shared, ordered record of every message, so the person can see what was said.

## Non-Goals

- Talking between different computers (same computer only, this version).
- More than one Hub at a time.
- A human approval step before a session acts on a message (sessions act right away).
- Workers giving orders — to the Hub or to each other. Workers only reply.
- Talking to anything that is not a Claude Code session (chat tools, email, other apps).
- Removing or editing single messages once sent.

## User Stories

- US-1: As the person running the Hub, I want to send an instruction to one named session so that
  it starts that work without me switching windows.
- US-2: As the person running the Hub, I want to send one message to all active sessions so that I
  can give everyone the same instruction at once.
- US-3: As a worker session, I want to notice an order from the Hub addressed to me (or to
  everyone) and act on it straight away, so that the Hub does not have to wait for a human.
- US-4: As a worker session, I want to ignore messages meant for other sessions so that I don't do
  someone else's work.
- US-5: As a worker session, I want to reply to the Hub so that the Hub gets results back.
- US-6: As the person running the Hub, I want to see which sessions are alive right now so that I
  only send work to sessions that can do it.
- US-7: As the person, I want to read the full history of messages so that I can follow and check
  what the sessions said to each other.
- US-8: As a session signed in to a different Claude account, I want to take part the same way as
  any other session.
- US-9: As the person starting a session, I want to give it a name when it joins (e.g. "Hub",
  "Reports") so that I and the Hub can address it by a name that means something.
- US-10: As a worker session, I want to treat any order that did not come from the Hub as
  information only, so that only the Hub can direct my work.
- US-11: As a worker session, if the Hub goes away, I want to finish what I'm doing and then wait,
  so that work in progress is not thrown away and nothing new starts without the Hub.
- US-12: As the person, I want to clear the message history when I choose, so that it does not
  grow forever.
- US-13: As the person starting a session, if the name I pick is already taken, I want to be told
  and asked for another, so that no session can take over another's name (above all, the Hub's).

## Success Metrics

- A message reaches its addressee within about 5 seconds of being sent.
- The Hub's list of live sessions is never more than 30 seconds out of date.
- 100% of messages are acted on only by the session(s) they were addressed to.
- 0 orders acted on that did not come from the Hub.
- No message is lost or seen twice by the same session, even when several are sent at once.

## Constraints & Assumptions

- Same computer only. Every session runs under the same Windows user.
- There is always exactly one Hub.
- Every session's name is unique, and is chosen by the person when the session joins. A name
  already in use by a live session (including "Hub") is refused, and the person picks another.
- A session acts on a Hub order with no human check. That is safe only because only the Hub may
  give orders, so the Hub's identity must not be something another session can fake by accident.
- The message history is shared by everyone on this computer, so it must not be used for secrets.
- The history is kept until the person clears it.

## Open Questions

| ID | Question | Owner | Resolved? |
|----|----------|-------|-----------|
| Q1 | Can any session give orders to any other, or only the Hub? | Muhammed | Yes — only the Hub. Workers only reply. |
| Q2 | How is a session's name chosen? | Muhammed | Yes — the person names it when it joins. |
| Q3 | How fast must a message arrive, and how fresh must the "who is alive" list be? | Muhammed | Yes — about 5 seconds; at most 30 seconds old. |
| Q4 | How long is the message history kept? | Muhammed | Yes — until the person clears it. |
| Q5 | If the Hub is not running, what do workers do? | Muhammed | Yes — finish current work, then wait. |
| Q6 | What happens if a second session tries to join with a name that is already taken (including "Hub")? | Muhammed | Yes — it is refused, and the person is asked for a different name. |

## Version History

| Version | Date | Change | Triggered By | Approved By |
|---------|------|--------|---------------|-------------|
| v1 | 2026-11-04 | Initial draft | — | — |
| v2 | 2026-11-04 | Resolved Q1–Q5: only the Hub gives orders; person names sessions; 5 s delivery / 30 s alive list; history kept until cleared; workers finish then wait when Hub is gone. Added US-9 to US-12, Q6. | Triage edit | — |
| v3 | 2026-11-04 | Resolved Q6: a taken name is refused and the person picks another. Added US-13; tightened the naming constraint. | Triage edit | — |
| v4 | 2026-11-04 | PRD approved | Gate approval | Muhammed Ali Khan |
