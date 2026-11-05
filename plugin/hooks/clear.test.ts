import { expect, test } from 'claude-code/testing'

import { clearArgv } from './bus-client'
import { handleClear } from './clear'
import type { ClearDeps } from './clear'
import { buildPresence } from './presence'

const NOW = 1_700_000_000_000
const BUS = 'C:\\u\\.claude-session-hub\\bus.jsonl'
const ARCHIVE = 'C:\\u\\.claude-session-hub\\archive\\bus-20261104T010203004Z.jsonl'

const make = (name: string | undefined, overrides: Partial<ClearDeps> = {}) => {
  const calls: (readonly string[])[] = []
  const deps: ClearDeps = {
    state: {
      joining: false,
      joined: name
        ? ({ presence: buildPresence(name, 's1', 'acct', NOW), listener: {} } as never)
        : undefined,
    },
    run: async argv => {
      calls.push(argv)

      return { exitCode: 0, stdout: `${ARCHIVE}\r\n`, stderr: '' }
    },
    helper: 'h/bus.ps1',
    busPath: BUS,
    ...overrides,
  }

  return { deps, calls }
}

test('F-014: the Hub clears: the helper is run with clear, the reply names the archive, nothing is sent', async () => {
  const { deps, calls } = make('Hub')
  const text = await handleClear(deps)

  expect(calls).toEqual([clearArgv('h/bus.ps1', BUS)])
  expect(calls[0]?.slice(-3)).toEqual(['clear', '-Path', BUS])
  expect(text).toBe(`Cleared. Archived to ${ARCHIVE}.`)
  expect('append' in deps).toBe(false)
})

test('F-014: a worker is refused and the helper is not run', async () => {
  const { deps, calls } = make('Reports')

  expect(await handleClear(deps)).toBe('Only the Hub can clear the log.')
  expect(calls).toHaveLength(0)
})

test('F-014: a session that has not joined is refused', async () => {
  const { deps, calls } = make(undefined)

  expect(await handleClear(deps)).toBe('Join as Hub first.')
  expect(calls).toHaveLength(0)
})

test('F-014: a helper failure is reported', async () => {
  const { deps } = make('Hub', {
    run: async () => ({ exitCode: 3, stdout: '', stderr: 'timed out' }),
  })
  const text = await handleClear(deps)

  expect(text).toBe('Could not clear the log: bus clear failed (exit 3): timed out')
})

test('F-014: a missing log is cleared with nothing to archive', async () => {
  const empty = make('Hub', { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) })

  expect(await handleClear(empty.deps)).toBe('Cleared. There was no log to archive.')
})
