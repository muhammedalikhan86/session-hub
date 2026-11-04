import { appendMessage } from './bus-client'
import type { RunFn } from './bus-client'
import type { Heartbeat } from './heartbeat'
import type { HubWatch } from './hub-watch'
import { startListener, tailArgv } from './listener'
import type { Listener, SpawnFn } from './listener'
import { BROADCAST, buildMessage, isValidSessionName } from './message'
import { checkFree, claimName, parsePresence, presencePath } from './presence'
import type { Presence, PresenceDeps } from './presence'
import type { ListenerPos } from '../types'

export type JoinDeps = PresenceDeps & {
  folder: string
  helper: string
  sessionId: string
  account: string
  spawn: SpawnFn
  run: RunFn
  random: () => number
  remove: (path: string) => Promise<void>
  // Resolves after `ms`; raced against the listener's first position.
  waitMs: (ms: number) => Promise<void>
  ensureBus: (busPath: string) => Promise<void>
  onLine: (line: string) => void
  onPos: (pos: ListenerPos) => void
}

export type Joined = { presence: Presence; listener: Listener }

export type JoinResult =
  | { ok: true; joined: Joined; status: string }
  | { ok: false; reason: string }

export const READY_TIMEOUT_MS = 10_000

export const statusFor = (p: Presence): string =>
  `Session Hub: ${p.name} (${p.role === 'hub' ? 'Hub' : 'worker'})`

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Removes the presence file only while it still holds this session: after a
// lost race or a stale takeover it belongs to someone else. Best effort: false
// when the read or the removal failed.
export const removeIfOurs = async (
  deps: Pick<JoinDeps, 'read' | 'remove'>,
  path: string,
  sessionId: string,
): Promise<boolean> => {
  try {
    const mine = parsePresence(await deps.read(path))?.sessionId === sessionId

    if (mine) await deps.remove(path)

    return true
  } catch {
    return false
  }
}

// Order matters (Architecture section 4): (1) name free, (2) listener at the
// log's current end and known to be running, (3) claim presence, (4) `join`
// line. The Hub reacts to the join line, so the listener must predate it.
export const join = async (
  deps: JoinDeps,
  name: string,
): Promise<JoinResult> => {
  if (!isValidSessionName(name)) {
    return {
      ok: false,
      reason: `"${name}" is not a valid session name: use 1 to 32 letters, digits, "-" or "_".`,
    }
  }

  const busPath = `${deps.folder}\\bus.jsonl`
  let free: Awaited<ReturnType<typeof checkFree>>

  try {
    free = await checkFree(deps, deps.folder, name, deps.sessionId)
  } catch (error) {
    return {
      ok: false,
      reason: `could not read the presence file for ${name}: ${messageOf(error)}`,
    }
  }

  if (!free.ok) return free

  try {
    await deps.ensureBus(busPath)
  } catch (error) {
    return {
      ok: false,
      reason: `could not prepare the bus file: ${messageOf(error)}`,
    }
  }

  const listener = startListener(
    deps.spawn,
    tailArgv(deps.helper, busPath, 'end'),
    { onLine: deps.onLine, onPos: deps.onPos },
  )

  const path = presencePath(deps.folder, name)
  let didWrite = false

  const fail = async (reason: string): Promise<JoinResult> => {
    listener.stop()

    if (didWrite) await removeIfOurs(deps, path, deps.sessionId)

    return { ok: false, reason }
  }

  const timedOut = Symbol('timed out')

  try {
    const first = await Promise.race([
      listener.ready,
      deps.waitMs(READY_TIMEOUT_MS).then(() => timedOut),
    ])

    if (first === timedOut) {
      return fail(
        `the listener did not report a position within ${READY_TIMEOUT_MS / 1000} s`,
      )
    }
  } catch (error) {
    return fail(`could not start the listener: ${messageOf(error)}`)
  }

  let claim: Awaited<ReturnType<typeof claimName>>

  try {
    claim = await claimName(
      {
        ...deps,
        write: async (p, text) => {
          didWrite = true
          await deps.write(p, text)
        },
      },
      deps.folder,
      name,
      deps.sessionId,
      deps.account,
    )
  } catch (error) {
    return fail(`could not claim the name: ${messageOf(error)}`)
  }

  if (!claim.ok) return fail(claim.reason)

  try {
    await appendMessage(
      deps.run,
      deps.helper,
      busPath,
      buildMessage(
        {
          from: name,
          fromSession: deps.sessionId,
          to: BROADCAST,
          kind: 'join',
          body: 'joined',
        },
        { now: deps.now, random: deps.random },
      ),
    )
  } catch (error) {
    return fail(`could not announce the join: ${messageOf(error)}`)
  }

  return {
    ok: true,
    joined: { presence: claim.presence, listener },
    status: statusFor(claim.presence),
  }
}

export type JoinState = {
  joined?: Joined
  joining: boolean
  leaving?: boolean
  // The id of the session that last ended. Only that id is barred from joining
  // or heartbeating: after a /clear the process goes on under a new id with no
  // session.start, so a bare flag would never be cleared.
  endedId?: string
  // Settles when the join in progress is completely done (never rejects).
  pending?: Promise<void>
  heartbeat?: Heartbeat
  hubWatch?: HubWatch
  // True while a worker sees no live Hub. Only a flag: nothing is stopped or cleared (F-010/F-011 read it).
  hubAway?: boolean
}

// One join at a time, and none once joined: a second concurrent call would
// orphan the first one's listener.
export const guardedJoin = async (
  state: JoinState,
  currentId: string,
  attempt: () => Promise<JoinResult>,
): Promise<JoinResult> => {
  if (state.endedId !== undefined && state.endedId === currentId) {
    return { ok: false, reason: 'the session is ending' }
  }

  if (state.leaving) return { ok: false, reason: 'a leave is in progress' }

  if (state.joined) {
    return {
      ok: false,
      reason: `already joined as ${state.joined.presence.name}. Use /hub-leave first to join under another name.`,
    }
  }

  if (state.joining) return { ok: false, reason: 'a join is already in progress' }

  state.joining = true

  const run = (async (): Promise<JoinResult> => {
    try {
      const result = await attempt()

      if (result.ok) state.joined = result.joined

      return result
    } finally {
      state.joining = false
    }
  })()

  state.pending = run.then(
    () => {},
    () => {},
  )

  return run
}

export type LeaveGuard<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string }

// One leave at a time, never alongside a join, and only while joined. The
// joined state is cleared whatever the attempt does: the name is being given up.
export const guardedLeave = async <T>(
  state: JoinState,
  attempt: (
    joined: Joined,
    heartbeat: Heartbeat | undefined,
    hubWatch: HubWatch | undefined,
  ) => Promise<T>,
): Promise<LeaveGuard<T>> => {
  if (state.joining) return { ok: false, reason: 'a join is in progress' }

  if (state.leaving) return { ok: false, reason: 'a leave is already in progress' }

  if (!state.joined) return { ok: false, reason: 'not joined' }

  state.leaving = true

  try {
    return {
      ok: true,
      value: await attempt(state.joined, state.heartbeat, state.hubWatch),
    }
  } finally {
    state.joined = undefined
    state.heartbeat = undefined
    state.hubWatch = undefined
    state.hubAway = undefined
    state.leaving = false
  }
}
