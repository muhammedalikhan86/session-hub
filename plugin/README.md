# session-hub

A Claude Code mod, built in phases. So far (Phases 1 to 3) it holds the F-001 permission
spike, the bus helper (`append`, `tail`), the message model (`hooks/message.ts`: build, serialise,
parse), `/hub-join` and `/hub-leave`, the presence heartbeat and the Hub-away state, the `send` tool
(F-008), the listener filter (F-009), delivery as prompts and notices (F-010) and the Hub authority
check (F-011). `/hub-clear`, `/hub-history`, the pane and `list_sessions` are not built yet. F-001 proves
that the mod's own file and process calls work against the shared folder
`%USERPROFILE%\.claude-session-hub` with **no permission prompt**.

The folder is resolved in `hooks/paths.ts` with `$.env.get('USERPROFILE')`
(a mod has no `process.env`), the one place to override it later.

## Manual test (F-001)

1. In each account's terminal (each with its own `CLAUDE_CONFIG_DIR`) run:
   `claude --plugin-dir C:\Users\muhammedali.khan\source\repos\session-hub\plugin`
2. At session start a one-line self-test summary appears in the status line.
3. Run `/hub-selftest` in each account.
4. Watch for any permission prompt. There should be none. The final list shows
   one `<sessionId>.json` per session that has run the test, across accounts.

## Steps

- (a) create the shared folder and `selftest\` (`$.fs.write` creates directories)
- (b) write `selftest\<sessionId>.json` (session id, time, config dir if set)
- (c) read it back (`$.fs.read`) and compare
- (d) list `selftest\` (`$.fs.list`)
- (e) `$.process.run` of `powershell.exe` that prints a line
- (f) `$.process.spawn` of `powershell.exe` printing 3 lines ~300 ms apart,
  streamed to the end

## Bus helper

`bin/bus.ps1` does every write to the shared `bus.jsonl` (the mod API can only
write whole files). Windows PowerShell 5.1 compatible; verbs are dispatched in
one table so `clear` can be added later (F-014).

    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File bin\bus.ps1 append -Path <bus file> -LineBase64 <base64>

- `-LineBase64` is the base64 of the UTF-8 bytes of one JSON line, without a
  trailing newline. An empty line, or one containing `\n` or `\r`, is rejected.
- It takes the named mutex `Local\ClaudeSessionHubBus` (waits up to 2 s),
  creates the folder and file if missing, and appends the line plus `\n` in a
  single write, sharing the file with readers (`ReadWrite|Delete`).
- Exit 0 and no stdout on success. Non-zero with a message on stderr on bad
  input (2), mutex timeout (3, file untouched) or an I/O error (1).
- `tail` (F-003): `bin\bus.ps1 tail -Path <bus file> -From <fileid>:<offset>|end`
  polls about once a second until killed. It takes no lock and uses no change
  notifications; it opens the file with `ReadWrite|Delete` for each pass only,
  so appends and a rename are never blocked, and reads only the new bytes.
  It prints each complete line verbatim (UTF-8) and never moves past an
  unfinished line. It also prints `#pos <fileid>:<offset>` (file id is the NTFS
  identity, hex `<volserial>-<indexhigh><indexlow>`) at start and after each
  batch, so the caller can store where it is. `end` starts at the current end
  (0 if the file does not exist yet; it waits for the file). A changed file id,
  or a size below the offset, warns on stderr and restarts at 0; reading the
  archived file after a clear is F-014. Bad `-From` exits 2.
- Tests: `pwsh -NoProfile -Command "Invoke-Pester plugin/tests -CI"`. They use
  the same mutex, so run them serially and not while a real Session Hub runs.
  `tests/bus.roundtrip.Tests.ps1` (TC-040) also needs node 22.18+ (it runs
  `tests/e2e-roundtrip.mjs`, which imports `hooks/message.ts` with native type
  stripping) and skips with a visible reason if node is absent.

## /hub-join (F-005)

`/hub-join <name>` joins this session to the hub under `<name>` (1 to 32 of `A-Z a-z 0-9 _ -`).
`Hub` is the session that gives orders; any other name is a worker. In order:

1. check `presence\<name>.json`: a name whose `lastSeen` is under 30 s old (held by another
   session) is refused with "choose another name"; a stale file or this session's own counts as free
2. make sure `bus.jsonl` exists, then start `bus.ps1 tail -From end` and wait for its first `#pos`
   line (so the listener is provably running before the join line)
3. claim the name: write `presence\<name>.json`, wait 400 ms, re-read; if another sessionId is
   there, back off and refuse (two sessions claiming at once: exactly one wins)
4. append a `join` line (to `*`, body `joined`)

Any failure after step 1 stops the listener and removes the presence file. The status line then
reads `Session Hub: <name> (Hub)` or `Session Hub: <name> (worker)`.

## Listener filter (F-009)

Every bus line goes through `hooks/inbox.ts`: an unparseable line is logged (debug log) and skipped;
a line from this name or this session id, a line to another name, and a repeated `id` are dropped;
anything else is recorded as seen and handed to `routeMessage` (`hooks/deliver.ts`, F-010). The name is read at line time. The last 500 seen ids are kept in `$.state`
(`session-hub.seenIds`) and written before each delivery, so a replay after a mod reload (from the
stored `#pos`, `session-hub.listenerPos`) delivers nothing twice. Both keys are cleared at every
`/hub-join` and on leave, so one join's position never serves another.

While `/hub-join` is still completing (the listener is already reading, the name is not yet known), lines
are held in arrival order (at most 500) instead of dropped. When the join completes they go through the
filter above, in order, before any later line; if the join fails or is released they are discarded. The
`#pos` of a batch is stored through the same ordered queue, only after that batch's lines were persisted
and delivered, and never past held lines.

## Delivery (F-010)

`hooks/deliver.ts` routes each delivered message. Only `$.prompt.submit` reaches the model (it starts
its own turn once the session is idle, ADR-004); everything else is a toast the model never reads.

| Where / line | Result |
|---|---|
| worker, `order` that passes `isFromLiveHub` | submit `[Hub order #<id> to <my name>] <body>` + a line `(reply with the send tool, replyTo "<id>")` |
| worker, `order` that fails it | toast `Ignored an order from <from>: only the Hub can give orders` |
| Hub, `reply` with `replyTo` | submit `[Reply from <from> to #<replyTo>] <body>` |
| Hub, `reply` without `replyTo` (unprompted) | submit `[Message from <from>] <body>` |
| Hub, `order` | toast, never submitted |
| `info` | toast |
| `join` / `leave` | toast in the Hub, debug log in a worker |

The body is passed through untouched after the frame. A `submit` rejection is logged and toasted; it
is never retried and the id stays seen (a possibly lost order is preferred to a duplicate run). The
authority check is injected as `isFromLiveHub` (`makeIsFromLiveHub`, F-011): an order is acted on only
if `from` is `Hub` and `fromSession` equals the `sessionId` in a fresh (under 30 s) `presence\Hub.json`.
A missing, unreadable, malformed or stale file, or a different session id, fails the check, so a
hand-written `from: Hub` line is shown as the notice and never queued. If the session leaves (or
re-joins under another name) while the check reads the file, the order is dropped with a debug log.
The inbox awaits each delivery, so orders are submitted in arrival order.

## Heartbeat and /hub-leave (F-006)

- While joined, `hooks/heartbeat.ts` rewrites `presence\<name>.json` with a fresh `lastSeen` every
  10 s (`startedAt` kept). A missing file is recreated. If the file now holds another session (the
  name was taken over, e.g. after the machine slept over 30 s), it is not overwritten: the
  heartbeat and listener stop, the session is unjoined and a toast says to `/hub-join` again.
- `/hub-leave` (`hooks/leave.ts`): refused with "not joined" when not joined. Otherwise it stops the
  heartbeat and the Hub watcher, appends a `leave` line, stops the listener, then deletes the presence file only if it
  is still this session's. If the append fails the name is still released and the failure reported.
- On `session.end` the same release runs, best effort inside the exit's short time bound. A crash
  or a cut-off needs nothing: nobody refreshes `lastSeen`, so the name is free after 30 s. Only the
  ended session's id is barred from joining; after `/clear` (new id, no `session.start`) `/hub-join` works.
- The joined identity is kept in `$.state` (`session-hub.joined`). After a mod reload, `session.start`
  restarts the heartbeat, the status line and the listener (from the stored `listenerPos`, else `end`)
  if the presence file is still this session's and fresh. A listener that does not start leaves the join and
  heartbeat in place and says so in the status line.

## Hub away (F-007)

- A worker (never the Hub) runs `hooks/hub-watch.ts`: it checks `presence\Hub.json` once at start and
  then every 10 s. The Hub is away when the file is missing, unreadable or malformed, or its
  `lastSeen` is 30 s or older (same `parsePresence` / `isLive` rule as the name check).
- While away the status line reads `Session Hub: <name> (worker) — Hub away — waiting`; when the Hub is
  back it returns to `Session Hub: <name> (worker)`. The status is written only when the state changes.
- Away is only a flag (`JoinState.hubAway`, shown in the status line). Delivery does not read it: the F-011 check reads `presence\Hub.json` itself for each order. The heartbeat, the listener and
  the join keep running and nothing is cleared, so queued work is kept (FR-012).
- The watcher starts with the heartbeat (after a worker join, and on restore after a mod reload) and
  stops wherever the heartbeat stops (`/hub-leave`, `session.end`, a join released because its session
  ended, a lost name). Stopping waits for a check in flight, so no status is written after a leave.

Code: `hooks/presence.ts` (free/stale/claim/race), `hooks/join.ts` (the sequence),
`hooks/listener.ts` (spawn and line splitting), `hooks/bus-client.ts` (append, ensure file).
Test: `tests/hub-join.Tests.ps1` runs `tests/e2e-join.mjs` against the real `bus.ps1`.

## send tool (F-008)

- `hooks/send.ts` is the model's `mcp__session-hub__send` tool, registered at `session.start` (the
  earliest registering is accepted) with one schema: `body` (required), `to` and `replyTo` (optional).
  A call while not joined is refused, so there is no register-on-join step to keep in step with leave.
- The mod stamps `id`, `ts`, `from`, `fromSession` (the session id at call time, so `/clear` is
  followed) and `kind`; the model's values for these are ignored.
- In the Hub: `kind` is `order`, `to` must be a session name or `*` (not the Hub itself). In a worker:
  `to` is always `Hub`, `kind` is `reply`, `replyTo` is passed through when given.
- A refusal or a failed append (any non-zero bus helper exit: 1, 2 or 3) comes back to the model as an error starting
  "Not sent"; success returns the message id. The description tells the model never to send secrets.
