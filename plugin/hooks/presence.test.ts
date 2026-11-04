import { expect, test } from 'claude-code/testing'

import {
  accountFrom,
  buildPresence,
  claimName,
  presencePath,
  roleFor,
} from './presence'
import type { PresenceDeps } from './presence'

const FOLDER = 'C:\\hub'
const NOW = Date.parse('2026-11-04T10:00:00.000Z')

const memory = (files: Map<string, string>): PresenceDeps => ({
  read: async path => {
    await Promise.resolve()

    return files.get(path)
  },
  write: async (path, text) => {
    await Promise.resolve()
    files.set(path, text)
  },
  sleep: async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  },
  now: () => NOW,
})

const put = (
  files: Map<string, string>,
  name: string,
  sessionId: string,
  ageMs: number,
) =>
  files.set(
    presencePath(FOLDER, name),
    JSON.stringify(buildPresence(name, sessionId, 'acct', NOW - ageMs)),
  )

test('role is hub only for the exact name Hub; account is the config dir basename', async () => {
  expect(roleFor('Hub')).toBe('hub')
  expect(roleFor('hub')).toBe('worker')
  expect(roleFor('alpha')).toBe('worker')
  expect(accountFrom('C:\\Users\\me\\.claude-neeraj\\')).toBe('.claude-neeraj')
  expect(accountFrom(undefined)).toBe('default')
  expect(accountFrom('  ')).toBe('default')
})

test('a free name is claimed and written as the presence record', async () => {
  const files = new Map<string, string>()
  const r = await claimName(memory(files), FOLDER, 'Hub', 's1', 'acct')

  expect(r.ok).toBe(true)
  expect(
    JSON.parse(files.get(presencePath(FOLDER, 'Hub')) ?? '{}'),
  ).toMatchObject({ name: 'Hub', sessionId: 's1', account: 'acct', role: 'hub' })
})

test('a name held by a live session, Hub included, is refused and left untouched', async () => {
  for (const name of ['Hub', 'alpha']) {
    const files = new Map<string, string>()
    put(files, name, 'other', 29_000)
    const before = files.get(presencePath(FOLDER, name))
    const r = await claimName(memory(files), FOLDER, name, 's1', 'acct')

    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.reason).toContain('Choose another name')
    expect(files.get(presencePath(FOLDER, name))).toBe(before)
  }
})

test('a stale file (30 s or older) or one holding this same session counts as free', async () => {
  const stale = new Map<string, string>()
  put(stale, 'alpha', 'other', 30_000)
  expect((await claimName(memory(stale), FOLDER, 'alpha', 's1', 'a')).ok).toBe(
    true,
  )

  const own = new Map<string, string>()
  put(own, 'alpha', 's1', 1_000)
  expect((await claimName(memory(own), FOLDER, 'alpha', 's1', 'a')).ok).toBe(
    true,
  )

  const junk = new Map([[presencePath(FOLDER, 'alpha'), 'not json']])
  expect((await claimName(memory(junk), FOLDER, 'alpha', 's1', 'a')).ok).toBe(
    true,
  )
})

test('an invalid name is refused with no write', async () => {
  const files = new Map<string, string>()
  const r = await claimName(memory(files), FOLDER, 'a b', 's1', 'a')

  expect(r.ok).toBe(false)
  expect(files.size).toBe(0)
})

test('two sessions claiming one free name at once: exactly one wins', async () => {
  const files = new Map<string, string>()
  const [a, b] = await Promise.all([
    claimName(memory(files), FOLDER, 'worker1', 'sA', 'a'),
    claimName(memory(files), FOLDER, 'worker1', 'sB', 'b'),
  ])

  expect([a.ok, b.ok].filter(Boolean).length).toBe(1)

  const stored = JSON.parse(files.get(presencePath(FOLDER, 'worker1')) ?? '{}')

  expect(stored.sessionId).toBe(a.ok ? 'sA' : 'sB')
})
