import type { JoinedIdentity } from '../types'
import type { HeartbeatIdentity } from './heartbeat'
import { statusFor } from './join'
import type { JoinDeps, JoinState } from './join'
import { isLive, parsePresence } from './presence'
import type { Heartbeat } from './heartbeat'
import type { HubWatch } from './hub-watch'

export type RestoreDeps = Pick<JoinDeps, 'read' | 'now'> & {
  sessionId: string
  startHeartbeat: (id: HeartbeatIdentity) => Heartbeat
  setStatus: (text: string) => void
  startHubWatch?: () => HubWatch
  clearStored: () => void | Promise<void>
}

export type RestoreResult = 'none' | 'restored' | 'dropped'

// After a mod reload the module's variables are gone but `$.state` still says
// we are joined. Take the join back up only if the presence file is still ours
// and fresh; otherwise forget it, since someone else may hold the name now.
//
// F-009 TODO: the listener is not restarted here. It should resume from the
// stored `listenerPos` (`$.state` key `listenerPos`); until then a restored
// session has a heartbeat and a status line but receives nothing.
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

  state.joined = {
    presence: held,
    // No listener yet (F-009): never resolves, stop does nothing.
    listener: { ready: new Promise(() => {}), stop: () => {} },
  }
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

  return 'restored'
}
