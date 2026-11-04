import { ENSURE_BUS_SCRIPT, REMOVE_FILE_SCRIPT } from './bus-scripts'
import { serializeMessage } from './message'
import type { BusMessage } from './message'

export type RunFn = (
  argv: readonly string[],
  init?: { timeoutMs?: number; env?: Record<string, string> },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export const toBase64 = (text: string): string => {
  let binary = ''

  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

export const helperPath = (pluginRoot: string): string =>
  `${pluginRoot.replace(/[\\/]+$/, '')}/bin/bus.ps1`

export const appendArgv = (
  helper: string,
  busPath: string,
  line: string,
): string[] => [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  helper,
  'append',
  '-Path',
  busPath,
  '-LineBase64',
  toBase64(line),
]

// Throws on a non-zero exit (1 I/O, 2 bad input, 3 mutex timeout).
export const appendMessage = async (
  run: RunFn,
  helper: string,
  busPath: string,
  message: BusMessage,
): Promise<void> => {
  const out = await run(
    appendArgv(helper, busPath, serializeMessage(message)),
    { timeoutMs: 15000 },
  )

  if (out.exitCode !== 0) {
    throw new Error(
      `bus append failed (exit ${out.exitCode}): ${out.stderr.trim() || out.stdout.trim()}`,
    )
  }
}

const runWithPath = async (
  run: RunFn,
  script: string,
  path: string,
): Promise<void> => {
  const out = await run(
    ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
    { timeoutMs: 15000, env: { SESSION_HUB_PATH: path } },
  )

  if (out.exitCode !== 0) {
    throw new Error(
      `exit ${out.exitCode}: ${out.stderr.trim() || out.stdout.trim()}`,
    )
  }
}

export const ensureBusFile = (run: RunFn, busPath: string): Promise<void> =>
  runWithPath(run, ENSURE_BUS_SCRIPT, busPath)

export const removeFile = (run: RunFn, path: string): Promise<void> =>
  runWithPath(run, REMOVE_FILE_SCRIPT, path)
