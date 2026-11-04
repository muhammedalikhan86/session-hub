import type { JoinedIdentity, ListenerPos } from '../types'
import type { HeartbeatIdentity } from './heartbeat'
import { READY_TIMEOUT_MS, statusFor } from './join'
import type { JoinDeps, JoinState } from './join'
import { startListener, tailArgv } from './listener'
import type { Listener } from './listener'
import { isLive, parsePresence } from './presence'
import type { Heartbeat } from './heartbeat'
import type { HubWatch } from './hub-watch'

export type RestoreDeps = Pick<
  JoinDeps,
  'read' | 'now' | 'spawn' | 'helper' | 'waitMs' | 'onLine' | 'onPos'
> & {
  busPath: string
  storedPos?: ListenerPos | null
  sessionId: string
  startHeartbeat: (id: HeartbeatIdentity) => Heartbeat
  setStatus: (text: string) => void
  startHubWatch?: () => HubWatch
  clearStored: () => void | Promise<void>
}

export type RestoreResult = 'none' | 'restored' | 'dropped'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Restarts the listener at the stored position (or the end) and waits for it to
// report one. Returns the failure text, or undefined when it runs. A failure
// leaves the join and heartbeat in place with the no-op placeholder listener.
const resumeListener = async (
  state: JoinState,
  placeholder: Listener,
  deps: RestoreDeps,
): Promise<string | undefined> => {
  const pos = deps.storedPos
  const from = pos ? `${pos.fileId}:${pos.offset}` : 'end'
  let listener: Listener | undefined

  try {
    listener = startListener(
      deps.spawn,
      tailArgv(deps.helper, deps.busPath, from),
      { onLine: deps.onLine, onPos: deps.onPos },
    )

    // In place at once, so a leave during the wait stops it.
    if (state.joined?.listener === placeholder) state.joined.listener = listener

    const timedOut = Symbol('timed out')
    const first = await Promise.race([
      listener.ready,
      deps.waitMs(READY_TIMEOUT_MS).then(() => timedOut),
    ])

    if (first === timedOut) {
      throw new Error(
        `no position within ${READY_TIMEOUT_MS / 1000} s`,
      )
    }

    return undefined
  } catch (error) {
    listener?.stop()

    if (state.joined && state.joined.listener === listener) {
      state.joined.listener = placeholder
    }

    return messageOf(error)
  }
}

// After a mod reload the module's variables are gone but `$.state` still says
// we are joined. Take the join back up only if the presence file is still ours
// and fresh; otherwise forget it, since someone else may hold the name now.
// The listener resumes from the stored `listenerPos`; the seen ids (inbox.ts)
// catch the lines replayed since that position.
export const restoreJoin = async (
  state: JoinState,
  stored: JoinedIdentity | null | undefined,
  deps: RestoreDeps,
): Promise<RestoreResult> => {
  if (!stored || state.joined) return 'none'

  let held: ReturnType<typeof parsePresence>

  try {
    held = parsePresence(await deps.read(stored.presencePath))
  } catch {
    return 'none'
  }

  if (
    !held ||
    held.sessionId !== stored.sessionId ||
    stored.sessionId !== deps.sessionId ||
    !isLive(held, deps.now())
  ) {
    await deps.clearStored()

    return 'dropped'
  }

  // Joined before the listener starts, so a replayed line finds the identity.
  const placeholder: Listener = { ready: new Promise(() => {}), stop: () => {} }

  state.joined = { presence: held, listener: placeholder }
  state.heartbeat = deps.startHeartbeat({
    name: stored.name,
    sessionId: stored.sessionId,
    account: stored.account,
    startedAt: stored.startedAt,
    path: stored.presencePath,
  })
  deps.setStatus(statusFor(held))

  if (held.role === 'worker' && deps.startHubWatch) {
    state.hubWatch = deps.startHubWatch()
  }

  const failure = await resumeListener(state, placeholder, deps)

  if (failure) {
    deps.setStatus(`${statusFor(held)} - not receiving: ${failure}`)
  }

  return 'restored'
}
