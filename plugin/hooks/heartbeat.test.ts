import { expect, test } from 'claude-code/testing'

import { HEARTBEAT_MS, startHeartbeat, tick } from './heartbeat'
import type { HeartbeatDeps, HeartbeatIdentity } from './heartbeat'
import { buildPresence, parsePresence, STALE_MS } from './presence'

const PATH = 'C:\\hub\\presence\\alpha.json'
const T0 = Date.parse('2026-11-04T10:00:00.000Z')
const ID: HeartbeatIdentity = {
  name: 'alpha',
  sessionId: 's1',
  account: 'acct',
  startedAt: new Date(T0).toISOString(),
  path: PATH,
}

type Rig = {
  deps: HeartbeatDeps
  files: Map<string, string>
  fire: () => Promise<void>
  clock: { now: number }
  lost: number
  failures: string[]
  cancelled: boolean
  periods: number[]
}

const rig = (over: { read?: () => Promise<string | undefined> } = {}): Rig => {
  const files = new Map([
    [PATH, JSON.stringify(buildPresence('alpha', 's1', 'acct', T0))],
  ])
  let tickFn: () => void = () => {}
  const r: Rig = {
    files,
    clock: { now: T0 },
    lost: 0,
    failures: [],
    cancelled: false,
    periods: [],
    fire: async () => {
      tickFn()

      for (let i = 0; i < 50; i++) await Promise.resolve()
    },
    deps: {
      read: over.read ?? (async path => files.get(path)),
      write: async (path, text) => {
        files.set(path, text)
      },
      now: () => r.clock.now,
      every: (ms, fn) => {
        r.periods.push(ms)
        tickFn = fn

        return {
          cancel: () => {
            r.cancelled = true
          },
        }
      },
      onLost: () => {
        r.lost += 1
      },
      onFailure: m => r.failures.push(m),
    },
  }

  return r
}

const stored = (r: Rig) => parsePresence(r.files.get(PATH))

test('the beat period is at most 10 s and well under the stale limit', () => {
  expect(HEARTBEAT_MS).toBeLessThanOrEqual(10_000)
  expect(HEARTBEAT_MS * 2).toBeLessThan(STALE_MS)
})

test('a tick refreshes lastSeen and keeps startedAt', async () => {
  const r = rig()

  startHeartbeat(r.deps, ID)
  r.clock.now = T0 + HEARTBEAT_MS
  await r.fire()

  expect(r.periods).toEqual([HEARTBEAT_MS])
  expect(stored(r)?.lastSeen).toBe(new Date(T0 + HEARTBEAT_MS).toISOString())
  expect(stored(r)?.startedAt).toBe(ID.startedAt)
})

test('a file now held by another session is not overwritten: the heartbeat stops and reports the loss', async () => {
  const r = rig()
  const theirs = JSON.stringify(buildPresence('alpha', 'other', 'a', T0))

  r.files.set(PATH, theirs)
  startHeartbeat(r.deps, ID)
  await r.fire()

  expect(r.files.get(PATH)).toBe(theirs)
  expect(r.lost).toBe(1)
  expect(r.cancelled).toBe(true)

  await r.fire()

  expect(r.lost).toBe(1)
})

test('a missing file is recreated', async () => {
  const r = rig()

  r.files.delete(PATH)
  startHeartbeat(r.deps, ID)
  r.clock.now = T0 + 10_000
  await r.fire()

  expect(stored(r)?.sessionId).toBe('s1')
  expect(r.lost).toBe(0)
})

test('a tick that throws does not escape the timer; one report per failure streak', async () => {
  let isBroken = true
  const r = rig({
    read: async () => {
      if (isBroken) throw new Error('disk gone')

      return undefined
    },
  })

  startHeartbeat(r.deps, ID)
  await r.fire()
  await r.fire()

  expect(r.failures).toEqual(['disk gone'])

  isBroken = false
  await r.fire()
  isBroken = true
  await r.fire()

  expect(r.failures).toEqual(['disk gone', 'disk gone'])
})

test('stop cancels the timer and waits for a beat in flight; nothing is written after it', async () => {
  const r = rig()
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const slow: HeartbeatDeps = {
    ...r.deps,
    write: async (path, text) => {
      await gate
      r.files.set(path, text)
    },
  }
  const hb = startHeartbeat(slow, ID)

  r.clock.now = T0 + HEARTBEAT_MS
  await r.fire()

  let isStopped = false
  const stopping = hb.stop().then(() => {
    isStopped = true
  })

  for (let i = 0; i < 50; i++) await Promise.resolve()

  expect(r.cancelled).toBe(true)
  expect(isStopped).toBe(false)

  release()
  await stopping

  const afterStop = r.files.get(PATH)

  expect(stored(r)?.lastSeen).toBe(new Date(T0 + HEARTBEAT_MS).toISOString())

  r.clock.now = T0 + 2 * HEARTBEAT_MS
  await r.fire()

  expect(r.files.get(PATH)).toBe(afterStop)
})

test('tick reports beat, lost, or stopped', async () => {
  const r = rig()

  expect(await tick(r.deps, ID)).toBe('beat')
  expect(await tick(r.deps, ID, () => true)).toBe('stopped')

  r.files.set(PATH, JSON.stringify(buildPresence('alpha', 'other', 'a', T0)))

  expect(await tick(r.deps, ID)).toBe('lost')
})
