import { expect, test } from 'claude-code/testing'

import { handleListSessions } from './list-sessions'
import type { ListDeps } from './list-sessions'
import { buildPresence } from './presence'
import type { Presence } from './presence'
import {
  applyPresenceLine,
  buildRoster,
  loadPresenceFiles,
  markPresenceLine,
  startRosterRefresh,
} from './roster'

const NOW = 1_700_000_000_000
const at = (name: string, ageMs: number, account = 'acct'): Presence =>
  buildPresence(name, `s-${name}`, account, NOW - ageMs)

test('F-012: a join line adds a session at once, with the role its name implies', () => {
  const rows = applyPresenceLine([], { kind: 'join', from: 'Reports', ts: new Date(NOW).toISOString() }, NOW)

  expect(rows.map(r => [r.name, r.role])).toEqual([['Reports', 'worker']])
})

test('F-012: a leave line removes the session', () => {
  const rows = buildRoster([at('Hub', 0), at('Reports', 0)], NOW)

  expect(applyPresenceLine(rows, { kind: 'leave', from: 'Reports' }, NOW).map(r => r.name)).toEqual(['Hub'])
})

test('F-012: a join line for a listed session keeps its fields', () => {
  const rows = buildRoster([at('Reports', 0, 'neeraj')], NOW)

  expect(applyPresenceLine(rows, { kind: 'join', from: 'Reports' }, NOW)).toEqual(rows)
})

test('F-012: a stale presence file is removed, a live one stays', () => {
  const rows = buildRoster([at('Hub', 0), at('Old', 31_000), at('Fresh', 29_000)], NOW)

  expect(rows.map(r => r.name)).toEqual(['Hub', 'Fresh'])
})

test('F-012: the presence file overrides what a join line guessed', () => {
  const guessed = applyPresenceLine([], { kind: 'join', from: 'Reports' }, NOW)

  expect(guessed[0]?.account).toBe('unknown')

  const rows = buildRoster([at('Reports', 2_000, 'neeraj')], NOW)

  expect(rows[0]).toMatchObject({ name: 'Reports', account: 'neeraj' })
})

test('F-012: a fresh Hub file is listed with its real last seen', () => {
  const rows = buildRoster([at('Hub', 4_000), at('Reports', 0)], NOW)

  expect(rows.map(r => r.name)).toEqual(['Hub', 'Reports'])
  expect(rows[0]?.lastSeen).toBe(new Date(NOW - 4_000).toISOString())
})

test('F-012: a Hub file 40 s old is dropped, not stamped as now', () => {
  const rows = buildRoster([at('Hub', 40_000), at('Reports', 0)], NOW)

  expect(rows.map(r => r.name)).toEqual(['Reports'])
})

test('F-012: a refresh does not re-add a session whose leave was applied', () => {
  const left = new Map<string, string>()
  const files = [at('Hub', 0), at('X', 1_000)]

  markPresenceLine(left, { kind: 'leave', from: 'X', fromSession: 's-X' })

  expect(buildRoster(files, NOW, left).map(r => r.name)).toEqual(['Hub'])
  expect(left.has('X')).toBe(true)

  // X's file is gone: the mark is cleared.
  expect(buildRoster([at('Hub', 0)], NOW, left).map(r => r.name)).toEqual(['Hub'])
  expect(left.has('X')).toBe(false)

  // A join for X while its file is back lists it again.
  markPresenceLine(left, { kind: 'leave', from: 'X', fromSession: 's-X' })
  markPresenceLine(left, { kind: 'join', from: 'X', fromSession: 's-X' })

  expect(buildRoster(files, NOW, left).map(r => r.name)).toEqual(['Hub', 'X'])
})

test('F-012: a leave from a superseded session does not hide the new owner of the name', () => {
  const left = new Map<string, string>()
  const files = [at('Hub', 0), buildPresence('X', 's-X-new', 'acct', NOW - 1_000)]

  markPresenceLine(left, { kind: 'leave', from: 'X', fromSession: 's-X-old' })

  expect(buildRoster(files, NOW, left).map(r => r.name)).toEqual(['Hub', 'X'])
  expect(left.has('X')).toBe(false)
  expect(buildRoster(files, NOW, left).map(r => r.name)).toEqual(['Hub', 'X'])
})

test('F-012: the order is the Hub first, then by name, whatever the file order', () => {
  const a = buildRoster([at('Zed', 0), at('Hub', 0), at('Amy', 0)], NOW)
  const b = buildRoster([at('Amy', 0), at('Zed', 0), at('Hub', 0)], NOW)

  expect(a.map(r => r.name)).toEqual(['Hub', 'Amy', 'Zed'])
  expect(b).toEqual(a)
})

test('F-012: loading reads only the .json files and skips malformed ones', async () => {
  const files: Record<string, string> = {
    'p\\Hub.json': JSON.stringify(at('Hub', 0)),
    'p\\Bad.json': '{not json',
  }
  const out = await loadPresenceFiles(
    {
      list: async () => ['Hub.json', 'Bad.json', 'notes.txt'],
      read: async path => files[path],
    },
    'p',
  )

  expect(out.map(p => p.name)).toEqual(['Hub'])

  const missing = await loadPresenceFiles(
    { list: () => Promise.reject(new Error('no dir')), read: async () => undefined },
    'p',
  )

  expect(missing).toEqual([])
})

test('F-012: the refresh runs at once, on each tick, and not after stop', async () => {
  let tick: () => void = () => {}
  let runs = 0
  let cancelled = false
  const refresh = startRosterRefresh({
    every: (_ms, fn) => {
      tick = fn

      return {
        cancel: () => {
          cancelled = true
        },
      }
    },
    refresh: async () => {
      runs += 1
    },
  })

  await refresh.stop()

  expect(runs).toBe(1)
  expect(cancelled).toBe(true)

  tick()

  expect(runs).toBe(1)
})

const listDeps = (name: string | undefined, role: 'hub' | 'worker'): ListDeps => ({
  state: {
    joined: name
      ? ({ presence: { ...buildPresence(name, 's', 'acct', NOW), role }, listener: {} } as never)
      : undefined,
  },
  presenceDir: async () => 'p',
  now: () => NOW,
  left: new Map(),
  list: async () => ['Hub.json', 'Old.json'],
  read: async path => JSON.stringify(path === 'p\\Hub.json' ? at('Hub', 3_000) : at('Old', 60_000)),
})

test('F-012: list_sessions gives the Hub the live rows as JSON', async () => {
  const out = await handleListSessions(listDeps('Hub', 'hub'))

  expect('result' in out && JSON.parse(out.result)).toEqual([
    {
      name: 'Hub',
      role: 'hub',
      account: 'acct',
      lastSeen: new Date(NOW - 3_000).toISOString(),
      lastSeenAgo: '3 s ago',
    },
  ])
})

test('F-012: list_sessions refuses a worker', async () => {
  expect(await handleListSessions(listDeps('Reports', 'worker'))).toEqual({
    deny: 'Not available: only the Hub can list sessions',
  })
})

test('F-012: list_sessions refuses a session that has not joined', async () => {
  const out = await handleListSessions(listDeps(undefined, 'hub'))

  expect('deny' in out && out.deny).toContain('has not joined')
})
