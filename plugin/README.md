# session-hub

A Claude Code mod, built in phases. So far (Phase 1) it holds the F-001 permission
spike, the bus helper (`append`, `tail`) and the message model
(`hooks/message.ts`: build, serialise, parse). F-001 proves that the mod's own file and process calls
work against the shared folder `%USERPROFILE%\.claude-session-hub` with **no
permission prompt**.

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
