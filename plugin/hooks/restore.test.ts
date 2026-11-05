import { expect, test } from 'claude-code/testing'

import type { JoinState } from './join'
import { leaveSession } from './leave'
import type { LeaveDeps } from './leave'
import { buildPresence, presencePath } from './presence'
import { restoreJoin } from './restore'
import type { RestoreDeps } from './restore'

const FOLDER = 'C:\\hub'
const NOW = Date.parse('2026-11-04T10:00:00.000Z')
const PATH = presencePath(FOLDER, 'alpha')

const identity = {
  name: 'alpha',
  role: 'worker' as const,
  presencePath: PATH,
  startedAt: new Date(NOW).toISOString(),
  sessionId: 's1',
  account: 'acct',
}

type Chunk = { stream: string; text: string }

// A fake tail process: `output` is what it prints (then it stays quiet, or ends
// when `ends`); `returned` says whether return() was called on its stream.
const fakeSpawn = (output: string[], ends = false) => {
  const run = { argv: [] as readonly string[], returned: false }
  const spawn: RestoreDeps['spawn'] = request => {
    run.argv = request.argv

    const queue = [...output]
    const iterator: AsyncIterator<Chunk, unknown> = {
      next: async () => {
        const text = queue.shift()

        if (text !== undefined) return { done: false, value: { stream: 'stdout', text } }
        if (ends) return { done: true, value: undefined }

        return new Promise<never>(() => {})
      },
      return: async () => {
        run.returned = true

        return { done: true, value: undefined }
      },
    }

    return { [Symbol.asyncIterator]: () => iterator }
  }

  return { run, spawn }
}

const rig = (spawn: RestoreDeps['spawn'], storedPos?: RestoreDeps['storedPos']) => {
  const log: string[] = []
  const deps: RestoreDeps = {
    read: async () => JSON.stringify(buildPresence('alpha', 's1', 'acct', NOW)),
    now: () => NOW,
    sessionId: 's1',
    startHeartbeat: () => {
      log.push('heartbeat')

      return { stop: async () => {} }
    },
    setStatus: t => log.push(`status ${t}`),
    clearStored: () => {},
    spawn,
    helper: 'C:\\plugin\\bin\\bus.ps1',
    folder: FOLDER,
    busPath: `${FOLDER}\\bus.jsonl`,
    waitMs: () => new Promise<void>(() => {}),
    onLine: () => {},
    onPos: () => {},
    storedPos,
  }

  return { deps, log }
}

const fromOf = (argv: readonly string[]): string | undefined =>
  argv[argv.indexOf('-From') + 1]

test('restore starts the listener from the stored position', async () => {
  const { run, spawn } = fakeSpawn(['#pos 1a-2b:99\n'])
  const { deps } = rig(spawn, { fileId: '1a-2b', offset: 42 })

  expect(await restoreJoin({ joining: false }, identity, deps)).toBe('restored')
  expect(fromOf(run.argv)).toBe('1a-2b:42')
})

test('a stored join under a different shared folder is dropped, not restored', async () => {
  const { run, spawn } = fakeSpawn(['#pos 1a-2b:99\n'])
  const { deps, log } = rig(spawn)
  const state: JoinState = { joining: false }
  const lines: string[] = []
  let cleared = 0

  deps.folder = 'D:\\other'
  deps.log = text => lines.push(text)
  deps.clearStored = () => {
    cleared += 1
  }

  expect(await restoreJoin(state, identity, deps)).toBe('dropped')
  expect(cleared).toBe(1)
  expect(lines.length).toBe(1)
  expect(state.joined).toBeUndefined()
  expect(log).toEqual([])
  expect(run.argv).toEqual([])
})

test('the same folder in another letter case still restores', async () => {
  const { spawn } = fakeSpawn(['#pos 1a-2b:99\n'])
  const { deps } = rig(spawn)

  deps.folder = 'c:\\HUB'

  expect(await restoreJoin({ joining: false }, identity, deps)).toBe('restored')
})

test('with no stored position the restored listener starts from end', async () => {
  const { run, spawn } = fakeSpawn(['#pos 1a-2b:99\n'])
  const { deps } = rig(spawn, null)

  await restoreJoin({ joining: false }, identity, deps)

  expect(fromOf(run.argv)).toBe('end')
})

test('a restore whose listener fails keeps the join and heartbeat and says so', async () => {
  const { spawn } = fakeSpawn([], true)
  const { deps, log } = rig(spawn)
  const state: JoinState = { joining: false }

  expect(await restoreJoin(state, identity, deps)).toBe('restored')
  expect(log[0]).toBe('heartbeat')
  expect(log.some(l => l.startsWith('status ') && l.includes('not receiving'))).toBe(true)
  expect(state.joined).toBeDefined()
  expect(state.heartbeat).toBeDefined()
})

test('a listener that never reports a position times out without breaking the restore', async () => {
  const { spawn } = fakeSpawn([])
  const { deps, log } = rig(spawn)

  deps.waitMs = async () => {}

  expect(await restoreJoin({ joining: false }, identity, deps)).toBe('restored')
  expect(log.some(l => l.includes('not receiving'))).toBe(true)
})

test('leave after restore stops the restored listener', async () => {
  const { run, spawn } = fakeSpawn(['#pos 1a-2b:0\n'])
  const { deps } = rig(spawn)
  const state: JoinState = { joining: false }

  await restoreJoin(state, identity, deps)

  const leaveDeps: LeaveDeps = {
    folder: FOLDER,
    helper: 'C:\\plugin\\bin\\bus.ps1',
    now: () => NOW,
    random: () => 0.5,
    read: async () => undefined,
    remove: async () => {},
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  }

  expect(run.returned).toBe(false)
  expect((await leaveSession(state, leaveDeps, () => {})).ok).toBe(true)
  expect(run.returned).toBe(true)
})
