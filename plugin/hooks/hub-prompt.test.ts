import { expect, test } from 'claude-code/testing'

import { HUB_PROMPT_ID, hubPromptText, withHubSection } from './hub-prompt'

test('B-001: the joined prompt names the send tool and the session\'s role', () => {
  const hub = hubPromptText({ name: 'Hub', role: 'hub' })

  expect(hub).toContain('mcp__session-hub__send')
  expect(hub).toContain('Hub')
  expect(hub).toContain('"*"')

  const worker = hubPromptText({ name: 'Reports', role: 'worker' })

  expect(worker).toContain('mcp__session-hub__send')
  expect(worker).toContain('Reports')
  expect(worker).toContain('Hub only')
  expect(worker).toContain('replyTo')
})

test('B-001: no section is added when not joined, one is added last when joined', () => {
  const base = [{ id: 'intro' }]
  const make = (id: string, text: string) => ({ id, text })

  expect(withHubSection(base, undefined, make)).toEqual(base)

  const out = withHubSection(base, { name: 'Hub', role: 'hub' }, make)

  expect(out.map(s => s.id)).toEqual(['intro', HUB_PROMPT_ID])
})

test('F-012: only the Hub is told about list_sessions', () => {
  expect(hubPromptText({ name: 'Hub', role: 'hub' })).toContain('mcp__session-hub__list_sessions')
  expect(hubPromptText({ name: 'Reports', role: 'worker' })).not.toContain('list_sessions')
})
