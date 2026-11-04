// A mod has no process.env; `$.env.get` is the supported way to read it.
// This is the single place the shared folder is resolved (F-015 will make it
// overridable here).
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

export async function resolveSharedFolder($: EnvReader): Promise<string> {
  return sharedFolderFor(await $.env.get('USERPROFILE'))
}
