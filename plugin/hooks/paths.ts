// A mod has no process.env; `$.env.get` is the supported way to read it.
// This is the single place the shared folder is resolved; the `sharedFolder`
// mod option (F-015) overrides the default here and nowhere else.
export const SHARED_FOLDER_NAME = '.claude-session-hub'

export type EnvReader = {
  env: { get: (name: string) => Promise<string | undefined> }
}

export const sharedFolderFor = (userProfile: string | undefined): string => {
  const profile = userProfile?.trim().replace(/[\\/]+$/, '')

  if (!profile) {
    throw new Error(
      'USERPROFILE is not set, so the shared folder cannot be resolved',
    )
  }

  return `${profile}\\${SHARED_FOLDER_NAME}`
}

export type SharedFolderOption = { path?: string; warning?: string }

// Blank means "use the default"; anything else must be an absolute Windows path
// (drive letter or UNC). A bad value gives a warning and no path, never a throw.
export const parseSharedFolderOption = (raw: unknown): SharedFolderOption => {
  if (raw === undefined || raw === null) return {}

  if (typeof raw !== 'string') {
    return { warning: 'the sharedFolder option is not text, so the default folder is used' }
  }

  const trimmed = raw.trim()

  if (trimmed === '') return {}

  const path = trimmed.replace(/\//g, '\\').replace(/\\+$/, '')
  const isDrivePath = /^[A-Za-z]:\\[^\\]/.test(path)
  const isUnc = /^\\\\[^\\]+\\[^\\]+/.test(path)

  if (!isDrivePath && !isUnc) {
    return {
      warning: `the sharedFolder option "${trimmed}" is not an absolute Windows path (like C:\\Hub), so the default folder is used`,
    }
  }

  return { path }
}

// Set from `register`'s options; a reload runs `register` again and sets it afresh.
let configured: string | undefined

export const configureSharedFolder = (raw: unknown): SharedFolderOption => {
  const option = parseSharedFolderOption(raw)

  configured = option.path

  return option
}

export async function resolveSharedFolder($: EnvReader): Promise<string> {
  return configured ?? sharedFolderFor(await $.env.get('USERPROFILE'))
}
