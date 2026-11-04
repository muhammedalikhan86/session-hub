export type MessageKind = 'order' | 'reply' | 'info' | 'join' | 'leave'

export type BusMessage = {
  id: string
  ts: string
  from: string
  fromSession: string
  to: string
  kind: MessageKind
  replyTo?: string
  body: string
}

export type MessageInput = {
  from: string
  fromSession: string
  to: string
  kind: MessageKind
  body: string
  replyTo?: string
}

export type BuildDeps = { now: () => number; random: () => number }

export type ParseResult =
  | { ok: true; message: BusMessage }
  | { ok: false; reason: string }

const KINDS: readonly string[] = ['order', 'reply', 'info', 'join', 'leave']
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export const BROADCAST = '*'

// 1-32 letters, digits, '-' or '_'. '*' is the broadcast address, never a name.
export const isValidSessionName = (name: unknown): name is string =>
  typeof name === 'string' && NAME_PATTERN.test(name)

// Process-wide so that two builds with the same clock reading and the same
// random value still differ. Wraps never matter: it only breaks ties.
let counter = 0

// Id scheme: <epoch ms base36>-<fromSession first 8 chars>-<counter base36>-<random base36>
//  - epoch ms orders ids roughly by time
//  - fromSession prefix separates sessions that build in the same millisecond
//  - counter separates calls within this process, even with a frozen clock and fixed random
//  - random (4 base36 chars) is extra separation against a counter restart (e.g. a reload)
export const buildMessage = (
  input: MessageInput,
  deps: BuildDeps,
): BusMessage => {
  const nowMs = deps.now()
  counter += 1
  const rand = Math.floor(deps.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
  const id = `${nowMs.toString(36)}-${input.fromSession.slice(0, 8)}-${counter.toString(36)}-${rand}`

  const message: BusMessage = {
    id,
    ts: new Date(nowMs).toISOString(),
    from: input.from,
    fromSession: input.fromSession,
    to: input.to,
    kind: input.kind,
    body: input.body,
  }

  if (input.replyTo !== undefined) message.replyTo = input.replyTo

  return message
}

// JSON.stringify escapes \n and \r inside strings, so the line never holds a raw
// line break. No trailing newline: the bus helper appends it.
export const serializeMessage = (m: BusMessage): string => {
  const line = JSON.stringify(m)

  if (line.includes('\n') || line.includes('\r')) {
    throw new Error('serialized message contains a raw line break')
  }

  return line
}

const fail = (reason: string): ParseResult => ({ ok: false, reason })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseLine = (line: string): ParseResult => {
  let data: unknown

  try {
    data = JSON.parse(line.replace(/\r+$/, ''))
  } catch {
    return fail('not valid JSON')
  }

  if (!isRecord(data)) return fail('not a JSON object')

  for (const key of ['id', 'ts', 'fromSession'] as const) {
    const value = data[key]

    if (typeof value !== 'string' || value === '') {
      return fail(`field "${key}" must be a non-empty string`)
    }
  }

  if (!isValidSessionName(data.from)) {
    return fail('field "from" must be a valid session name')
  }

  if (data.to !== BROADCAST && !isValidSessionName(data.to)) {
    return fail('field "to" must be a valid session name or "*"')
  }

  if (typeof data.kind !== 'string' || !KINDS.includes(data.kind)) {
    return fail('field "kind" is not a known kind')
  }

  if (typeof data.body !== 'string' || data.body === '') {
    return fail('field "body" must be a non-empty string')
  }

  if (data.replyTo !== undefined && typeof data.replyTo !== 'string') {
    return fail('field "replyTo" must be a string when present')
  }

  const message: BusMessage = {
    id: data.id as string,
    ts: data.ts as string,
    from: data.from,
    fromSession: data.fromSession as string,
    to: data.to as string,
    kind: data.kind as MessageKind,
    body: data.body,
  }

  if (typeof data.replyTo === 'string') message.replyTo = data.replyTo

  return { ok: true, message }
}
