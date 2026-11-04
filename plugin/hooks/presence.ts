import { isValidSessionName } from './message'

export const STALE_MS = 30_000
export const RACE_WAIT_MS = 400

export type Role = 'hub' | 'worker'

export type Presence = {
  name: string
  sessionId: string
  account: string
  role: Role
  startedAt: string
  lastSeen: string
}

export type PresenceDeps = {
  // undefined when the file does not exist.
  read: (path: string) => Promise<string | undefined>
  write: (path: string, text: string) => Promise<void>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export type ClaimResult =
  | { ok: true; presence: Presence }
  | { ok: false; reason: string }

export const roleFor = (name: string): Role =>
  name === 'Hub' ? 'hub' : 'worker'

export const accountFrom = (configDir: string | undefined): string => {
  const base = configDir
    ?.trim()
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop()

  return base || 'default'
}

export const presencePath = (folder: string, name: string): string =>
  `${folder}\\presence\\${name}.json`

// An unreadable or malformed file holds nobody, so it counts as free.
export const parsePresence = (
  text: string | undefined,
): Presence | undefined => {
  if (text === undefined) return undefined

  try {
    const data: unknown = JSON.parse(text)

    if (typeof data !== 'object' || data === null) return undefined

    const p = data as Record<string, unknown>

    if (
      typeof p.name === 'string' &&
      typeof p.sessionId === 'string' &&
      typeof p.account === 'string' &&
      (p.role === 'hub' || p.role === 'worker') &&
      typeof p.startedAt === 'string' &&
      typeof p.lastSeen === 'string'
    ) {
      return p as unknown as Presence
    }
  } catch {
    // malformed: holds nobody
  }

  return undefined
}

export const isLive = (p: Presence, nowMs: number): boolean => {
  const seen = Date.parse(p.lastSeen)

  return Number.isFinite(seen) && nowMs - seen < STALE_MS
}

const takenReason = (name: string): string =>
  `The name "${name}" is held by a live session. Choose another name.`

// Free: no file, a stale file, or a file that already holds this session.
export const checkFree = async (
  deps: PresenceDeps,
  folder: string,
  name: string,
  sessionId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const held = parsePresence(await deps.read(presencePath(folder, name)))

  if (held && held.sessionId !== sessionId && isLive(held, deps.now())) {
    return { ok: false, reason: takenReason(name) }
  }

  return { ok: true }
}

// F-006 will rewrite this on a timer with a fresh `lastSeen`.
export const buildPresence = (
  name: string,
  sessionId: string,
  account: string,
  nowMs: number,
  startedAt?: string,
): Presence => {
  const stamp = new Date(nowMs).toISOString()

  return {
    name,
    sessionId,
    account,
    role: roleFor(name),
    startedAt: startedAt ?? stamp,
    lastSeen: stamp,
  }
}

// Whole-file writes cannot be exclusive, so: write, wait, re-read. Of two
// claimers the later writer's file stays and both see it, so one backs off (ADR-003).
export const claimName = async (
  deps: PresenceDeps,
  folder: string,
  name: string,
  sessionId: string,
  account: string,
): Promise<ClaimResult> => {
  if (!isValidSessionName(name)) {
    return { ok: false, reason: `"${name}" is not a valid session name.` }
  }

  const free = await checkFree(deps, folder, name, sessionId)

  if (!free.ok) return free

  const presence = buildPresence(name, sessionId, account, deps.now())
  const path = presencePath(folder, name)

  await deps.write(path, JSON.stringify(presence, null, 2))
  await deps.sleep(RACE_WAIT_MS)

  const after = parsePresence(await deps.read(path))

  if (after?.sessionId !== sessionId) {
    return { ok: false, reason: takenReason(name) }
  }

  return { ok: true, presence }
}
