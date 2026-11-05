import { expect, test } from 'claude-code/testing'

import type { Heartbeat } from './heartbeat'
import { guardedJoin, guardedLeave } from './join'
import type { Joined, JoinResult, JoinState } from './join'
import { completeJoin, endSession, leaveSession, markLost } from './leave'
import type { LeaveDeps } from './leave'
import { parseLine } from './message'
import { buildPresence, presencePath } from './presence'
import { restoreJoin } from './restore'
import type { RestoreDeps } from './restore'

const FOLDER = 'C:\\hub'
const NOW = Date.parse('2026-11-04T10:00:00.000Z')
const PATH = presencePath(FOLDER, 'alpha')
const mine = (age = 0) =>
  JSON.stringify(buildPresence('alpha', 's1', 'acct', NOW - age))

type Rig = {
  deps: LeaveDeps
  events: string[]
  files: Map<string, string>
  state: JoinState
}

const rig = (over: { appendExit?: number; removeThrows?: boolean } = {}): Rig => {
  const events: string[] = []
  const files = new Map([[PATH, mine()]])
  const heartbeat: Heartbeat = {
    stop: async () => {
      events.push('stop heartbeat')
    },
  }
  const joined: Joined = {
    presence: buildPresence('alpha', 's1', 'acct', NOW),
    listener: {
      ready: new Promise(() => {}),
      stop: () => {
        events.push('stop listener')
      },
    },
  }

  return {
    events,
    files,
    state: { joining: false, joined, heartbeat },
    deps: {
      folder: FOLDER,
      helper: 'C:\\plugin/bin/bus.ps1',
      now: () => NOW,
      random: () => 0.5,
      read: async path => files.get(path),
      remove: async path => {
        if (over.removeThrows) throw new Error('locked')

        events.push('remove')
        files.delete(path)
      },
      run: async argv => {
        events.push(`append ${atob(argv[argv.length - 1] ?? '')}`)

        return {
          exitCode: over.appendExit ?? 0,
          stdout: '',
          stderr: over.appendExit ? 'boom' : '',
        }
      },
    },
  }
}

test('leave runs in order: heartbeat, leave line, listener, remove', async () => {
  const r = rig()
  const result = await leaveSession(r.state, r.deps, () => {
    r.events.push('after')
  })

  expect(result.ok).toBe(true)
  expect(
    r.events.map(e => (e.startsWith('append ') ? 'append' : e)),
  ).toEqual(['stop heartbeat', 'append', 'stop listener', 'remove', 'after'])

  const parsed = parseLine((r.events[1] ?? '').slice('append '.length))

  expect(parsed.ok && parsed.message).toMatchObject({
    kind: 'leave',
    from: 'alpha',
    fromSession: 's1',
    to: '*',
    body: 'left',
  })
  expect(r.files.size).toBe(0)
  expect(r.state.joined).toBeUndefined()
  expect(r.state.heartbeat).toBeUndefined()
  expect(r.state.leaving).toBe(false)
})

test('leave when not joined is refused', async () => {
  const state: JoinState = { joining: false }
  const result = await leaveSession(state, rig().deps, () => {})

  expect(result).toEqual({ ok: false, reason: 'not joined' })
})

test('a failed leave-line append still releases the name and reports it', async () => {
  const r = rig({ appendExit: 3 })
  const result = await leaveSession(r.state, r.deps, () => {})

  expect(result.ok && result.text).toContain('leave line could not be written')
  expect(result.ok && result.text).toContain('exit 3')
  expect(r.events).toContain('stop listener')
  expect(r.events).toContain('remove')
  expect(r.state.joined).toBeUndefined()
})

test('a presence file that is no longer ours is left alone', async () => {
  const r = rig()

  r.files.set(PATH, JSON.stringify(buildPresence('alpha', 'other', 'a', NOW)))
  await leaveSession(r.state, r.deps, () => {})

  expect(r.events).not.toContain('remove')
  expect(r.files.size).toBe(1)
})

test('a removal that fails is reported; the state is still cleared', async () => {
  const r = rig({ removeThrows: true })
  const result = await leaveSession(r.state, r.deps, () => {})

  expect(result.ok && result.text).toContain('could not be removed')
  expect(r.state.joined).toBeUndefined()
})

test('leave is refused during a join or another leave; join is refused during a leave', async () => {
  const r = rig()

  r.state.joining = true
  expect(await guardedLeave(r.state, async () => 1)).toEqual({
    ok: false,
    reason: 'a join is in progress',
  })

  r.state.joining = false

  let release: () => void = () => {}
  const first = guardedLeave(
    r.state,
    () => new Promise<number>(resolve => (release = () => resolve(1))),
  )

  expect(await guardedLeave(r.state, async () => 2)).toEqual({
    ok: false,
    reason: 'a leave is already in progress',
  })

  const join = await guardedJoin(r.state, 's1', async (): Promise<JoinResult> => {
    throw new Error('must not run')
  })

  expect(join).toEqual({ ok: false, reason: 'a leave is in progress' })

  release()
  await first
})

test('already joined points at /hub-leave', async () => {
  const r = rig()
  const result = await guardedJoin(r.state, 's1', async () => ({
    ok: false,
    reason: 'x',
  }))

  expect(result.ok ? '' : result.reason).toContain('/hub-leave')
})

test('session end: the same release, run once; a second end does nothing', async () => {
  const r = rig()

  await leaveSession(r.state, r.deps, () => {})
  const again = await leaveSession(r.state, r.deps, () => {})

  expect(again.ok).toBe(false)
  expect(r.events.filter(e => e === 'stop heartbeat')).toHaveLength(1)
  expect(r.events.filter(e => e.startsWith('append '))).toHaveLength(1)
})

test('session end during a pending join: the join releases itself, no heartbeat, state unjoined', async () => {
  const r = rig()
  const state: JoinState = { joining: false }
  const joined = r.state.joined as Joined
  let finish: () => void = () => {}
  const attemptGate = new Promise<void>(resolve => (finish = resolve))
  let started = 0
  let stored = 0
  let cleared = 0

  const joining = guardedJoin(state, 's1', async (): Promise<JoinResult> => {
    await attemptGate

    const kept = await completeJoin(state, joined, r.deps, {
      store: async () => {
        stored += 1
      },
      clearStored: () => {
        cleared += 1
      },
      startHeartbeat: () => {
        started += 1

        return { stop: async () => {} }
      },
    })

    return kept
      ? { ok: true, joined, status: 's' }
      : { ok: false, reason: 'ended' }
  })

  // The wait runs out before the join settles (sleep resolves at once).
  await endSession(state, 's1', r.deps, () => {}, async () => {})

  expect(state.endedId).toBe('s1')
  expect(r.events).toEqual([])

  finish()

  const result = await joining

  expect(result.ok).toBe(false)
  expect(started).toBe(0)
  expect(stored).toBe(1)
  expect(cleared).toBe(1)
  expect(r.files.size).toBe(0)
  expect(r.events.filter(e => e === 'remove')).toHaveLength(1)
  expect(r.events).toContain('stop listener')
  expect(state.joined).toBeUndefined()
  expect(state.heartbeat).toBeUndefined()
  expect(state.joining).toBe(false)
})

test('session end waits for a join that settles within the bound; it releases itself once', async () => {
  const r = rig()
  const state: JoinState = { joining: false }
  const joined = r.state.joined as Joined
  let started = 0
  let finish: () => void = () => {}
  const attemptGate = new Promise<void>(resolve => (finish = resolve))

  const joining = guardedJoin(state, 's1', async (): Promise<JoinResult> => {
    await attemptGate

    const kept = await completeJoin(state, joined, r.deps, {
      store: async () => {},
      clearStored: () => {},
      startHeartbeat: () => {
        started += 1

        return { stop: async () => {} }
      },
    })

    return kept
      ? { ok: true, joined, status: 's' }
      : { ok: false, reason: 'ended' }
  })
  const ending = endSession(state, 's1', r.deps, () => {}, () => new Promise(() => {}))

  finish()
  await joining
  await ending

  expect(started).toBe(0)
  expect(r.events.filter(e => e === 'remove')).toHaveLength(1)
  expect(r.events.filter(e => e.startsWith('append '))).toHaveLength(1)
  expect(r.files.size).toBe(0)
  expect(state.joined).toBeUndefined()
  expect(state.heartbeat).toBeUndefined()
})

test('session.end (clear, id A) then a join under id B succeeds', async () => {
  const state: JoinState = { joining: false }

  await endSession(state, 'A', rig().deps, () => {}, async () => {})

  const r = rig()
  const joined = r.state.joined as Joined
  const ok = await guardedJoin(state, 'B', async () => ({
    ok: true as const,
    joined,
    status: 's',
  }))

  expect(ok.ok).toBe(true)
  expect(state.joined).toBe(joined)
})

test('session.end id A then a join under id A is refused', async () => {
  const state: JoinState = { joining: false }

  await endSession(state, 'A', rig().deps, () => {}, async () => {})

  expect(
    await guardedJoin(state, 'A', async (): Promise<JoinResult> => {
      throw new Error('must not run')
    }),
  ).toEqual({ ok: false, reason: 'the session is ending' })
})

test('a join under s1 still pending after end s1 has returned is released when it completes, no heartbeat', async () => {
  const r = rig()
  const state: JoinState = { joining: false }
  const joined = r.state.joined as Joined
  let finish: () => void = () => {}
  const gate = new Promise<void>(resolve => (finish = resolve))
  let started = 0

  const joining = guardedJoin(state, 's1', async (): Promise<JoinResult> => {
    await gate

    const kept = await completeJoin(state, joined, r.deps, {
      store: async () => {},
      clearStored: () => {},
      startHeartbeat: () => {
        started += 1

        return { stop: async () => {} }
      },
    })

    return kept
      ? { ok: true, joined, status: 's' }
      : { ok: false, reason: 'ended' }
  })

  await endSession(state, 's1', r.deps, () => {}, async () => {})
  finish()

  expect((await joining).ok).toBe(false)
  expect(started).toBe(0)
  expect(r.files.size).toBe(0)
  expect(state.joined).toBeUndefined()
})

// A join under `sessionId` that holds at `gate` and then runs `completeJoin`.
const joinUnder = (
  state: JoinState,
  sessionId: string,
  gate: Promise<void>,
) => {
  const r = rig()
  const joined: Joined = {
    ...(r.state.joined as Joined),
    presence: buildPresence('alpha', sessionId, 'acct', NOW),
  }
  const counts = { started: 0, cleared: 0 }

  r.files.set(PATH, JSON.stringify(joined.presence))

  const joining = guardedJoin(state, sessionId, async (): Promise<JoinResult> => {
    await gate

    const kept = await completeJoin(state, joined, r.deps, {
      store: async () => {},
      clearStored: () => {
        counts.cleared += 1
      },
      startHeartbeat: () => {
        counts.started += 1

        return { stop: async () => {} }
      },
    })

    return kept
      ? { ok: true, joined, status: 's' }
      : { ok: false, reason: 'ended' }
  })

  return { r, joined, counts, joining }
}

test('end A, then a join under B completes through completeJoin: kept, heartbeat started, file kept', async () => {
  const state: JoinState = { joining: false }

  await endSession(state, 'A', rig().deps, () => {}, async () => {})

  const { r, joined, counts, joining } = joinUnder(state, 'B', Promise.resolve())
  const result = await joining

  expect(state.endedId).toBe('A')
  expect(result.ok).toBe(true)
  expect(counts.started).toBe(1)
  expect(counts.cleared).toBe(0)
  expect(state.joined).toBe(joined)
  expect(state.heartbeat).toBeDefined()
  expect(r.files.has(PATH)).toBe(true)
  expect(r.events).not.toContain('remove')
  expect(r.events).not.toContain('stop listener')
})

test('a join under B pending when end A runs is kept once it completes', async () => {
  const state: JoinState = { joining: false }
  let finish: () => void = () => {}
  const gate = new Promise<void>(resolve => (finish = resolve))
  const { r, joined, counts, joining } = joinUnder(state, 'B', gate)

  // The wait runs out before the join settles (sleep resolves at once).
  await endSession(state, 'A', r.deps, () => {}, async () => {})

  expect(state.endedId).toBe('A')
  expect(r.events).toEqual([])

  finish()

  expect((await joining).ok).toBe(true)
  expect(counts.started).toBe(1)
  expect(counts.cleared).toBe(0)
  expect(state.joined).toBe(joined)
  expect(state.heartbeat).toBeDefined()
  expect(r.files.has(PATH)).toBe(true)
  expect(r.events).not.toContain('remove')
})

test('losing the name unjoins, stops the listener and tells the person', async () => {
  const r = rig()
  const said: string[] = []
  let isCleared = false

  await markLost(r.state, {
    clearStored: () => {
      isCleared = true
    },
    notify: t => said.push(t),
  })

  expect(r.events).toEqual(['stop listener'])
  expect(r.state.joined).toBeUndefined()
  expect(isCleared).toBe(true)
  expect(said[0]).toContain('/hub-join')
})

test('markLost does nothing while a leave is in progress', async () => {
  const r = rig()

  r.state.leaving = true
  await markLost(r.state, { clearStored: () => {}, notify: () => {} })

  expect(r.state.joined).toBeDefined()
})

const identity = {
  name: 'alpha',
  role: 'worker' as const,
  presencePath: PATH,
  startedAt: new Date(NOW).toISOString(),
  sessionId: 's1',
  account: 'acct',
}

const restoreRig = (file: string | undefined) => {
  const log: string[] = []
  const deps: RestoreDeps = {
    read: async () => file,
    spawn: () => ({
      [Symbol.asyncIterator]: () => {
        let sent = false

        return {
          next: async () =>
            sent
              ? new Promise<never>(() => {})
              : ((sent = true), { done: false as const, value: { stream: 'stdout', text: '#pos 1-1:0\n' } }),
          return: async () => ({ done: true as const, value: undefined }),
        }
      },
    }),
    folder: FOLDER,
    helper: 'bus.ps1',
    busPath: 'bus.jsonl',
    waitMs: () => new Promise<void>(() => {}),
    onLine: () => {},
    onPos: () => {},
    now: () => NOW,
    sessionId: 's1',
    startHeartbeat: id => {
      log.push(`heartbeat ${id.name} ${id.startedAt}`)

      return { stop: async () => {} }
    },
    setStatus: t => log.push(`status ${t}`),
    clearStored: () => {
      log.push('cleared')
    },
  }

  return { deps, log }
}

test('reload: a fresh file of ours restores the heartbeat and status', async () => {
  const { deps, log } = restoreRig(mine(5_000))
  const state: JoinState = { joining: false }

  expect(await restoreJoin(state, identity, deps)).toBe('restored')
  expect(log).toEqual([
    `heartbeat alpha ${identity.startedAt}`,
    'status Session Hub: alpha (worker)',
  ])
  expect(state.joined?.presence.name).toBe('alpha')
  expect(state.heartbeat).toBeDefined()
})

test('reload: a stale, foreign or missing file drops the stored join', async () => {
  for (const file of [
    mine(60_000),
    JSON.stringify(buildPresence('alpha', 'other', 'a', NOW)),
    undefined,
  ]) {
    const { deps, log } = restoreRig(file)
    const state: JoinState = { joining: false }

    expect(await restoreJoin(state, identity, deps)).toBe('dropped')
    expect(log).toEqual(['cleared'])
    expect(state.joined).toBeUndefined()
  }
})

test('reload: nothing stored, or already joined, does nothing', async () => {
  const { deps, log } = restoreRig(mine())

  expect(await restoreJoin({ joining: false }, null, deps)).toBe('none')
  expect(await restoreJoin(rig().state, identity, deps)).toBe('none')
  expect(log).toEqual([])
})
