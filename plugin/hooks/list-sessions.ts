import { ago, buildRoster } from './roster'
import type { LeftSet, LoadDeps } from './roster'
import { loadPresenceFiles } from './roster'
import type { JoinState } from './join'

export const LIST_TOOL = 'list_sessions'

export const LIST_DESCRIPTION =
  'List the live Session Hub sessions: name, role, account and when each was last seen. Hub only.'

export const LIST_SCHEMA = { type: 'object', properties: {} }

export type ListDeps = LoadDeps & {
  state: Pick<JoinState, 'joined' | 'leaving'>
  presenceDir: () => Promise<string>
  now: () => number
  // The same set the pane's refresh uses, so the two lists agree.
  left: LeftSet
}

export type ListResult = { result: string } | { deny: string }

// Reads the presence files afresh, so the answer never waits on the pane's timer.
export const handleListSessions = async (deps: ListDeps): Promise<ListResult> => {
  const joined = deps.state.joined

  if (!joined || deps.state.leaving) {
    return {
      deny: 'Not available: this session has not joined Session Hub. Ask the user to run /hub-join <name>.',
    }
  }

  if (joined.presence.role !== 'hub') {
    return { deny: 'Not available: only the Hub can list sessions' }
  }

  const now = deps.now()
  const files = await loadPresenceFiles(deps, await deps.presenceDir())
  const rows = buildRoster(files, now, deps.left).map(m => ({
    name: m.name,
    role: m.role,
    account: m.account,
    lastSeen: m.lastSeen,
    lastSeenAgo: ago(m.lastSeen, now),
  }))

  return { result: JSON.stringify(rows, null, 2) }
}
