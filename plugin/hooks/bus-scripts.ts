// Kept free of imports so tests can load the scripts straight from this file.

// `powershell -Command` does not fill $args from trailing arguments, so the
// path travels in the environment.
const PS_PATH = '$env:SESSION_HUB_PATH'

// `tail -From end` prints no position until the file exists, so the bus file
// must exist before the listener starts. OpenOrCreate never truncates.
export const ENSURE_BUS_SCRIPT =
  `$p = ${PS_PATH}; [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p)); ` +
  `$f = [IO.File]::Open($p, 'OpenOrCreate', 'Write', 'ReadWrite,Delete'); $f.Dispose()`

export const REMOVE_FILE_SCRIPT = `Remove-Item -LiteralPath ${PS_PATH} -Force -ErrorAction SilentlyContinue; exit 0`
