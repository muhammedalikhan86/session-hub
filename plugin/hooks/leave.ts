import { appendMessage } from './bus-client'
import type { RunFn } from './bus-client'
import type { Heartbeat } from './heartbeat'
import type { HubWatch } from './hub-watch'
import { guardedLeave, removeIfOurs } from './join'
import type { JoinDeps, Joined, JoinState } from './join'
import { BROADCAST, buildMessage } from './message'
import { presencePath } from './presence'

export type LeaveDeps = Pick<JoinDeps, 'read' | 'remove' | 'now' | 'random'> & {
  folder: string
  helper: string
  run: RunFn
}

export type LeaveReport = {
  // Set when the `leave` line could not be appended; the name is released anyway.
  appendError?: string
  isRemoveFailed: boolean
}

type Releasing = {
  name: string
  sessionId: string
  presencePath: string
  listener: { stop: () => void }
  heartbeat: Heartbeat | undefined
  hubWatch?: HubWatch
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Order matters: nothing may refresh `lastSeen` after the name is given up
// (heartbeat first), the `leave` line needs the listener still running, and
// the presence file goes last. Never throws.
export const release = async (
  target: Releasing,
  deps: LeaveDeps,
): Promise<LeaveReport> => {
  const report: LeaveReport = { isRemoveFailed: false }

  try {
    await target.heartbeat?.stop()
  } catch {
    // a beat that failed has nothing more to say here
  }

  try {
    await target.hubWatch?.stop()
  } catch {
    // a check that failed has nothing more to say here
  }

  try {
    await appendMessage(
      deps.run,
      deps.helper,
      `${deps.folder}\\bus.jsonl`,
      buildMessage(
        {
          from: target.name,
          fromSession: target.sessionId,
          to: BROADCAST,
          kind: 'leave',
          body: 'left',
        },
        { now: deps.now, random: deps.random },
      ),
    )
  } catch (error) {
    report.appendError = messageOf(error)
  }

  target.listener.stop()
  report.isRemoveFailed = !(await removeIfOurs(
    deps,
    target.presencePath,
    target.sessionId,
  ))

  return report
}

export const leaveText = (name: string, report: LeaveReport): string => {
  const problems: string[] = []

  if (report.appendError) {
    problems.push(`the leave line could not be written (${report.appendError})`)
  }

  if (report.isRemoveFailed) {
    problems.push(
      'the presence file could not be removed (the name frees itself within 30 s)',
    )
  }

  return problems.length === 0
    ? `Left Session Hub (was ${name}).`
    : `Left Session Hub (was ${name}), but ${problems.join(' and ')}.`
}

// /hub-leave and session.end share this: guard, release, then let the caller
// clear what it keeps ($.state, status line).
export const leaveSession = async (
  state: JoinState,
  deps: LeaveDeps,
  afterRelease: () => Promise<void> | void,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
  const guarded = await guardedLeave(state, async (joined, heartbeat, hubWatch) => {
    const name = joined.presence.name
    const report = await release(
      {
        name,
        sessionId: joined.presence.sessionId,
        presencePath: presencePath(deps.folder, name),
        listener: joined.listener,
        heartbeat,
        hubWatch,
      },
      deps,
    )

    try {
      await afterRelease()
    } catch {
      // the name is already released; the status line is cosmetic
    }

    return leaveText(name, report)
  })

  return guarded.ok ? { ok: true, text: guarded.value } : guarded
}

// One third of session.end's 1.5 s bound, leaving the other 1 s for the release,
// whose leave-line append starts a PowerShell process. A join slower than this
// finishes on its own and releases itself (see `completeJoin`), so correctness
// does not depend on the value.
export const END_JOIN_WAIT_MS = 500

// session.end: refuse new joins, give a join in progress a bounded moment to
// settle, then release what is joined. If the join outlasts the wait it sees
// its own id in `endedId` in `completeJoin` and releases itself. `endedId` is the
// ending session's id: a later session under another id (after /clear) joins freely.
export const endSession = async (
  state: JoinState,
  endedId: string,
  deps: LeaveDeps,
  afterRelease: () => Promise<void> | void,
  sleep: (ms: number) => Promise<void>,
): Promise<void> => {
  state.endedId = endedId

  if (state.joining && state.pending) {
    await Promise.race([state.pending, sleep(END_JOIN_WAIT_MS)])
  }

  if (state.joining) return

  await leaveSession(state, deps, afterRelease)
}

export type CompleteJoinHooks = {
  store: () => Promise<unknown>
  clearStored: () => Promise<void> | void
  startHeartbeat: () => Heartbeat
  // Called for a worker only; the Hub has nobody to wait for.
  startHubWatch?: () => HubWatch
}

// The last step of a join, run inside its guard. Everything after the store is
// synchronous, so `endedId` cannot change between the check and the heartbeat
// start. Returns false when the join's own session ended meanwhile: the name is released
// at once and no heartbeat ever runs.
export const completeJoin = async (
  state: JoinState,
  joined: Joined,
  deps: LeaveDeps,
  hooks: CompleteJoinHooks,
): Promise<boolean> => {
  await Promise.resolve(hooks.store()).catch(() => {})

  if (state.endedId === joined.presence.sessionId) {
    const name = joined.presence.name

    await release(
      {
        name,
        sessionId: joined.presence.sessionId,
        presencePath: presencePath(deps.folder, name),
        listener: joined.listener,
        heartbeat: undefined,
      },
      deps,
    )
    await Promise.resolve(hooks.clearStored()).catch(() => {})

    return false
  }

  state.heartbeat = hooks.startHeartbeat()
  state.joined = joined

  if (joined.presence.role === 'worker' && hooks.startHubWatch) {
    state.hubWatch = hooks.startHubWatch()
  }

  return true
}

export type LostHooks = {
  clearStored: () => void | Promise<void>
  notify: (text: string) => void
}

// The heartbeat found another session in our presence file: stop everything
// and say so. Skipped while a leave is releasing the name anyway.
export const markLost = async (
  state: JoinState,
  hooks: LostHooks,
): Promise<void> => {
  if (state.leaving || !state.joined) return

  const name = state.joined.presence.name

  const hubWatch = state.hubWatch

  state.joined.listener.stop()
  state.joined = undefined
  state.heartbeat = undefined
  state.hubWatch = undefined
  state.hubAway = undefined
  // stop() is started first but awaited last: a join completing during the
  // await must not have its stored record erased by the clear below.
  const stopping = hubWatch?.stop().catch(() => {})

  await hooks.clearStored()
  await stopping
  hooks.notify(
    `Session Hub: the name "${name}" was taken over by another session (this one was idle for over 30 s). Run /hub-join again.`,
  )
}
