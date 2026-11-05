import { isLive, parsePresence, roleFor } from './presence'
import type { Presence, Role } from './presence'

export const ROSTER_REFRESH_MS = 10_000

export type Member = {
  name: string
  role: Role
  account: string
  // ISO time, as in the presence file.
  lastSeen: string
}

export type Roster = readonly Member[]

const UNKNOWN_ACCOUNT = 'unknown'

const fromPresence = (p: Presence): Member => ({
  name: p.name,
  role: p.role,
  account: p.account,
  lastSeen: p.lastSeen,
})

// The Hub first, then by name, so a refresh never reshuffles the rows.
export const sortMembers = (members: Roster): Member[] =>
  [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'hub' ? -1 : 1

    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })

// A join or leave line changes the list at once; the presence files then correct
// it on the next refresh (they are the source of truth for every field).
export const applyPresenceLine = (
  roster: Roster,
  line: { kind: string; from: string; ts?: string },
  nowMs: number,
): Member[] => {
  const others = roster.filter(m => m.name !== line.from)

  if (line.kind === 'leave') return sortMembers(others)

  if (line.kind !== 'join') return sortMembers(roster)

  const existing = roster.find(m => m.name === line.from)
  const stamp = Number.isFinite(Date.parse(line.ts ?? ''))
    ? (line.ts as string)
    : new Date(nowMs).toISOString()

  return sortMembers([
    ...others,
    existing ?? {
      name: line.from,
      role: roleFor(line.from),
      account: UNKNOWN_ACCOUNT,
      lastSeen: stamp,
    },
  ])
}

// Name -> the session id whose `leave` line the Hub applied. A leaving session's
// file outlives its `leave` line by a moment, so a refresh must not re-add it from
// that file. Keyed by session id too: a superseded session's leave for a name must
// not hide the session that now holds it.
export type LeftSet = Map<string, string>

export const markPresenceLine = (
  left: LeftSet,
  line: { kind: string; from: string; fromSession: string },
): void => {
  if (line.kind === 'leave') left.set(line.from, line.fromSession)
  else if (line.kind === 'join') left.delete(line.from)
}

// Rebuilt from the files alone: a session whose file is missing, malformed or
// not live is gone, and so is the session in `left` while its file still exists.
// A mark whose file is gone, or now belongs to another session, has done its job
// and is cleared (this mutates `left`).
export const buildRoster = (
  files: readonly Presence[],
  nowMs: number,
  left?: LeftSet,
): Member[] => {
  const byName = new Map<string, Member>()
  const owner = new Map(files.map(p => [p.name, p.sessionId]))

  for (const [name, sessionId] of [...(left ?? [])]) {
    if (owner.get(name) !== sessionId) left?.delete(name)
  }

  for (const p of files) {
    if (isLive(p, nowMs) && !left?.has(p.name)) byName.set(p.name, fromPresence(p))
  }

  return sortMembers([...byName.values()])
}

export type LoadDeps = {
  // The names in a directory; rejects when it does not exist.
  list: (dir: string) => Promise<string[]>
  read: (path: string) => Promise<string | undefined>
}

// Unreadable files and a missing directory hold nobody.
export const loadPresenceFiles = async (
  deps: LoadDeps,
  dir: string,
): Promise<Presence[]> => {
  let names: string[]

  try {
    names = await deps.list(dir)
  } catch {
    return []
  }

  const found: Presence[] = []

  for (const name of names.filter(n => n.endsWith('.json')).sort()) {
    try {
      const p = parsePresence(await deps.read(`${dir}\\${name}`))

      if (p) found.push(p)
    } catch {
      // one bad file must not hide the rest
    }
  }

  return found
}

export const ago = (lastSeen: string, nowMs: number): string => {
  const seen = Date.parse(lastSeen)

  if (!Number.isFinite(seen)) return 'unknown'

  const s = Math.max(0, Math.round((nowMs - seen) / 1000))

  if (s < 60) return `${s} s ago`

  return s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`
}

export type RosterRefreshDeps = {
  every: (ms: number, fn: () => void) => { cancel: () => void }
  refresh: () => Promise<void>
}

export type RosterRefresh = {
  // Cancels the timer and waits for a refresh in flight.
  stop: () => Promise<void>
}

// Runs once at once, then every ROSTER_REFRESH_MS. Nothing thrown escapes the timer.
export const startRosterRefresh = (deps: RosterRefreshDeps): RosterRefresh => {
  let isStopped = false
  let inFlight: Promise<void> | undefined

  const run = () => {
    if (isStopped || inFlight) return

    inFlight = deps
      .refresh()
      .catch(() => {})
      .finally(() => {
        inFlight = undefined
      })
  }

  const timer = deps.every(ROSTER_REFRESH_MS, run)

  run()

  return {
    stop: async () => {
      isStopped = true
      timer.cancel()
      await inFlight
    },
  }
}
