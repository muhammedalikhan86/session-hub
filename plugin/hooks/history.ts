import { lastArgv } from './bus-client'
import type { RunFn } from './bus-client'
import { parseLine } from './message'
import type { BusMessage } from './message'

export const HISTORY_DEFAULT = 50
export const HISTORY_MAX = 500
const BODY_MAX = 100

export const HISTORY_USAGE = `Usage: /hub-history [count] (1 to ${HISTORY_MAX}, default ${HISTORY_DEFAULT})`

export type HistoryCount = { ok: true; count: number; note?: string } | { ok: false; text: string }

export const parseHistoryCount = (args: string): HistoryCount => {
  const text = args.trim()

  if (text === '') return { ok: true, count: HISTORY_DEFAULT }
  if (!/^\d+$/.test(text)) return { ok: false, text: HISTORY_USAGE }

  const asked = Number(text)

  if (asked < 1) return { ok: false, text: HISTORY_USAGE }
  if (asked > HISTORY_MAX) {
    return { ok: true, count: HISTORY_MAX, note: `Showing ${HISTORY_MAX}, the most /hub-history shows.` }
  }

  return { ok: true, count: asked }
}

const pad = (n: number): string => String(n).padStart(2, '0')

export const clockOf = (ts: string): string => {
  const date = new Date(ts)

  if (Number.isNaN(date.getTime())) return '??:??:??'

  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export const firstLine = (body: string): string => {
  const line = (body.trim().split(/\r?\n/)[0] ?? '').trim()

  return line.length > BODY_MAX ? `${line.slice(0, BODY_MAX)}…` : line
}

const row = (m: BusMessage): string =>
  `${clockOf(m.ts)} ${m.from} → ${m.to} ${m.kind}: ${firstLine(m.body)}`

// `raw` is the helper's output: the last lines of the log, oldest first. Blank
// lines are ignored; a line that is not a valid message is counted, not shown.
export const formatHistory = (raw: string, count: number, logPath: string): string => {
  const messages: BusMessage[] = []
  let unreadable = 0

  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue

    const parsed = parseLine(line)

    if (parsed.ok) messages.push(parsed.message)
    else unreadable += 1
  }

  const shown = messages.slice(-count)
  const footer =
    unreadable > 0
      ? [`${unreadable} ${unreadable === 1 ? 'line' : 'lines'} could not be read`]
      : []

  if (shown.length === 0) return ['No messages yet.', `Full log: ${logPath}`, ...footer].join('\n')

  return [
    `Last ${shown.length} ${shown.length === 1 ? 'message' : 'messages'} (full log: ${logPath})`,
    ...shown.map(row),
    ...footer,
  ].join('\n')
}

export type HistoryDeps = {
  run: RunFn
  helper: string
  busPath: string
}

// A read of the shared log: works whether or not this session has joined.
export const handleHistory = async (args: string, deps: HistoryDeps): Promise<string> => {
  const parsed = parseHistoryCount(args)

  if (!parsed.ok) return parsed.text

  const out = await deps.run(lastArgv(deps.helper, deps.busPath, parsed.count), { timeoutMs: 15000 })

  if (out.exitCode !== 0) {
    return `Could not read the log (exit ${out.exitCode}): ${out.stderr.trim() || out.stdout.trim()}`
  }

  const text = formatHistory(out.stdout, parsed.count, deps.busPath)

  return parsed.note ? `${parsed.note}\n${text}` : text
}
