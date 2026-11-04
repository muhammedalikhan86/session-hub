import { BROADCAST, buildMessage, isValidSessionName } from './message'
import type { BuildDeps, BusMessage } from './message'
import type { JoinState } from './join'

export const SEND_TOOL = 'send'
export const HUB_NAME = 'Hub'

export const SEND_DESCRIPTION =
  'Send a plain-text message to another Session Hub session. ' +
  'In the Hub: "to" is a session name or "*" for everyone, and the message is an order. ' +
  'In a worker: the message always goes to the Hub as a reply ("to" is ignored); ' +
  'set "replyTo" to the id of the message you are answering, or leave it out to start a message. ' +
  'Messages are plain text, readable by every session on this machine. ' +
  'NEVER send secrets, passwords, API keys, tokens or any other credentials.'

export const SEND_SCHEMA = {
  type: 'object',
  properties: {
    to: {
      type: 'string',
      description:
        'Hub only: the receiving session name, or "*" for all. Ignored in a worker (always the Hub).',
    },
    body: {
      type: 'string',
      description: 'The plain-text message. Never include secrets.',
    },
    replyTo: {
      type: 'string',
      description: 'Worker only: the id of the message this answers. Optional.',
    },
  },
  required: ['body'],
}

export type SendDeps = {
  state: Pick<JoinState, 'joined' | 'joining' | 'leaving'>
  sessionId: () => Promise<string>
  append: (message: BusMessage) => Promise<void>
} & BuildDeps

export type SendResult = { result: string } | { deny: string }

const refuse = (deny: string): SendResult => ({ deny })

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const handleSend = async (
  input: { to?: unknown; body?: unknown; replyTo?: unknown },
  deps: SendDeps,
): Promise<SendResult> => {
  const joined = deps.state.joined

  if (!joined || deps.state.leaving) {
    return refuse(
      'Not sent: this session has not joined Session Hub. Ask the user to run /hub-join <name>.',
    )
  }

  if (typeof input.body !== 'string' || input.body.trim() === '') {
    return refuse('Not sent: "body" must be a non-empty string.')
  }

  const { name, role } = joined.presence
  let to: string
  let kind: 'order' | 'reply'
  let replyTo: string | undefined

  if (role === 'hub') {
    kind = 'order'

    if (input.to !== BROADCAST && !isValidSessionName(input.to)) {
      return refuse(
        'Not sent: "to" must be a session name (1-32 letters, digits, - or _) or "*".',
      )
    }

    if (input.to === name) {
      return refuse('Not sent: the Hub cannot send a message to itself.')
    }

    to = input.to
  } else {
    kind = 'reply'
    to = HUB_NAME

    if (input.replyTo !== undefined && input.replyTo !== null) {
      if (typeof input.replyTo !== 'string' || input.replyTo === '') {
        return refuse('Not sent: "replyTo" must be a message id string when given.')
      }

      replyTo = input.replyTo
    }
  }

  const message = buildMessage(
    {
      from: name,
      fromSession: await deps.sessionId(),
      to,
      kind,
      body: input.body,
      ...(replyTo !== undefined ? { replyTo } : {}),
    },
    deps,
  )

  try {
    await deps.append(message)
  } catch (error) {
    return refuse(
      `Not sent: the message could not be written to the bus (${messageOf(error)}).`,
    )
  }

  return { result: `Sent ${kind} to ${to} (id ${message.id}).` }
}
