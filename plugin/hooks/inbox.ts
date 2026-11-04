import { parseLine } from './message'
import type { BusMessage } from './message'
import type { ListenerPos } from '../types'

// The last 500 delivered ids are remembered. A reload replays at most one batch
// from the last stored `#pos`, far fewer than this; the bound keeps `$.state`
// from growing on a bus that runs for days.
export const SEEN_LIMIT = 500

// Lines that arrive while a join is still completing (no name yet) are held, not
// dropped. The bound keeps a stuck join from growing the buffer without limit.
export const HOLD_LIMIT = 500

export type InboxDeps = {
  // Read at line time: a re-join can change the name.
  me: () => { name: string; sessionId: string } | undefined
  // True while a join is in progress: lines that arrive before `me()` is known are held.
  joining: () => boolean
  // Stores the listener position; only ever called after the lines before it were handled.
  storePos: (pos: ListenerPos) => Promise<unknown>
  // Stores the seen ids; awaited before `onMessage`, so a reload after delivery can never re-deliver.
  persist: (ids: string[]) => Promise<unknown>
  // Awaited inside the serial chain, so a slow handler keeps arrival order.
  onMessage: (message: BusMessage) => Promise<void> | void
  log: (text: string) => void
}

export type Inbox = {
  // Lines are handled strictly in arrival order. Never rejects.
  handle: (line: string) => Promise<void>
  // A batch's position, stored in order behind that batch's lines. Kept back while
  // held lines are unprocessed (or the join is pending) and stored once they are.
  position: (pos: ListenerPos) => Promise<void>
  // The join completed: process the held lines, in order, ahead of any later line.
  release: () => Promise<void>
  // The join failed or was released: the held lines and the held position are dropped.
  discard: () => void
}

export const createInbox = (
  deps: InboxDeps,
  initialSeen: readonly string[] = [],
): Inbox => {
  // A Set iterates in insertion order, so the first key is the oldest.
  const seen = new Set(initialSeen.slice(-SEEN_LIMIT))
  let tail: Promise<void> = Promise.resolve()

  const held: BusMessage[] = []
  let heldPos: ListenerPos | undefined

  const deliver = async (
    message: BusMessage,
    me: { name: string; sessionId: string },
  ): Promise<void> => {
    if (message.from === me.name || message.fromSession === me.sessionId) return
    if (message.to !== me.name && message.to !== '*') return
    if (seen.has(message.id)) return

    seen.add(message.id)

    if (seen.size > SEEN_LIMIT) {
      const oldest = seen.values().next().value

      if (oldest !== undefined) seen.delete(oldest)
    }

    try {
      await deps.persist([...seen])
    } catch (error) {
      // Delivered anyway: a lost order is worse than a possible repeat after a reload.
      deps.log(`Session Hub: could not store the seen ids (${String(error)})`)
    }

    try {
      await deps.onMessage(message)
    } catch (error) {
      deps.log(`Session Hub: could not handle ${message.id} (${String(error)})`)
    }
  }

  // Held lines go first, so arrival order is kept across the join.
  const drain = async (me: { name: string; sessionId: string }): Promise<void> => {
    while (held.length > 0) {
      const next = held.shift()

      if (next) await deliver(next, me)
    }
  }

  const storePos = async (pos: ListenerPos): Promise<void> => {
    try {
      await deps.storePos(pos)
    } catch (error) {
      deps.log(`Session Hub: could not store the position (${String(error)})`)
    }
  }

  const storeHeldPos = async (): Promise<void> => {
    const pos = heldPos

    heldPos = undefined

    if (pos) await storePos(pos)
  }

  const consider = async (line: string): Promise<void> => {
    const parsed = parseLine(line)

    if (!parsed.ok) {
      deps.log(`Session Hub: skipped a bus line (${parsed.reason})`)

      return
    }

    const message = parsed.message
    const me = deps.me()

    if (!me) {
      if (!deps.joining()) return

      held.push(message)

      if (held.length > HOLD_LIMIT) {
        held.shift()
        deps.log('Session Hub: the join is taking long; the oldest held bus line was dropped')
      }

      return
    }

    await drain(me)
    await deliver(message, me)
  }

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    tail = tail.then(task).catch(error => {
      deps.log(`Session Hub: a bus line failed (${String(error)})`)
    })

    return tail
  }

  const handle = (line: string): Promise<void> => enqueue(() => consider(line))

  const position = (pos: ListenerPos): Promise<void> =>
    enqueue(async () => {
      const me = deps.me()

      if (me && held.length === 0) {
        heldPos = undefined
        await storePos(pos)
      } else if (deps.joining()) {
        heldPos = pos
      }
    })

  const release = (): Promise<void> =>
    enqueue(async () => {
      const me = deps.me()

      if (!me) return

      await drain(me)
      await storeHeldPos()
    })

  const discard = (): void => {
    held.length = 0
    heldPos = undefined
  }

  return { handle, position, release, discard }
}
