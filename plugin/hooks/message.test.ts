import { expect, test } from 'claude-code/testing'

import {
  buildMessage,
  isValidSessionName,
  parseLine,
  serializeMessage,
} from './message'
import type { BusMessage } from './message'

const deps = { now: () => 1_700_000_000_000, random: () => 0.5 }
const input = {
  from: 'alpha',
  fromSession: 'abcdef12-3456-7890',
  to: 'beta',
  kind: 'order' as const,
  body: 'run the tests',
}

const good: BusMessage = {
  id: 'x-1',
  ts: '2026-01-01T00:00:00.000Z',
  from: 'alpha',
  fromSession: 's1',
  to: 'beta',
  kind: 'info',
  body: 'hi',
}

const withField = (patch: Record<string, unknown>): string =>
  JSON.stringify({ ...good, ...patch })

test('TC-030 build, serialize, parse round trips', () => {
  const built = buildMessage({ ...input, replyTo: 'prev-id' }, deps)
  const parsed = parseLine(serializeMessage(built))

  expect(parsed).toEqual({ ok: true, message: built })
  expect(built.ts).toBe(new Date(1_700_000_000_000).toISOString())
  expect(built.replyTo).toBe('prev-id')
  expect(built.id).toContain('-abcdef12-')
})

test('a message without replyTo has no replyTo key', () => {
  const built = buildMessage(input, deps)

  expect('replyTo' in built).toBe(false)
  expect(serializeMessage(built)).not.toContain('replyTo')
})

test('TC-031 malformed lines are rejected without throwing', () => {
  const { to: _to, ...missingTo } = good
  const { fromSession: _fs, ...missingSession } = good
  const lines = [
    'not json',
    '',
    '{}',
    '[]',
    '42',
    'null',
    '"text"',
    JSON.stringify(missingTo),
    JSON.stringify(missingSession),
    withField({ kind: 'shout' }),
    withField({ body: 42 }),
    withField({ body: '' }),
    withField({ id: '' }),
    withField({ id: 7 }),
    withField({ from: 'bad name' }),
    withField({ from: '*' }),
    withField({ to: 'has space' }),
    withField({ to: '' }),
    withField({ replyTo: 5 }),
    withField({ replyTo: null }),
  ]

  for (const line of lines) {
    const result = parseLine(line)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
  }
})

test('every kind and the broadcast target are accepted', () => {
  for (const kind of ['order', 'reply', 'info', 'join', 'leave']) {
    expect(parseLine(withField({ kind })).ok).toBe(true)
  }

  expect(parseLine(withField({ to: '*' })).ok).toBe(true)
})

test('TC-032 newlines in the body never reach the line and survive parsing', () => {
  const body = 'one\ntwo\r\nthree\rfour'
  const line = serializeMessage(buildMessage({ ...input, body }, deps))

  expect(line.includes('\n')).toBe(false)
  expect(line.includes('\r')).toBe(false)

  const parsed = parseLine(line)

  expect(parsed.ok).toBe(true)
  if (parsed.ok) expect(parsed.message.body).toBe(body)
})

test('serialized lines have no trailing newline', () => {
  expect(serializeMessage(good).endsWith('\n')).toBe(false)
})

test('TC-033 10,000 builds with a frozen clock and fixed random have distinct ids', () => {
  const ids = new Set<string>()

  for (let i = 0; i < 10_000; i += 1) {
    ids.add(buildMessage(input, deps).id)
  }

  expect(ids.size).toBe(10_000)
})

test('a trailing carriage return on a line is tolerated', () => {
  const parsed = parseLine(`${serializeMessage(good)}\r`)

  expect(parsed).toEqual({ ok: true, message: good })
})

test('unknown extra fields are ignored and left out of the message', () => {
  const parsed = parseLine(withField({ futureField: 'x', nested: { a: 1 } }))

  expect(parsed).toEqual({ ok: true, message: good })
})

test('isValidSessionName', () => {
  for (const name of ['a', 'alpha', 'Alpha_1', 'my-session', 'x'.repeat(32)]) {
    expect(isValidSessionName(name)).toBe(true)
  }

  for (const name of [
    '*',
    '',
    'x'.repeat(33),
    'has space',
    'dot.name',
    'tab\t',
    'new\nline',
    'ünï',
  ]) {
    expect(isValidSessionName(name)).toBe(false)
  }
})
