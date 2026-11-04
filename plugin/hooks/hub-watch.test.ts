import { expect, test } from 'claude-code/testing'

import { HEARTBEAT_MS } from './heartbeat'
import type { Heartbeat } from './heartbeat'
import { HUB_AWAY_TEXT, isHubAway, startHubWatch, statusWith } from './hub-watch'
import type { HubWatch, HubWatchDeps } from './hub-watch'
import { statusFor } from './join'
import type { Joined, JoinState } from './join'
import { completeJoin, leaveSession, markLost } from './leave'
import type { LeaveDeps } from './leave'
import { buildPresence, presencePath, STALE_MS } from './presence'
import { restoreJoin } from './restore'

const FOLDER = 'C:\\hub'
const HUB_PATH = presencePath(FOLDER, 'Hub')
const T0 = Date.parse('2026-11-04T10:00:00.000Z')
const hubFile = (age: number) =>
  JSON.stringify(buildPresence('Hub', 'h1', 'acct', T0 - age))

type Rig = {
  deps: HubWatchDeps
  files: Map<string, string>
  changes: boolean[]
  clock: { now: number }
  cancelled: boolean
  periods: number[]
  fire: () => Promise<void>
  settle: () => Promise<void>
  readOverride?: () => Promise<string | undefined>
}

const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

const rig = (): Rig => {
  let tickFn: () => void = () => {}
  const r: Rig = {
    files: new Map([[HUB_PATH, hubFile(0)]]),
    changes: [],
    clock: { now: T0 },
    cancelled: false,
    periods: [],
    settle,
    fire: async () => {
      tickFn()
      await settle()
    },
    deps: {
      read: async path => (r.readOverride ? r.readOverride() : r.files.get(path)),
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
      onChange: isAway => {
        r.changes.push(isAway)
      },
    },
  }

  return r
}

test('a missing Hub file is away', async () => {
  const r = rig()

  r.files.delete(HUB_PATH)
  startHubWatch(r.deps, HUB_PATH)
  await r.settle()

  expect(r.changes).toEqual([true])
})

test('a stale Hub file (30 s or older) is away; just under is not', async () => {
  const r = rig()

  expect(await isHubAway(r.deps, HUB_PATH)).toBe(false)

  r.files.set(HUB_PATH, hubFile(STALE_MS - 1))
  expect(await isHubAway(r.deps, HUB_PATH)).toBe(false)

  r.files.set(HUB_PATH, hubFile(STALE_MS))
  expect(await isHubAway(r.deps, HUB_PATH)).toBe(true)
})

test('a fresh Hub file is not away; the first check reports it, at start', async () => {
  const r = rig()

  startHubWatch(r.deps, HUB_PATH)
  await r.settle()

  expect(r.changes).toEqual([false])
  expect(r.periods).toEqual([HEARTBEAT_MS])
})

test('a malformed Hub file is away', async () => {
  const r = rig()

  r.files.set(HUB_PATH, '{not json')
  expect(await isHubAway(r.deps, HUB_PATH)).toBe(true)
})

test('a read that throws is away, and nothing escapes the timer', async () => {
  const r = rig()

  r.readOverride = async () => {
    throw new Error('disk gone')
  }
  startHubWatch(r.deps, HUB_PATH)
  await r.settle()
  await r.fire()

  expect(r.changes).toEqual([true])
})

test('an onChange that throws does not escape the timer', async () => {
  const r = rig()

  let calls = 0

  r.deps.onChange = isAway => {
    calls += 1

    if (calls === 1) throw new Error('status failed')

    r.changes.push(isAway)
  }
  r.files.delete(HUB_PATH)

  const watch = startHubWatch(r.deps, HUB_PATH)

  await r.settle()

  expect(calls).toBe(1)

  r.files.set(HUB_PATH, hubFile(0))
  await r.fire()

  expect(calls).toBe(2)
  expect(r.changes).toEqual([false])
  await expect(watch.stop()).resolves.toBeUndefined()
})

test('changes are reported only on a transition: away, away, back is two reports', async () => {
  const r = rig()

  r.files.delete(HUB_PATH)
  startHubWatch(r.deps, HUB_PATH)
  await r.settle()
  await r.fire()

  expect(r.changes).toEqual([true])

  r.files.set(HUB_PATH, hubFile(0))
  await r.fire()
  await r.fire()

  expect(r.changes).toEqual([true, false])
})

test('status text: away carries the literal, back restores statusFor', () => {
  const p = buildPresence('alpha', 's1', 'acct', T0)

  expect(statusWith(p, true)).toBe(
    'Session Hub: alpha (worker) — Hub away — waiting',
  )
  expect(statusWith(p, true)).toContain(HUB_AWAY_TEXT)
  expect(statusWith(p, false)).toBe(statusFor(p))
})

test('stop cancels the timer and waits for a check in flight; nothing is reported after it', async () => {
  const r = rig()
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })

  r.readOverride = async () => {
    await gate

    return undefined
  }

  const watch = startHubWatch(r.deps, HUB_PATH)
  let isStopped = false
  const stopping = watch.stop().then(() => {
    isStopped = true
  })

  await r.settle()

  expect(r.cancelled).toBe(true)
  expect(isStopped).toBe(false)

  release()
  await stopping

  expect(r.changes).toEqual([])

  r.files.delete(HUB_PATH)
  r.readOverride = undefined
  await r.fire()

  expect(r.changes).toEqual([])
})

// Lifecycle: the watcher follows the join.

const leaveDeps = (): LeaveDeps => ({
  folder: FOLDER,
  helper: 'C:\\plugin/bin/bus.ps1',
  now: () => T0,
  random: () => 0.5,
  read: async () => undefined,
  remove: async () => {},
  run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
})

const joinedAs = (name: string, listenerStops: string[]): Joined => ({
  presence: buildPresence(name, 's1', 'acct', T0),
  listener: {
    ready: new Promise(() => {}),
    stop: () => {
      listenerStops.push('listener')
    },
  },
})

const heartbeatStub = (stops: string[]): Heartbeat => ({
  stop: async () => {
    stops.push('heartbeat')
  },
})

const watchStub = (stops: string[]): HubWatch => ({
  stop: async () => {
    stops.push('watch')
  },
})

test('a Hub-role join starts no watcher; a worker join starts one', async () => {
  for (const [name, expected] of [['Hub', 0], ['alpha', 1]] as const) {
    const state: JoinState = { joining: false }
    let started = 0

    await completeJoin(state, joinedAs(name, []), leaveDeps(), {
      store: async () => {},
      clearStored: () => {},
      startHeartbeat: () => heartbeatStub([]),
      startHubWatch: () => {
        started += 1

        return watchStub([])
      },
    })

    expect(started).toBe(expected)
    expect(state.hubWatch === undefined).toBe(expected === 0)
  }
})

test('a join released by endedId never starts a watcher', async () => {
  const state: JoinState = { joining: false, endedId: 's1' }
  let started = 0
  const kept = await completeJoin(state, joinedAs('alpha', []), leaveDeps(), {
    store: async () => {},
    clearStored: () => {},
    startHeartbeat: () => heartbeatStub([]),
    startHubWatch: () => {
      started += 1

      return watchStub([])
    },
  })

  expect(kept).toBe(false)
  expect(started).toBe(0)
  expect(state.hubWatch).toBeUndefined()
})

test('leave stops the watcher after the heartbeat, and clears hubAway', async () => {
  const stops: string[] = []
  const state: JoinState = {
    joining: false,
    joined: joinedAs('alpha', stops),
    heartbeat: heartbeatStub(stops),
    hubWatch: watchStub(stops),
    hubAway: true,
  }

  await leaveSession(state, leaveDeps(), () => {})

  expect(stops).toEqual(['heartbeat', 'watch', 'listener'])
  expect(state.hubWatch).toBeUndefined()
  expect(state.hubAway).toBeUndefined()
})

test('leave waits for a check in flight: no status is written after it resolves', async () => {
  const r = rig()
  const statuses: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })

  r.readOverride = async () => {
    await gate

    return undefined
  }
  r.deps.onChange = isAway => {
    statuses.push(statusWith(buildPresence('alpha', 's1', 'acct', T0), isAway))
  }

  const state: JoinState = {
    joining: false,
    joined: joinedAs('alpha', []),
    hubWatch: startHubWatch(r.deps, HUB_PATH),
  }
  let isLeft = false
  const leaving = leaveSession(state, leaveDeps(), () => {}).then(() => {
    isLeft = true
  })

  await r.settle()

  expect(isLeft).toBe(false)

  release()
  await leaving

  expect(statuses).toEqual([])
  expect(r.cancelled).toBe(true)
})

test('markLost stops the watcher', async () => {
  const stops: string[] = []
  const state: JoinState = {
    joining: false,
    joined: joinedAs('alpha', stops),
    heartbeat: heartbeatStub(stops),
    hubWatch: watchStub(stops),
    hubAway: true,
  }

  await markLost(state, { clearStored: () => {}, notify: () => {} })

  expect(stops).toEqual(['listener', 'watch'])
  expect(state.hubWatch).toBeUndefined()
  expect(state.hubAway).toBeUndefined()
})

test('markLost clears the stored join before the watcher finishes stopping', async () => {
  const order: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const state: JoinState = {
    joining: false,
    joined: joinedAs('alpha', []),
    hubWatch: {
      stop: async () => {
        order.push('stop-begin')
        await gate
        order.push('stop-end')
      },
    },
  }

  const lost = markLost(state, {
    clearStored: () => {
      order.push('clearStored')
    },
    notify: () => {
      order.push('notify')
    },
  })

  await settle()

  expect(order).toEqual(['stop-begin', 'clearStored'])

  release()
  await lost

  expect(order).toEqual(['stop-begin', 'clearStored', 'stop-end', 'notify'])
})

test('restore starts a watcher for a worker only', async () => {
  for (const [name, expected] of [['Hub', 0], ['alpha', 1]] as const) {
    const state: JoinState = { joining: false }
    let started = 0
    const held = buildPresence(name, 's1', 'acct', T0)
    const path = presencePath(FOLDER, name)
    const result = await restoreJoin(
      state,
      {
        name,
        role: held.role,
        presencePath: path,
        startedAt: held.startedAt,
        sessionId: 's1',
        account: 'acct',
      },
      {
        read: async () => JSON.stringify(held),
        now: () => T0,
        sessionId: 's1',
        startHeartbeat: () => heartbeatStub([]),
        setStatus: () => {},
        clearStored: () => {},
        startHubWatch: () => {
          started += 1

          return watchStub([])
        },
      },
    )

    expect(result).toBe('restored')
    expect(started).toBe(expected)
  }
})

test('Hub away leaves the heartbeat, listener and joined state untouched', async () => {
  const r = rig()
  const stops: string[] = []
  const state: JoinState = {
    joining: false,
    joined: joinedAs('alpha', stops),
    heartbeat: heartbeatStub(stops),
  }
  const heartbeat = state.heartbeat
  const joined = state.joined

  r.files.delete(HUB_PATH)
  r.deps.onChange = isAway => {
    state.hubAway = isAway
  }
  state.hubWatch = startHubWatch(r.deps, HUB_PATH)
  await r.settle()

  expect(state.hubAway).toBe(true)
  expect(state.joined).toBe(joined)
  expect(state.heartbeat).toBe(heartbeat)
  expect(state.leaving).toBeUndefined()
  expect(stops).toEqual([])

  r.files.set(HUB_PATH, hubFile(0))
  await r.fire()

  expect(state.hubAway).toBe(false)
  expect(state.joined).toBe(joined)
  expect(stops).toEqual([])
})
