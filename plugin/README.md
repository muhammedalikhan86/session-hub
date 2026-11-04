# session-hub

A Claude Code mod, built in phases. So far (Phases 1 and 2) it holds the F-001 permission
spike, the bus helper (`append`, `tail`), the message model (`hooks/message.ts`: build, serialise,
parse), `/hub-join` and `/hub-leave`, the presence heartbeat and the Hub-away state. F-001 proves
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

Not yet built: delivering received lines (F-009; bus lines currently reach `handleBusLine` in
`hooks/register.ts` and are only parsed). The latest `#pos` is kept in `$.state`
(`session-hub.listenerPos`, contract in `types/index.d.ts`).

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
  restarts the heartbeat and status line if the presence file is still this session's and fresh.
  Restarting the listener from the stored position is F-009 and not done.

## Hub away (F-007)

- A worker (never the Hub) runs `hooks/hub-watch.ts`: it checks `presence\Hub.json` once at start and
  then every 10 s. The Hub is away when the file is missing, unreadable or malformed, or its
  `lastSeen` is 30 s or older (same `parsePresence` / `isLive` rule as the name check).
- While away the status line reads `Session Hub: <name> (worker) — Hub away — waiting`; when the Hub is
  back it returns to `Session Hub: <name> (worker)`. The status is written only when the state changes.
- Away is only a flag (`JoinState.hubAway`, for F-010/F-011 to read). The heartbeat, the listener and
  the join keep running and nothing is cleared, so queued work is kept (FR-012).
- The watcher starts with the heartbeat (after a worker join, and on restore after a mod reload) and
  stops wherever the heartbeat stops (`/hub-leave`, `session.end`, a join released because its session
  ended, a lost name). Stopping waits for a check in flight, so no status is written after a leave.

Code: `hooks/presence.ts` (free/stale/claim/race), `hooks/join.ts` (the sequence),
`hooks/listener.ts` (spawn and line splitting), `hooks/bus-client.ts` (append, ensure file).
Test: `tests/hub-join.Tests.ps1` runs `tests/e2e-join.mjs` against the real `bus.ps1`.
