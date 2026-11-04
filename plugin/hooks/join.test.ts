import { expect, test } from 'claude-code/testing'

import { guardedJoin, join, statusFor } from './join'
import type { JoinDeps, JoinResult, JoinState } from './join'
import { parseLine } from './message'
import { buildPresence, presencePath } from './presence'

const FOLDER = 'C:\\hub'
const NOW = Date.parse('2026-11-04T10:00:00.000Z')

type Rig = {
  deps: JoinDeps
  events: string[]
  files: Map<string, string>
  lines: string[]
}

const rig = (
  over: {
    files?: Map<string, string>
    appendExit?: number
    spawnPieces?: string[]
    spawnFails?: boolean
    spawnSilent?: boolean
    waitMs?: (ms: number) => Promise<void>
    read?: (path: string) => Promise<string | undefined>
    afterAppend?: (files: Map<string, string>) => void
  } = {},
): Rig => {
  const files = over.files ?? new Map<string, string>()
  const events: string[] = []
  const lines: string[] = []

  const deps: JoinDeps = {
    folder: FOLDER,
    helper: 'C:\\plugin/bin/bus.ps1',
    sessionId: 'session-1',
    account: 'acct',
    now: () => NOW,
    random: () => 0.5,
    sleep: async () => {},
    read: over.read ?? (async path => files.get(path)),
    waitMs: over.waitMs ?? (() => new Promise<void>(() => {})),
    write: async (path, text) => {
      events.push('presence')
      files.set(path, text)
    },
    ensureBus: async () => {
      events.push('ensure')
    },
    remove: async path => {
      events.push('remove')
      files.delete(path)
    },
    spawn: request => {
      events.push(`spawn ${request.argv.slice(-2).join(' ')}`)

      return (async function* () {
        if (over.spawnFails) throw new Error('cannot start')

        if (over.spawnSilent) await new Promise(() => {})

        for (const text of over.spawnPieces ?? ['#pos 0-1:0\n']) {
          yield { stream: 'stdout', text }
        }

        await new Promise(() => {})
      })()
    },
    run: async argv => {
      events.push(`append ${atob(argv[argv.length - 1] ?? '')}`)
      over.afterAppend?.(files)

      return {
        exitCode: over.appendExit ?? 0,
        stdout: '',
        stderr: over.appendExit ? 'boom' : '',
      }
    },
    onLine: l => lines.push(l),
    onPos: p => events.push(`pos ${p.fileId}:${p.offset}`),
  }

  return { deps, events, files, lines }
}

test('join runs in order: listener at end, its first position, presence, join line', async () => {
  const r = rig({ spawnPieces: ['#pos 0-1', ':0\n'] })
  const result = await join(r.deps, 'alpha')

  expect(result.ok).toBe(true)
  expect(r.events[0]).toBe('ensure')
  expect(r.events[1]).toBe('spawn -From end')
  expect(r.events[2]).toBe('pos 0-1:0')
  expect(r.events[3]).toBe('presence')
  expect(r.events[4]?.startsWith('append ')).toBe(true)

  const parsed = parseLine((r.events[4] ?? '').slice('append '.length))

  expect(parsed.ok && parsed.message).toMatchObject({
    kind: 'join',
    from: 'alpha',
    fromSession: 'session-1',
    to: '*',
  })
  expect(result.ok && result.status).toBe('Session Hub: alpha (worker)')
})

test('the status line shows the name and role', async () => {
  expect(statusFor(buildPresence('Hub', 's', 'a', NOW))).toBe(
    'Session Hub: Hub (Hub)',
  )
  expect(statusFor(buildPresence('alpha', 's', 'a', NOW))).toBe(
    'Session Hub: alpha (worker)',
  )
})

test('a live name is refused before any listener starts', async () => {
  const files = new Map([
    [
      presencePath(FOLDER, 'Hub'),
      JSON.stringify(buildPresence('Hub', 'other', 'a', NOW - 5_000)),
    ],
  ])
  const r = rig({ files })
  const result = await join(r.deps, 'Hub')

  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.reason).toContain('Choose another name')
  expect(r.events).toEqual([])
})

test('an invalid name is refused with the rule', async () => {
  const result = await join(rig().deps, 'bad name')

  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.reason).toContain('1 to 32')
})

test('a failed append rolls back: presence removed, error reported', async () => {
  const r = rig({ appendExit: 3 })
  const result = await join(r.deps, 'alpha')

  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.reason).toContain('exit 3')
  expect(r.events).toContain('remove')
  expect(r.files.size).toBe(0)
})

test('a listener that cannot start fails the join before presence is written', async () => {
  const r = rig({ spawnFails: true })
  const result = await join(r.deps, 'alpha')

  expect(result.ok).toBe(false)
  expect(r.events).not.toContain('presence')
})

test('bus lines go to the handler across pieces; other text is ignored', async () => {
  const r = rig({
    spawnPieces: ['#pos 0-1:0\n{"a":', '1}\nwarning text\n#pos 0-1:9\n'],
  })
  await join(r.deps, 'alpha')
  for (let i = 0; i < 50; i++) await Promise.resolve()

  expect(r.lines).toEqual(['{"a":1}'])
  expect(r.events).toContain('pos 0-1:9')
})

const otherPresence = JSON.stringify(
  buildPresence('alpha', 'other', 'a', NOW - 60_000),
)

test('a failed append leaves a presence file that now belongs to someone else', async () => {
  const path = presencePath(FOLDER, 'alpha')
  const r = rig({
    appendExit: 3,
    afterAppend: files => files.set(path, otherPresence),
  })
  const result = await join(r.deps, 'alpha')

  expect(result.ok).toBe(false)
  expect(r.events).not.toContain('remove')
  expect(r.files.get(path)).toBe(otherPresence)
})

test('a claim that throws after writing removes our own presence file', async () => {
  const files = new Map<string, string>()
  let reads = 0
  const r = rig({
    files,
    read: async path => {
      reads += 1

      if (reads === 3) throw new Error('disk gone')

      return files.get(path)
    },
  })
  const result = await join(r.deps, 'alpha')

  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.reason).toContain('disk gone')
  expect(r.events).toContain('remove')
  expect(r.files.size).toBe(0)
})

test('a listener that never reports a position times out as a failed join', async () => {
  const r = rig({ spawnSilent: true, waitMs: async () => {} })
  const result = await join(r.deps, 'alpha')

  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.reason).toContain('did not report a position')
  expect(r.events).not.toContain('presence')
})

test('an unreadable presence file fails the join instead of throwing', async () => {
  const r = rig({
    read: async () => {
      throw new Error('too big')
    },
  })
  const result = await join(r.deps, 'alpha')

  expect(result.ok).toBe(false)
  expect(result.ok ? '' : result.reason).toContain(
    'could not read the presence file for alpha: too big',
  )
  expect(r.events).toEqual([])
})

test('a second join while one is in progress is refused; the flag clears afterwards', async () => {
  const state: JoinState = { joining: false }
  let release: (r: JoinResult) => void = () => {}
  const slow = new Promise<JoinResult>(resolve => {
    release = resolve
  })
  const first = guardedJoin(state, 's1', () => slow)
  const second = await guardedJoin(state, 's1', async () => {
    throw new Error('must not run')
  })

  expect(second).toEqual({ ok: false, reason: 'a join is already in progress' })

  release({ ok: false, reason: 'x' })
  await first

  expect(state.joining).toBe(false)
})

test('a join that throws clears the flag; a successful one blocks further joins', async () => {
  const state: JoinState = { joining: false }
  const boom = guardedJoin(state, 's1', async () => {
    throw new Error('boom')
  })

  await expect(boom).rejects.toThrow('boom')
  expect(state.joining).toBe(false)

  const ok = await join(rig().deps, 'alpha')

  expect(ok.ok).toBe(true)

  if (ok.ok) state.joined = ok.joined

  const again = await guardedJoin(state, 's1', async () => ok)

  expect(again.ok).toBe(false)
  expect(again.ok ? '' : again.reason).toContain('already joined as alpha')
})
