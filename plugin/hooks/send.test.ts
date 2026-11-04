import { expect, test } from 'claude-code/testing'

import type { BusMessage } from './message'
import { buildPresence } from './presence'
import { handleSend, SEND_DESCRIPTION } from './send'
import type { SendDeps } from './send'

const NOW = 1_700_000_000_000

const make = (name: string | undefined, overrides: Partial<SendDeps> = {}) => {
  const sent: BusMessage[] = []
  const deps: SendDeps = {
    state: {
      joining: false,
      joined: name
        ? ({
            presence: buildPresence(name, 'old-session', 'acct', NOW),
            listener: {},
          } as never)
        : undefined,
    },
    sessionId: async () => 'current-session-id',
    append: async m => {
      sent.push(m)
    },
    now: () => NOW,
    random: () => 0.5,
    ...overrides,
  }

  return { deps, sent }
}

test('unjoined is refused and nothing is appended', async () => {
  const { deps, sent } = make(undefined)
  const out = await handleSend({ to: 'a', body: 'hi' }, deps)

  expect('deny' in out && out.deny).toContain('not joined')
  expect(sent.length).toBe(0)
})

test('Hub sends an order to a name; stamps come from the mod', async () => {
  const { deps, sent } = make('Hub')
  const out = await handleSend(
    { to: 'alpha', body: 'do it', from: 'x', kind: 'reply', id: 'z', fromSession: 'q' } as never,
    deps,
  )

  expect(sent.length).toBe(1)
  expect(sent[0]?.kind).toBe('order')
  expect(sent[0]?.to).toBe('alpha')
  expect(sent[0]?.from).toBe('Hub')
  expect(sent[0]?.fromSession).toBe('current-session-id')
  expect(sent[0]?.id).not.toBe('z')
  expect(sent[0]?.ts).toBe(new Date(NOW).toISOString())
  expect('result' in out && out.result).toContain(sent[0]?.id ?? 'missing')
})

test('Hub can broadcast with *', async () => {
  const { deps, sent } = make('Hub')

  await handleSend({ to: '*', body: 'all' }, deps)
  expect(sent[0]?.to).toBe('*')
  expect(sent[0]?.kind).toBe('order')
})

test('Hub with a bad or self "to" is refused', async () => {
  for (const to of [undefined, '', 'bad name', 'a*', 42, 'Hub']) {
    const { deps, sent } = make('Hub')
    const out = await handleSend({ to, body: 'x' }, deps)

    expect('deny' in out).toBe(true)
    expect(sent.length).toBe(0)
  }
})

test('worker always replies to Hub whatever "to" says', async () => {
  const { deps, sent } = make('alpha')

  await handleSend({ to: 'beta', body: 'done' }, deps)
  expect(sent[0]?.to).toBe('Hub')
  expect(sent[0]?.kind).toBe('reply')
  expect(sent[0]?.from).toBe('alpha')
  expect('replyTo' in (sent[0] as object)).toBe(false)
})

test('worker passes replyTo through when given', async () => {
  const { deps, sent } = make('alpha')

  await handleSend({ body: 'done', replyTo: 'm-1' }, deps)
  expect(sent[0]?.replyTo).toBe('m-1')
})

test('empty or non-string body is refused', async () => {
  for (const body of ['', '   ', undefined, 5]) {
    const { deps, sent } = make('Hub')
    const out = await handleSend({ to: 'a', body }, deps)

    expect('deny' in out).toBe(true)
    expect(sent.length).toBe(0)
  }
})

test('a body with a newline is sent', async () => {
  const { deps, sent } = make('alpha')

  await handleSend({ body: 'a\nb' }, deps)
  expect(sent[0]?.body).toBe('a\nb')
})

test('an append failure is an error, never a success text', async () => {
  const { deps } = make('Hub', {
    append: async () => {
      throw new Error('bus append failed (exit 3): timeout')
    },
  })
  const out = await handleSend({ to: 'a', body: 'x' }, deps)

  expect('result' in out).toBe(false)
  expect('deny' in out && out.deny).toContain('exit 3')
  expect('deny' in out && out.deny).toContain('Not sent')
})

test('the description tells the model never to send secrets', () => {
  expect(SEND_DESCRIPTION).toContain('NEVER send secrets')
})
