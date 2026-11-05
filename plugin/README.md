# session-hub

A Claude Code mod, built in phases. So far (Phases 1 to 5) it holds the F-001 permission
spike, the bus helper (`append`, `tail`, `last`, `clear`), the message model (`hooks/message.ts`: build,
serialise, parse), `/hub-join` and `/hub-leave`, the presence heartbeat and the Hub-away state, the `send` tool
(F-008), the listener filter (F-009), delivery as prompts and notices (F-010), the Hub authority
check (F-011), the Hub's Sessions pane and `list_sessions` (F-012), `/hub-history` (F-013), `/hub-clear`
(F-014), the concurrency proof (F-017) the model guidance for a joined session (B-001) and the `sharedFolder` option (F-015). The install
steps for every account are in `Install (F-015)` below. The three-account end-to-end proof (F-016) is a manual checklist (`docs/test-runbook.md` section 9) that has not been run yet. F-001 proves
that the mod's own file and process calls work against the shared folder
(default `%USERPROFILE%\.claude-session-hub`) with **no permission prompt**.

None of the live behaviour (the pane, the commands, the model's use of `send`) has been checked in a running
session yet: see `docs/test-runbook.md` sections 6 and 7.

The folder is resolved in `hooks/paths.ts`: the `sharedFolder` mod option if set, else `$.env.get('USERPROFILE')`
(a mod has no `process.env`) plus `.claude-session-hub`. Every file the mod and its helper touch is under it.

## Install (F-015)

For a person with several accounts, each signed in under its own `CLAUDE_CONFIG_DIR`. What you install is
this folder, `plugin/` of this repo (the one holding `.claude-plugin/plugin.json`), once per account.

1. Note the full path of the mod folder, for example
   `C:\Users\you\source\repos\session-hub\plugin`.
2. Start Claude Code for the first account with its config folder set and the mod loaded (PowerShell):
   ```powershell
   $env:CLAUDE_CONFIG_DIR = 'C:\path\to\account-a'
   claude --plugin-dir C:\Users\you\source\repos\session-hub\plugin
   ```
   Repeat in another terminal for each account with that account's own `CLAUDE_CONFIG_DIR`. `--plugin-dir`
   loads the mod for that session only. To load it without the flag (for a launcher you cannot add flags to),
   set `CLAUDE_CODE_PLUGIN_DIRS` to the same folder in that launch's environment instead:
   `$env:CLAUDE_CODE_PLUGIN_DIRS = '<mod folder>'`.
3. Decide the shared folder. Leave the `sharedFolder` option empty to use the default,
   `%USERPROFILE%\.claude-session-hub`. To use another folder, set `sharedFolder` to an absolute Windows path
   (`D:\Hub` or a `\\server\share\Hub` share); a trailing slash is dropped. Set it in each account:
   open `/config` and edit the **Shared folder** row for `session-hub`, or add this to that account's
   `settings.json` (the key is `session-hub` if the mod is installed rather than loaded with `--plugin-dir`):
   ```json
   { "pluginConfigs": { "session-hub@inline": { "options": { "sharedFolder": "D:\\Hub" } } } }
   ```
   Backslashes are doubled in JSON. A blank value silently uses the default. A value that is not an absolute
   path, or is unusable (relative, `C:`, `C:\`), is ignored: the default is used and a one-line warning appears
   when the session starts.
4. **Every account must use the same shared folder value.** The folder is how sessions find each other; if two
   accounts differ they each get their own folder and never see one another. Leave all of them empty, or set
   them all to the same path.
5. Check it. In two accounts run `/hub-join <name>` (one as `Hub`, one under another name), then
   `/hub-history` in either: both should show the same log path. The Hub's Sessions pane lists both. The full
   checks are in `docs/test-runbook.md` section 7.

Uninstall: stop launching with `--plugin-dir` (or clear `CLAUDE_CODE_PLUGIN_DIRS`) and remove any
`pluginConfigs` entry for `session-hub` from that account's `settings.json`. Run `/hub-leave` first in any
joined session. The shared folder holds only the bus, presence files, archives and self-test files, so once no
session is joined you can delete it.

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
one table (verbs: `append`, `tail`, `last`, `clear`).

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
  (0 if the file does not exist yet; it waits for the file). A changed file id
  follows a clear (see F-014 below); a size below the offset with the same id
  warns on stderr and restarts at 0. Bad `-From` exits 2.
- `clear` (F-014): `bin\bus.ps1 clear -Path <bus file>`, see F-014 below.
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

## Model guidance (B-001)

The model used Claude Code's built-in session messaging instead of the `send` tool, because the tool sat
behind ToolSearch and nothing said the session was in Session Hub. Two parts:

- `tool.describe` for `mcp__session-hub__send` answers `isDeferred: false` (and the tool is registered with
  `isDeferred: false`), so its schema is in the prompt's tool list.
- `prompt.compose` appends one `session`-scope section, `session-hub:joined`, only while joined
  (`hooks/hub-prompt.ts`): the session's name and role, to use `mcp__session-hub__send` (Hub: `to` a name or
  `*`; worker: Hub only, `replyTo` the order id), that `[Hub order ...]`, `[Reply from ...]` and
  `[Message from ...]` prompts come from Session Hub, and never to send secrets. `prompt.compose` is not
  cached and not invalidatable, so join, leave, a lost name and a restore show on the next turn; a failure
  in the hook falls back to the engine's prompt.

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

## Presence pane and list_sessions (F-012)

- The Hub's roster is `hooks/roster.ts` (pure): live `presence\*.json` files (`parsePresence`, `isLive`) are the
  source of truth for name, role, account and last seen; a `join` or `leave` line the Hub's inbox delivers adds or
  removes a row at once (a joined row has account `unknown` until the next refresh). A session whose file is
  missing, malformed or over 30 s old is dropped, the Hub included (it is listed from its own live file with its
  real last seen, never stamped "now"). A session whose `leave` line the Hub applied stays out of refreshes
  (pane and `list_sessions` share that set) until its file is gone or a `join` line for it arrives. Order is Hub
  first, then by name.
- Started with the Hub's heartbeat (join or restore) and stopped with it (leave, `session.end`, lost name), the
  roster re-reads `presence\` every 10 s (`$.clock.every`) and opens the pane `session-hub-roster` ("Sessions");
  stopping closes it. Join/leave toasts are unchanged; `onMessage` in `register.ts` also updates the roster.
- The pane (`hooks/roster-pane.tsx`, imported by `register.ts`, so `hooks.json` is unchanged) draws the
  `session-hub.roster` atom (`Shaped<RosterRow[]>`, shape `roster-1`): name, role, account, last seen ("4 s ago").
- `list_sessions` (`hooks/list-sessions.ts`) takes no input, re-reads `presence\` and returns the same rows as JSON.
  A worker gets `Not available: only the Hub can list sessions`; an unjoined session is refused. The Hub's prompt names it.

## /hub-history (F-013)

- `/hub-history [count]` shows the last messages on the bus, oldest first, one row each:
  `HH:MM:SS from → to kind: first line of body` (local time; `??:??:??` for a bad `ts`; the first line is
  cut at 100 characters with `…`). Default 50; a count above 500 is capped at 500 and the reply says so;
  `0` or a non-number gets a usage line. The header names the full log, which stays the plain file
  `bus.jsonl` in the shared folder (default `%USERPROFILE%\.claude-session-hub`). Lines that are not valid messages are skipped and counted in a
  footer ("2 lines could not be read"). An empty or missing log gives "No messages yet." and the path.
- It is a read of the shared log, so it works whether or not the session has joined.
- Reading: the mod API cannot read a file over 4 MiB and has no ranged read, so `bus.jsonl` is read through a
  read-only helper verb, `bin\bus.ps1 last -Path <bus file> -Count <n>`. It takes no mutex (readers never
  lock, ADR-006), reads backwards from the end in 64 KiB chunks (cost is the last lines, not the file size),
  prints complete lines only (an unfinished last line and a line cut by the chunk edge are dropped), exits 0
  with nothing for a missing file, and exits 2 for a bad `-Count`.
- Code: `hooks/history.ts` (pure formatter and command handler, `hooks/history.test.ts`); verb tests in
  `tests/bus.last.Tests.ps1`.


## /hub-clear (F-014)

- `/hub-clear` (Hub only) archives the log and starts an empty one. A worker gets "Only the Hub can clear the
  log."; a session that has not joined gets "Join as Hub first.". The reply is "Cleared. Archived to <path>."
  (or "Cleared. There was no log to archive." when the file was missing), or the helper's error
  ("Could not clear the log: ...", nothing changed).
- The new log starts empty: nothing is appended after a clear, and workers are not notified.
- `bin\bus.ps1 clear -Path <bus file>`: takes the bus mutex (waits up to 2 s, exit 3 and nothing changed on
  timeout, as `append`), creates `archive\` beside the bus file, moves `bus.jsonl` to
  `archive\bus-<UTC yyyyMMddTHHmmssfffZ>.jsonl` (a taken name moves on by a millisecond, so names sort by time),
  creates a new empty `bus.jsonl`, releases, and prints the archive path. A missing bus file is just created
  (nothing printed, exit 0). Exit 1 is an I/O error, 2 a missing `-Path`. Readers open with `ReadWrite|Delete`
  and `tail` opens per pass only, so the move works while a reader is running.
- `tail` follows a clear. When the file id at `-Path` differs from the one being read, it looks in
  `archive\bus-*.jsonl` for the file whose NTFS file id equals the old id (a move on the same volume keeps the
  id; newest name first), reads it from the stored offset to its end and prints those lines, then any archive
  made after it from 0 (several clears between two passes), then switches to the live file at 0 and prints
  `#pos <newid>:0`. Only complete lines are printed: an unfinished last line in an archive can never be
  completed, so it is skipped with a warning on stderr. With no archive carrying the old id it warns and
  restarts at 0 as before. A start with `-From <oldid>:<off>` whose id has since been archived does the same
  drain first. A size below the offset with the same id still warns and restarts at 0.
- No replay: the listener stores the `#pos` that `tail` prints (now on the new file id) after the drained
  lines were handled, and the inbox's seen-ids dedupe covers any line seen twice.
- Code: `hooks/clear.ts` (`handleClear`, `hooks/clear.test.ts`), `clearArgv` and `clearBus` in
  `hooks/bus-client.ts`; verb and follow tests in `tests/bus.clear.Tests.ps1`.


## Concurrency proof (F-017)

- Run the full proof (10 iterations, NFR-003): `powershell.exe -NoProfile -ExecutionPolicy Bypass -File plugin/tests/stress/concurrency.ps1` (also runs under `pwsh`; parameters `-Iterations 10 -Writers 5 -Lines 200 -Listeners 3`). It takes the bus mutex, so do not run it next to a real hub.
- Each iteration, in a fresh temp bus dir: 3 real `bus.ps1 tail` processes, 5 separate powershell.exe writer processes (200 `bus.ps1 append` calls each, released together by a go-file), and one `bus.ps1 clear` fired mid-run. Every line carries writer id, sequence, variable padding and multi-byte UTF-8 characters.
- Checks: archive + live file hold all 1000 lines once, each complete; every listener printed exactly 1000 data lines, each valid JSON and uncorrupted, no duplicate or missing (writer, seq), each writer in increasing order, and the whole sequence equal to file order (archive lines, then live-file lines). One PASS/FAIL line per iteration; exit 1 on any failure.
- `tests/concurrency.Tests.ps1` runs one iteration (about 12 s) so the normal Pester suite stays fast.
