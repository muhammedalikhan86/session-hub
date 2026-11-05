import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-hub',
  component: 'Pane',
  requestId: 'session-hub-roster',
  props: {
    title: 'Sessions',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('F-012: the pane lists each live session by name, role and account', async ($, on) => {
  const seen = new Date().toISOString()

  on('state.get', () => ({
    value: {
      value: {
        shape: 'roster-1',
        value: [
          { name: 'Hub', role: 'hub', account: 'muhammed', lastSeen: seen },
          { name: 'Reports', role: 'worker', account: 'neeraj', lastSeen: seen },
        ],
      },
      version: 1,
    },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const row = await ui.find({ type: 'Text', text: /Reports/ })

  expect(row?.text).toMatch(/Reports\s+worker\s+neeraj\s+\d+ s ago/)
  await ui.unmount()
})

test('F-012: the pane says so when no session is live', async ($, on) => {
  on('state.get', () => ({ value: { value: [], version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('No live sessions.')
  await ui.unmount()
})
