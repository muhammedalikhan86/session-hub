import { atom, read } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import { ago } from './roster'

export const ROSTER_PANE = 'session-hub-roster'

// Change the tag when a row's fields change: it declines what an earlier
// version stored, which outlives a reload.
export const rosterAtom = atom({ plugin: 'session-hub', key: 'roster' } as const, [], {
  shape: 'roster-1',
})

export async function renderRosterPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const { Box, Text } = $.ui.resolve(e)
  const rows = await read($, rosterAtom)
  const now = Date.now()

  return (
    <Box flexDirection="column">
      {rows.length === 0 && <Text dimColor>No live sessions.</Text>}
      {rows.length > 0 && <Text bold>name  role  account  last seen</Text>}
      {rows.map(m => (
        <Text>
          {m.name}  {m.role}  {m.account}  {ago(m.lastSeen, now)}
        </Text>
      ))}
    </Box>
  )
}
