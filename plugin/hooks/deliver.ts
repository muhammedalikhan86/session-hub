import type { BusMessage } from './message'
import { isLive, parsePresence } from './presence'

export type DeliverDeps = {
  // Read at message time: a re-join can change the name or role. Undefined once the
  // session has left, so a message that outlived its join is dropped.
  me: () => { name: string; role: 'hub' | 'worker' } | undefined
  // `$.prompt.submit`: starts its own turn once the session is idle. May reject.
  submit: (text: string) => Promise<unknown>
  // Shown to the person, never read by the model.
  notify: (text: string) => void
  log: (text: string) => void
  // "Is this order from the live Hub?" (FR-008, ADR-005): see `makeIsFromLiveHub`.
  isFromLiveHub: (message: BusMessage) => Promise<boolean>
}

export type HubCheckDeps = {
  // undefined when the file does not exist.
  read: (path: string) => Promise<string | undefined>
  now: () => number
  hubPath: string
}

// An order is acted on only if it names the Hub AND its `fromSession` is the
// `sessionId` in a fresh `presence\Hub.json`. A missing, unreadable, malformed or
// stale file is false, so a hand-written `from: Hub` line is never trusted.
export const makeIsFromLiveHub =
  (deps: HubCheckDeps) =>
  async (message: BusMessage): Promise<boolean> => {
    if (message.from !== 'Hub') return false

    let hub
    try {
      hub = parsePresence(await deps.read(deps.hubPath))
    } catch {
      return false
    }

    return hub !== undefined && isLive(hub, deps.now()) && hub.sessionId === message.fromSession
  }

const NOTICE_BODY_LIMIT = 120

// A notice is a one-line toast: the untrusted body is collapsed and cut short.
const preview = (body: string): string => {
  const line = body.replace(/\s+/g, ' ').trim()

  return line.length > NOTICE_BODY_LIMIT ? `${line.slice(0, NOTICE_BODY_LIMIT)}...` : line
}

// The body is appended untouched after a frame the mod writes, so a body that
// imitates a frame only ever appears after the real one.
export const orderFrame = (message: BusMessage, myName: string): string =>
  `[Hub order #${message.id} to ${myName}] ${message.body}\n` +
  `(reply with the send tool, replyTo "${message.id}")`

export const replyFrame = (message: BusMessage): string =>
  `[Reply from ${message.from} to #${message.replyTo}] ${message.body}`

// FR-004's unprompted case: a worker message that answers nothing.
export const unpromptedFrame = (message: BusMessage): string =>
  `[Message from ${message.from}] ${message.body}`

const frameFor = async (
  message: BusMessage,
  me: { name: string; role: 'hub' | 'worker' },
  deps: DeliverDeps,
): Promise<string | undefined> => {
  if (message.kind === 'order') {
    if (me.role === 'worker') {
      let live = false

      try {
        live = await deps.isFromLiveHub(message)
      } catch (error) {
        deps.log(`Session Hub: the Hub check failed (${String(error)}); order not queued`)
      }

      // The check awaited: the session may have left or re-joined under another name.
      const after = deps.me()

      if (after === undefined || after.name !== me.name) {
        deps.log(`Session Hub: not joined: dropped ${message.id}`)

        return undefined
      }

      if (live) return orderFrame(message, me.name)
    }

    deps.notify(`Ignored an order from ${message.from}: only the Hub can give orders`)

    return undefined
  }

  if (message.kind === 'reply' && me.role === 'hub') {
    return message.replyTo !== undefined ? replyFrame(message) : unpromptedFrame(message)
  }

  if (message.kind === 'join') {
    if (me.role === 'hub') deps.notify(`${message.from} joined`)
    else deps.log(`Session Hub: ${message.from} joined`)
  } else if (message.kind === 'leave') {
    if (me.role === 'hub') deps.notify(`${message.from} left`)
    else deps.log(`Session Hub: ${message.from} left`)
  } else if (message.kind === 'info') {
    deps.notify(`Info from ${message.from}: ${preview(message.body)}`)
  } else {
    deps.notify(`Ignored a reply from ${message.from}: only the Hub receives replies`)
  }

  return undefined
}

// Routes one delivered message (architecture §4). Never throws and never retries:
// the inbox already marked the id seen, and a possibly lost order is preferred
// to a duplicate run.
export const routeMessage = async (message: BusMessage, deps: DeliverDeps): Promise<void> => {
  try {
    const me = deps.me()

    if (me === undefined) {
      deps.log(`Session Hub: not joined: dropped ${message.id}`)

      return
    }

    const frame = await frameFor(message, me, deps)

    if (frame === undefined) return

    try {
      await deps.submit(frame)
    } catch (error) {
      deps.log(`Session Hub: could not deliver ${message.kind} ${message.id} (${String(error)})`)
      deps.notify(`Could not deliver ${message.kind} from ${message.from}; it was not retried`)
    }
  } catch (error) {
    deps.log(`Session Hub: could not route ${message.kind} ${message.id} (${String(error)})`)
  }
}
