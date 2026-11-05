import { expect, test } from 'claude-code/testing'

import { configureSharedFolder, parseSharedFolderOption, resolveSharedFolder } from './paths'
import { presencePath } from './presence'

const env = { env: { get: async () => 'C:\\Users\\me' } }

test('unset or blank gives the default and no warning', async () => {
  for (const raw of [undefined, '', '   ']) {
    expect(configureSharedFolder(raw)).toEqual({})
    expect(await resolveSharedFolder(env)).toBe('C:\\Users\\me\\.claude-session-hub')
  }
})

test('a valid absolute path is used with trailing slashes stripped', async () => {
  expect(parseSharedFolderOption(' D:\\Hub\\ ')).toEqual({ path: 'D:\\Hub' })
  expect(parseSharedFolderOption('D:/Hub//')).toEqual({ path: 'D:\\Hub' })
  expect(parseSharedFolderOption('\\\\srv\\share\\hub\\')).toEqual({ path: '\\\\srv\\share\\hub' })

  configureSharedFolder('D:\\Hub\\')
  expect(await resolveSharedFolder(env)).toBe('D:\\Hub')
})

test('relative, root-only or non-text values fall back with a warning', async () => {
  for (const raw of ['hub', '.\\hub', '\\hub', 'C:hub', 'C:\\', 42]) {
    const option = configureSharedFolder(raw)

    expect(option.path).toBeUndefined()
    expect(option.warning).toContain('default folder')
    expect(await resolveSharedFolder(env)).toBe('C:\\Users\\me\\.claude-session-hub')
  }
})

test('bus and presence paths follow the configured folder', async () => {
  configureSharedFolder('E:\\Shared\\Hub')

  const folder = await resolveSharedFolder(env)

  expect(`${folder}\\bus.jsonl`).toBe('E:\\Shared\\Hub\\bus.jsonl')
  expect(presencePath(folder, 'Hub')).toBe('E:\\Shared\\Hub\\presence\\Hub.json')
  configureSharedFolder(undefined)
})
