import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { appendMessage, ensureBusFile, helperPath, removeFile } from './bus-client'
import type { RunFn } from './bus-client'
import { handleClear } from './clear'
import { handleHistory } from './history'
import { startHeartbeat } from './heartbeat'
import type { Heartbeat, HeartbeatIdentity } from './heartbeat'
import { startHubWatch, statusWith } from './hub-watch'
import type { HubWatch } from './hub-watch'
import { makeIsFromLiveHub, routeMessage } from './deliver'
import { withHubSection } from './hub-prompt'
import { handleListSessions, LIST_DESCRIPTION, LIST_SCHEMA, LIST_TOOL } from './list-sessions'
import { createInbox } from './inbox'
import type { Inbox } from './inbox'
import { guardedJoin, join } from './join'
import type { JoinDeps, JoinResult, JoinState } from './join'
import { completeJoin, endSession, leaveSession, markLost } from './leave'
import type { LeaveDeps } from './leave'
import { configureSharedFolder, resolveSharedFolder } from './paths'
import { accountFrom, presencePath, roleFor } from './presence'
import type { Presence } from './presence'
import {
  applyPresenceLine,
  buildRoster,
  loadPresenceFiles,
  markPresenceLine,
  startRosterRefresh,
} from './roster'
import type { LeftSet, RosterRefresh } from './roster'
import { renderRosterPane, ROSTER_PANE } from './roster-pane'
import type { ListenerPos } from '../types'
import { restoreJoin } from './restore'
import { runSelfTest } from './selftest'
import { handleSend, SEND_DESCRIPTION, SEND_SCHEMA, SEND_TOOL } from './send'

// Same ref and shape as roster-pane.tsx's atom: the validator reads a writer's
// atom only from this file, and the pane reads it only from its own.
const rosterAtom = atom({ plugin: 'session-hub', key: 'roster' } as const, [], {
  shape: 'roster-1',
})

const NOT_JOINED_STATUS = 'Session Hub: not joined'

const state: JoinState = { joining: false }

// Recreated on every join and restore (its seen ids come from `$.state`).
let inbox: Inbox | undefined

// The Hub's roster refresh, alive exactly as long as its heartbeat.
let rosterRefresh: RosterRefresh | undefined

// Shared by the pane refresh and list_sessions so they agree.
const leftNames: LeftSet = new Map()

const readText = ($: EngineInterface) => async (path: string): Promise<string | undefined> => {
  if (!(await $.fs.exists(path))) return undefined

  const text = await $.fs.read(path)

  return typeof text === 'string' ? text : undefined
}

const presenceDir = async ($: EngineInterface): Promise<string> =>
  `${await resolveSharedFolder($)}\\presence`

const listDeps = ($: EngineInterface) => ({
  list: async (dir: string) => (await $.fs.list(dir)).map(entry => entry.name),
  read: readText($),
})

const startRoster = ($: EngineInterface): RosterRefresh => {
  leftNames.clear()
  void $.ui.open({ id: ROSTER_PANE, title: 'Sessions' }).catch(() => {})

  return startRosterRefresh({
    every: (ms, fn) => $.clock.every(ms, fn),
    refresh: async () => {
      const files = await loadPresenceFiles(listDeps($), await presenceDir($))
      const rows = buildRoster(files, Date.now(), leftNames)

      await update($, rosterAtom, () => rows)
    },
  })
}

const stopRoster = async ($: EngineInterface): Promise<void> => {
  const running = rosterRefresh

  rosterRefresh = undefined
  await running?.stop().catch(() => {})
  await $.ui.close({ id: ROSTER_PANE }).catch(() => {})
}

const handleBusLine = (line: string): void => {
  void inbox?.handle(line)
}

const makeInbox = ($: EngineInterface, folder: string, seed: readonly string[]): Inbox => {
  const isFromLiveHub = makeIsFromLiveHub({
    read: async path => {
      if (!(await $.fs.exists(path))) return undefined

      const text = await $.fs.read(path)

      return typeof text === 'string' ? text : undefined
    },
    now: () => Date.now(),
    hubPath: presencePath(folder, 'Hub'),
  })

  return createInbox(
    {
      me: () =>
        state.joined && {
          name: state.joined.presence.name,
          sessionId: state.joined.presence.sessionId,
        },
      joining: () => state.joining,
      storePos: pos => $.state.set({ plugin: 'session-hub', key: 'listenerPos' }, pos),
      persist: ids => $.state.set({ plugin: 'session-hub', key: 'seenIds' }, ids),
      // Returned, so the inbox keeps order across the Hub check's file read.
      onMessage: message => {
        if (rosterRefresh && (message.kind === 'join' || message.kind === 'leave')) {
          markPresenceLine(leftNames, message)
          void update($, rosterAtom, rows => applyPresenceLine(rows, message, Date.now())).catch(
            () => {},
          )
        }

        return routeMessage(message, {
          me: () =>
            state.joined && {
              name: state.joined.presence.name,
              role: state.joined.presence.role,
            },
          submit: text => $.prompt.submit({ text }),
          notify: text => $.ui.toast(`Session Hub: ${text}`),
          log: text => $.ui.log(text, { to: 'debug' }),
          isFromLiveHub,
        })
      },
      log: text => $.ui.log(text, { to: 'debug' }),
    },
    seed,
  )
}

// Through the inbox's chain: a position is stored only after its batch's lines were handled.
const onPos = (pos: ListenerPos): void => {
  void inbox?.position(pos)
}

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

// The position and seen ids belong to one join: they go with it.
const clearStored = ($: EngineInterface) => async (): Promise<void> => {
  await storeJoined($, null)
  await $.state.set({ plugin: 'session-hub', key: 'listenerPos' }, null)
  await $.state.set({ plugin: 'session-hub', key: 'seenIds' }, [])
}

// A beat's failure is reported once per streak (the heartbeat guarantees it);
// losing the name unjoins this session.
const beat = ($: EngineInterface, id: HeartbeatIdentity): Heartbeat => {
  const isHub = roleFor(id.name) === 'hub'
  const heartbeat = startHeartbeat(
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
        if (isHub) void stopRoster($)

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

  if (!isHub) return heartbeat

  // Leave, session.end and a restore all stop the heartbeat, so the roster
  // and its pane follow it without those paths knowing about them.
  rosterRefresh = startRoster($)

  return {
    stop: async () => {
      await heartbeat.stop()
      await stopRoster($)
    },
  }
}

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

export const register: Register = (on, options) => {
  const folderOption = configureSharedFolder(options.sharedFolder)

  on('session.start', async ($, e, next) => {
    const started = await next(e)

    if (folderOption.warning) $.ui.toast(`Session Hub: ${folderOption.warning}`)

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
    await $.command.register({
      name: 'hub-history',
      description: 'Show the last messages on the Session Hub bus: /hub-history [count]',
    })
    await $.command.register({
      name: 'hub-clear',
      description: 'Archive the Session Hub log and start an empty one (Hub only)',
    })
    // Registered at session start (the earliest it is accepted); a call while
    // unjoined is refused by handleSend.
    await $.tool.register({
      name: SEND_TOOL,
      description: SEND_DESCRIPTION,
      inputSchema: SEND_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: LIST_TOOL,
      description: LIST_DESCRIPTION,
      inputSchema: LIST_SCHEMA,
      isDeferred: false,
    })

    // After a mod reload `$.state` still says we are joined; a fresh session has
    // nothing stored. Never lets a failure here break session start.
    try {
      const { value } = await $.state.get({
        plugin: 'session-hub',
        key: 'joined',
      })

      const folder = await resolveSharedFolder($)
      const pos = await $.state.get({ plugin: 'session-hub', key: 'listenerPos' })
      const ids = await $.state.get({ plugin: 'session-hub', key: 'seenIds' })

      inbox = makeInbox($, folder, Array.isArray(ids.value) ? ids.value : [])

      await restoreJoin(state, value, {
        spawn: request => $.process.spawn(request),
        helper: helperPath($.plugin.root),
        folder,
        log: text => $.ui.log(text, { to: 'debug' }),
        busPath: `${folder}\\bus.jsonl`,
        storedPos: pos.value,
        waitMs: ms => $.clock.sleep(ms),
        onLine: handleBusLine,
        onPos,
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

  // The cast: the generated tool names list only built-in and connected MCP tools.
  on('tool.call', { tool: `mcp__session-hub__${SEND_TOOL}` as never }, async ($, e) => {
    const run: RunFn = (argv, init) => $.process.run(argv, init)
    const input = e as { to?: unknown; body?: unknown; replyTo?: unknown }

    return handleSend(input, {
      state,
      sessionId: () => $.session.id(),
      now: () => Date.now(),
      random: Math.random,
      append: async message =>
        appendMessage(
          run,
          helperPath($.plugin.root),
          `${await resolveSharedFolder($)}\\bus.jsonl`,
          message,
        ),
    })
  })

  on('tool.call', { tool: `mcp__session-hub__${LIST_TOOL}` as never }, async $ =>
    handleListSessions({
      state,
      now: () => Date.now(),
      left: leftNames,
      presenceDir: () => presenceDir($),
      ...listDeps($),
    }),
  )

  on('tool.describe', { tool: `mcp__session-hub__${LIST_TOOL}` as never }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: false,
  }))

  on('ui.render', { component: 'Pane', requestId: ROSTER_PANE }, ($, e) =>
    renderRosterPane($, e as never),
  )

  // Keeps the schema in the prompt's tool list, not behind ToolSearch (the model
  // otherwise reaches for built-in session messaging). Same cast as above.
  on('tool.describe', { tool: `mcp__session-hub__${SEND_TOOL}` as never }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: false,
  }))

  // Only while joined; a failure falls back to the engine's own prompt. Not cached
  // (it runs for every prompt sent), so a join or leave shows on the next turn.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    try {
      const p = state.joined?.presence

      return {
        ...composed,
        sections: withHubSection(
          composed.sections,
          p && { name: p.name, role: p.role },
          (id, text) => ({ id, text, scope: 'session' }),
        ),
      }
    } catch {
      return composed
    }
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
        onPos,
      }

      // A fresh join starts at `end`: nothing stored by an earlier join applies.
      inbox = makeInbox($, folder, [])
      await clearStored($)().catch(() => {})

      const myInbox = inbox
      let kept = false

      try {
        const joined = await join(deps, name)

        if (joined.ok) {
          // Inside the guard, so a /hub-leave can never find a joined state
          // without its heartbeat, and a session.end during the join is honoured.
          const p = joined.joined.presence
          const path = presencePath(folder, p.name)

          kept = await completeJoin(state, joined.joined, await leaveDeps($), {
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

          if (!kept) return { ok: false, reason: 'the session ended during the join' }
        }

        return joined
      } finally {
        // Lines held during the join are delivered if it held, dropped if it did not.
        if (kept) await myInbox?.release()
        else myInbox?.discard()
      }
    })

    if (!result.ok) return { text: `Join refused: ${result.reason}` }

    // The first Hub check may already have run: keep its answer.
    $.ui.status(statusWith(result.joined.presence, state.hubAway === true))

    return {
      text: `Joined as ${result.joined.presence.name} (${result.joined.presence.role}).`,
    }
  })

  on('command.run', { command: 'hub-history' }, async ($, e) => ({
    text: await handleHistory(e.args, {
      run: (argv, init) => $.process.run(argv, init),
      helper: helperPath($.plugin.root),
      busPath: `${await resolveSharedFolder($)}\\bus.jsonl`,
    }),
  }))

  on('command.run', { command: 'hub-clear' }, async $ => {
    const run: RunFn = (argv, init) => $.process.run(argv, init)
    const helper = helperPath($.plugin.root)
    const busPath = `${await resolveSharedFolder($)}\\bus.jsonl`

    return {
      text: await handleClear({
        state,
        run,
        helper,
        busPath,
      }),
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
