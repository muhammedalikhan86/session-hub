import { clearBus } from './bus-client'
import type { RunFn } from './bus-client'
import type { JoinState } from './join'

export type ClearDeps = {
  state: Pick<JoinState, 'joined' | 'joining' | 'leaving'>
  run: RunFn
  helper: string
  busPath: string
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const handleClear = async (deps: ClearDeps): Promise<string> => {
  const joined = deps.state.joined

  if (!joined || deps.state.leaving) return 'Join as Hub first.'
  if (joined.presence.role !== 'hub') return 'Only the Hub can clear the log.'

  let archived: string

  try {
    archived = await clearBus(deps.run, deps.helper, deps.busPath)
  } catch (error) {
    return `Could not clear the log: ${messageOf(error)}`
  }

  return archived === '' ? 'Cleared. There was no log to archive.' : `Cleared. Archived to ${archived}.`
}
