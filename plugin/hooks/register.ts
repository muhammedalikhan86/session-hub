import type { Register } from 'claude-code'

import { runSelfTest } from './selftest'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: 'hub-selftest',
      description:
        'Check that Session Hub can use its shared folder with no permission prompt',
    })

    // Not awaited: a failure here must never hold up or break session start.
    void runSelfTest($)
      .then(result => $.ui.status(result.summary))
      .catch(error =>
        $.ui.status(`Session Hub self-test crashed: ${String(error)}`),
      )

    return started
  })

  on('command.run', { command: 'hub-selftest' }, async $ => {
    const result = await runSelfTest($)

    return { text: `${result.summary}\n\n${result.text}` }
  })
}
