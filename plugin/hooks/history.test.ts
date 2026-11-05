import { expect, test } from 'claude-code/testing'

import { firstLine, formatHistory, handleHistory, parseHistoryCount } from './history'
import { serializeMessage } from './message'
import type { MessageKind } from './message'

const LOG = 'C:\\u\\.claude-session-hub\\bus.jsonl'
const T0 = new Date(2026, 0, 2, 3, 4, 5)

const line = (n: number, over: { body?: string; ts?: string; kind?: MessageKind; to?: string } = {}): string =>
  serializeMessage({
    id: `id-${n}`,
    ts: over.ts ?? new Date(T0.getTime() + n * 1000).toISOString(),
    from: 'Hub',
    fromSession: 's1',
    to: over.to ?? 'Reports',
    kind: over.kind ?? 'order',
    body: over.body ?? `message ${n}`,
  })

const lines = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => line(from + i))

test('F-013: shows at most the last 50 messages, oldest first, under a header with the path', () => {
  const out = formatHistory(lines(1, 60).join('\n') + '\n', 50, LOG).split('\n')

  expect(out[0]).toBe(`Last 50 messages (full log: ${LOG})`)
  expect(out).toHaveLength(51)
  expect(out[1]).toContain('message 11')
  expect(out[50]).toContain('message 60')
})

test('F-013: a row is time, from -> to, kind and the body', () => {
  const out = formatHistory(line(0) + '\n', 50, LOG).split('\n')

  expect(out[1]).toBe('03:04:05 Hub → Reports order: message 0')
})

test('F-013: a broadcast and a single message read naturally', () => {
  const out = formatHistory(line(0, { to: '*', kind: 'info' }), 50, LOG).split('\n')

  expect(out[0]).toBe(`Last 1 message (full log: ${LOG})`)
  expect(out[1]).toBe('03:04:05 Hub → * info: message 0')
})

test('F-013: only the first line of the body is shown, trimmed', () => {
  expect(firstLine('  \n  first  \nsecond')).toBe('first')
  expect(firstLine('a\r\nb')).toBe('a')
})

test('F-013: a long first line is cut at 100 characters with an ellipsis', () => {
  expect(firstLine('x'.repeat(250))).toBe('x'.repeat(100) + '…')
  expect(firstLine('y'.repeat(100))).toBe('y'.repeat(100))
})

test('F-013: an unreadable line is skipped and counted in a footer', () => {
  const raw = [line(1), 'not json', '{"id":"x"}', line(2)].join('\n') + '\n'
  const out = formatHistory(raw, 50, LOG).split('\n')

  expect(out).toHaveLength(4)
  expect(out[3]).toBe('2 lines could not be read')
  expect(formatHistory(['bad', line(1)].join('\n'), 50, LOG)).toContain('\n1 line could not be read')
})

test('F-013: a malformed ts shows ??:??:?? and does not crash', () => {
  const out = formatHistory(line(1, { ts: 'yesterday-ish' }), 50, LOG).split('\n')

  expect(out[1]).toBe('??:??:?? Hub → Reports order: message 1')
})

test('F-013: an empty log says so and names the path', () => {
  expect(formatHistory('', 50, LOG)).toBe(`No messages yet.\nFull log: ${LOG}`)
  expect(formatHistory('\n\n', 50, LOG)).toBe(`No messages yet.\nFull log: ${LOG}`)
  expect(formatHistory('junk\n', 50, LOG)).toBe(
    `No messages yet.\nFull log: ${LOG}\n1 line could not be read`,
  )
})

test('F-013: the count defaults to 50, is capped at 500 with a note, and refuses nonsense', () => {
  expect(parseHistoryCount('')).toEqual({ ok: true, count: 50 })
  expect(parseHistoryCount(' 20 ')).toEqual({ ok: true, count: 20 })
  expect(parseHistoryCount('9999')).toMatchObject({ ok: true, count: 500 })
  expect(parseHistoryCount('0')).toMatchObject({ ok: false })
  expect(parseHistoryCount('abc')).toMatchObject({ ok: false })
  expect(parseHistoryCount('-3')).toMatchObject({ ok: false })
})

test('F-013: the command asks the helper for the last N lines and formats the answer', async () => {
  let argv: readonly string[] = []
  const text = await handleHistory('20', {
    helper: 'h/bus.ps1',
    busPath: LOG,
    run: async a => {
      argv = a

      return { exitCode: 0, stdout: line(1) + '\n', stderr: '' }
    },
  })

  expect(argv.slice(-5)).toEqual(['last', '-Path', LOG, '-Count', '20'])
  expect(text).toContain('Hub → Reports order: message 1')
})

test('F-013: a capped count is announced, and a helper failure is reported', async () => {
  const ok = await handleHistory('9999', {
    helper: 'h',
    busPath: LOG,
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  })
  const bad = await handleHistory('', {
    helper: 'h',
    busPath: LOG,
    run: async () => ({ exitCode: 1, stdout: '', stderr: 'boom' }),
  })

  expect(ok.startsWith('Showing 500')).toBe(true)
  expect(bad).toBe('Could not read the log (exit 1): boom')
})
