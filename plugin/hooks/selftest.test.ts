import { expect, test } from 'claude-code/testing'

import { resolveSharedFolder, sharedFolderFor } from './paths'
import { formatRows, runSteps, summarize } from './selftest'

let clock = 0
const now = async () => (clock += 5)

test('the shared folder is %USERPROFILE%\\.claude-session-hub', async () => {
  expect(sharedFolderFor('C:\\Users\\me')).toBe(
    'C:\\Users\\me\\.claude-session-hub',
  )
  expect(sharedFolderFor('C:\\Users\\me\\')).toBe(
    'C:\\Users\\me\\.claude-session-hub',
  )
  expect(
    await resolveSharedFolder({ env: { get: async () => 'C:\\Users\\x' } }),
  ).toBe('C:\\Users\\x\\.claude-session-hub')
})

test('an unresolvable USERPROFILE is a clear error', async () => {
  expect(() => sharedFolderFor(undefined)).toThrow(/USERPROFILE/)
  expect(() => sharedFolderFor('  ')).toThrow(/USERPROFILE/)
})

test('every step OK gives OK rows with elapsed ms', async () => {
  const rows = await runSteps(
    [
      { name: 'one', run: async () => 'fine' },
      { name: 'two', run: async () => {} },
    ],
    now,
  )

  expect(rows.map(r => r.isOk)).toEqual([true, true])
  expect(rows[0]?.ms).toBe(5)
  expect(formatRows(rows)).toContain('OK   one (5 ms) - fine')
  expect(summarize(rows)).toContain('all 2 steps OK')
})

test('a throwing step is a FAIL row and later steps still run', async () => {
  const rows = await runSteps(
    [
      {
        name: 'boom',
        run: async () => {
          throw new Error('prompt denied')
        },
      },
      { name: 'after', run: async () => 'ran' },
    ],
    now,
  )

  expect(rows[0]).toMatchObject({ isOk: false, detail: 'prompt denied' })
  expect(rows[1]?.isOk).toBe(true)
  expect(formatRows(rows)).toContain('FAIL boom')
  expect(summarize(rows)).toContain('1 of 2 FAILED (boom)')
})
