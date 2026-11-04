import { buildPresence, parsePresence } from './presence'
import type { PresenceDeps } from './presence'

// Well inside STALE_MS (30 s): two missed beats still leave the name live.
export const HEARTBEAT_MS = 10_000

export type HeartbeatIdentity = {
  name: string
  sessionId: string
  account: string
  startedAt: string
  path: string
}

type FileDeps = Pick<PresenceDeps, 'read' | 'write' | 'now'>

export type HeartbeatDeps = FileDeps & {
  every: (ms: number, fn: () => void) => { cancel: () => void }
  // The presence file now holds another session: the name was taken over.
  onLost: () => void
  // Called once per failure streak, not on every failed beat.
  onFailure: (message: string) => void
}

export type Heartbeat = {
  // Cancels the timer and waits for a beat in flight, so no write lands after it.
  stop: () => Promise<void>
}

export type TickResult = 'beat' | 'lost' | 'stopped'

// A missing or malformed file holds nobody, so we still hold the name and
// recreate it; a file of another session means the name was taken over.
export const tick = async (
  deps: FileDeps,
  id: HeartbeatIdentity,
  isStopped: () => boolean = () => false,
): Promise<TickResult> => {
  const held = parsePresence(await deps.read(id.path))

  if (held && held.sessionId !== id.sessionId) return 'lost'

  if (isStopped()) return 'stopped'

  const next = buildPresence(
    id.name,
    id.sessionId,
    id.account,
    deps.now(),
    id.startedAt,
  )

  await deps.write(id.path, JSON.stringify(next, null, 2))

  return 'beat'
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Nothing thrown by a beat escapes the timer.
export const startHeartbeat = (
  deps: HeartbeatDeps,
  id: HeartbeatIdentity,
): Heartbeat => {
  let isStopped = false
  let inFlight: Promise<void> | undefined
  let isFailing = false

  const timer = deps.every(HEARTBEAT_MS, () => {
    if (isStopped || inFlight) return

    inFlight = beat().finally(() => {
      inFlight = undefined
    })
  })

  const halt = () => {
    isStopped = true
    timer.cancel()
  }

  const beat = async (): Promise<void> => {
    try {
      const result = await tick(deps, id, () => isStopped)

      isFailing = false

      if (result === 'lost') {
        halt()
        deps.onLost()
      }
    } catch (error) {
      if (isFailing) return

      isFailing = true

      try {
        deps.onFailure(messageOf(error))
      } catch {
        // reporting must not throw out of the timer either
      }
    }
  }

  return {
    stop: async () => {
      halt()
      await inFlight
    },
  }
}
