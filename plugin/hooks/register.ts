import type { EngineInterface, Register } from 'claude-code'

import { ensureBusFile, helperPath, removeFile } from './bus-client'
import type { RunFn } from './bus-client'
import { startHeartbeat } from './heartbeat'
import type { Heartbeat, HeartbeatIdentity } from './heartbeat'
import { startHubWatch, statusWith } from './hub-watch'
import type { HubWatch } from './hub-watch'
import { guardedJoin, join } from './join'
import type { JoinDeps, JoinResult, JoinState } from './join'
import { completeJoin, endSession, leaveSession, markLost } from './leave'
import type { LeaveDeps } from './leave'
import { parseLine } from './message'
import { resolveSharedFolder } from './paths'
import { accountFrom, presencePath } from './presence'
import type { Presence } from './presence'
import { restoreJoin } from './restore'
import { runSelfTest } from './selftest'

const NOT_JOINED_STATUS = 'Session Hub: not joined'

// What the next line from the bus does is F-009's to build; for now a line is
// only parsed.
const handleBusLine = (line: string): void => {
  void parseLine(line)
}

const state: JoinState = { joining: false }

const storeJoined = (
  $: EngineInterface,
  value: Presence | null,
  path?: string,
): Promise<unknown> =>
  $.state.set(
    { plugin: 'session-hub', key: 'joined' },
    value && path
      ? {
          name: value.name,
          role: value.role,
          presencePath: path,
          startedAt: value.startedAt,
          sessionId: value.sessionId,
          account: value.account,
        }
      : null,
  )

const clearStored = ($: EngineInterface) => async (): Promise<void> => {
  await storeJoined($, null)
}

// A beat's failure is reported once per streak (the heartbeat guarantees it);
// losing the name unjoins this session.
const beat = ($: EngineInterface, id: HeartbeatIdentity): Heartbeat =>
  startHeartbeat(
    {
      read: async path => {
        if (!(await $.fs.exists(path))) return undefined

        const text = await $.fs.read(path)

        return typeof text === 'string' ? text : undefined
      },
      write: (path, text) => $.fs.write(path, text),
      now: () => Date.now(),
      every: (ms, fn) => $.clock.every(ms, fn),
      onLost: () => {
        void markLost(state, {
          clearStored: clearStored($),
          notify: text => {
            $.ui.status(NOT_JOINED_STATUS)
            $.ui.toast(text)
          },
        })
      },
      onFailure: message =>
        $.ui.toast(`Session Hub: could not refresh presence (${message})`),
    },
    id,
  )

// Hub-away only changes the status line and `state.hubAway`: the heartbeat,
// the listener and the join are left alone, so queued work is kept.
const watchHub = (
  $: EngineInterface,
  folder: string,
  p: Presence,
): HubWatch =>
  startHubWatch(
    {
      read: async path => {
        if (!(await $.fs.exists(path))) return undefined

        const text = await $.fs.read(path)

        return typeof text === 'string' ? text : undefined
      },
      now: () => Date.now(),
      every: (ms, fn) => $.clock.every(ms, fn),
      onChange: isAway => {
        if (state.joined?.presence.sessionId !== p.sessionId || state.leaving) return

        state.hubAway = isAway
        $.ui.status(statusWith(p, isAway))
      },
    },
    presencePath(folder, 'Hub'),
  )

const leaveDeps = async ($: EngineInterface): Promise<LeaveDeps> => {
  const run: RunFn = (argv, init) => $.process.run(argv, init)

  return {
    folder: await resolveSharedFolder($),
    helper: helperPath($.plugin.root),
    run,
    now: () => Date.now(),
    random: Math.random,
    read: async path => {
      if (!(await $.fs.exists(path))) return undefined

      const text = await $.fs.read(path)

      return typeof text === 'string' ? text : undefined
    },
    remove: path => removeFile(run, path),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: 'hub-selftest',
      description:
        'Check that Session Hub can use its shared folder with no permission prompt',
    })
    await $.command.register({
      name: 'hub-join',
      description: 'Join Session Hub under a name: /hub-join <name>',
    })
    await $.command.register({
      name: 'hub-leave',
      description: 'Leave Session Hub and free this session\'s name',
    })

    // After a mod reload `$.state` still says we are joined; a fresh session has
    // nothing stored. Never lets a failure here break session start.
    try {
      const { value } = await $.state.get({
        plugin: 'session-hub',
        key: 'joined',
      })

      const folder = await resolveSharedFolder($)

      await restoreJoin(state, value, {
        read: async path => {
          if (!(await $.fs.exists(path))) return undefined

          const text = await $.fs.read(path)

          return typeof text === 'string' ? text : undefined
        },
        now: () => Date.now(),
        sessionId: await $.session.id(),
        startHeartbeat: id => beat($, id),
        setStatus: text => $.ui.status(text),
        startHubWatch: () => watchHub($, folder, state.joined!.presence),
        clearStored: clearStored($),
      })
    } catch (error) {
      $.ui.status(`Session Hub: could not restore the join: ${String(error)}`)
    }

    // Not awaited: a failure here must never hold up or break session start.
    // Skipped when a join was restored, so the self-test does not overwrite its status.
    if (!state.joined) {
      void runSelfTest($)
        .then(result => $.ui.status(result.summary))
        .catch(error =>
          $.ui.status(`Session Hub self-test crashed: ${String(error)}`),
        )
    }

    return started
  })

  on('session.end', async ($, e, next) => {
    // Best effort inside the exit's short bound; a crash or a cut-off leaves
    // the stale rule (30 s) to free the name.
    try {
      await endSession(
        state,
        e.sessionId,
        await leaveDeps($),
        async () => {
          await clearStored($)()
          $.ui.status(NOT_JOINED_STATUS)
        },
        ms => $.clock.sleep(ms),
      )
    } catch {
      // the session is ending anyway
    }

    return next(e)
  })

  on('command.run', { command: 'hub-selftest' }, async $ => {
    const result = await runSelfTest($)

    return { text: `${result.summary}\n\n${result.text}` }
  })

  on('command.run', { command: 'hub-join' }, async ($, e) => {
    const name = e.args.trim()

    if (name === '') return { text: 'Usage: /hub-join <name>' }

    const sessionId = await $.session.id()
    const result = await guardedJoin(state, sessionId, async (): Promise<JoinResult> => {
      const folder = await resolveSharedFolder($)
      const account = accountFrom(await $.env.get('CLAUDE_CONFIG_DIR'))
      const run: RunFn = (argv, init) => $.process.run(argv, init)
      const deps: JoinDeps = {
        folder,
        helper: helperPath($.plugin.root),
        sessionId,
        account,
        now: () => Date.now(),
        random: Math.random,
        sleep: ms => $.clock.sleep(ms),
        read: async path => {
          if (!(await $.fs.exists(path))) return undefined

          const text = await $.fs.read(path)

          return typeof text === 'string' ? text : undefined
        },
        write: (path, text) => $.fs.write(path, text),
        waitMs: ms => $.clock.sleep(ms),
        remove: path => removeFile(run, path),
        ensureBus: busPath => ensureBusFile(run, busPath),
        spawn: request => $.process.spawn(request),
        run,
        onLine: handleBusLine,
        onPos: pos => {
          void $.state.set({ plugin: 'session-hub', key: 'listenerPos' }, pos)
        },
      }

      const joined = await join(deps, name)

      if (joined.ok) {
        // Inside the guard, so a /hub-leave can never find a joined state
        // without its heartbeat, and a session.end during the join is honoured.
        const p = joined.joined.presence
        const path = presencePath(folder, p.name)
        const isKept = await completeJoin(state, joined.joined, await leaveDeps($), {
          store: () => storeJoined($, p, path),
          clearStored: clearStored($),
          startHeartbeat: () =>
            beat($, {
              name: p.name,
              sessionId: p.sessionId,
              account: p.account,
              startedAt: p.startedAt,
              path,
            }),
          startHubWatch: () => watchHub($, folder, p),
        })

        if (!isKept) return { ok: false, reason: 'the session ended during the join' }
      }

      return joined
    })

    if (!result.ok) return { text: `Join refused: ${result.reason}` }

    // The first Hub check may already have run: keep its answer.
    $.ui.status(statusWith(result.joined.presence, state.hubAway === true))

    return {
      text: `Joined as ${result.joined.presence.name} (${result.joined.presence.role}).`,
    }
  })

  on('command.run', { command: 'hub-leave' }, async $ => {
    const result = await leaveSession(state, await leaveDeps($), async () => {
      await clearStored($)()
      $.ui.status(NOT_JOINED_STATUS)
    })

    return { text: result.ok ? result.text : `Leave refused: ${result.reason}` }
  })
}
