import { HEARTBEAT_MS } from './heartbeat'
import { statusFor } from './join'
import { isLive, parsePresence } from './presence'
import type { Presence, PresenceDeps } from './presence'

export const HUB_AWAY_TEXT = 'Hub away — waiting'

export type HubWatchDeps = Pick<PresenceDeps, 'read' | 'now'> & {
  every: (ms: number, fn: () => void) => { cancel: () => void }
  // Called on the first check and then only when away/present changes.
  onChange: (isAway: boolean) => void
}

export type HubWatch = {
  // Cancels the timer and waits for a check in flight, so nothing is reported after it.
  stop: () => Promise<void>
}

export const statusWith = (p: Presence, isAway: boolean): string =>
  isAway ? `${statusFor(p)} — ${HUB_AWAY_TEXT}` : statusFor(p)

// Away = the file is missing, unreadable or malformed, or its `lastSeen` is stale.
export const isHubAway = async (
  deps: Pick<HubWatchDeps, 'read' | 'now'>,
  hubPath: string,
): Promise<boolean> => {
  try {
    const hub = parsePresence(await deps.read(hubPath))

    return !hub || !isLive(hub, deps.now())
  } catch {
    return true
  }
}

// Worker only (the caller never starts it for the Hub). Nothing thrown by a
// check escapes the timer.
export const startHubWatch = (
  deps: HubWatchDeps,
  hubPath: string,
): HubWatch => {
  let isStopped = false
  let inFlight: Promise<void> | undefined
  let last: boolean | undefined

  const check = async (): Promise<void> => {
    const isAway = await isHubAway(deps, hubPath)

    if (isStopped || isAway === last) return

    last = isAway

    try {
      deps.onChange(isAway)
    } catch {
      // reporting must not throw out of the timer
    }
  }

  const run = () => {
    if (isStopped || inFlight) return

    inFlight = check().finally(() => {
      inFlight = undefined
    })
  }

  const timer = deps.every(HEARTBEAT_MS, run)

  run()

  return {
    stop: async () => {
      isStopped = true
      timer.cancel()
      await inFlight
    },
  }
}
