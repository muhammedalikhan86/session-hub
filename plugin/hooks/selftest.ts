import { resolveSharedFolder } from './paths'
import type { EnvReader } from './paths'

export type StepRow = {
  name: string
  isOk: boolean
  ms: number
  detail: string
}
export type Step = { name: string; run: () => Promise<string | void> }

type SpawnPiece = { stream: string; text: string }
type SpawnEnd = { code: number | null; signal: string | null }

export type SelfTestApi = EnvReader & {
  clock: { now: () => Promise<number> }
  session: { id: () => Promise<string> }
  fs: {
    read: (path: string) => Promise<string | { base64: string }>
    write: (path: string, text: string) => Promise<void>
    list: (path?: string) => Promise<{ name: string; kind: string }[]>
  }
  process: {
    run: (
      argv: readonly string[],
      init?: { timeoutMs?: number },
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
    spawn: (request: {
      argv: readonly string[]
    }) => AsyncIterable<SpawnPiece, SpawnEnd | void>
  }
}

export type SelfTestResult = {
  rows: StepRow[]
  files: string[]
  text: string
  summary: string
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Runs every step in order; a throwing step becomes a FAIL row and the rest still run.
export const runSteps = async (
  steps: readonly Step[],
  now: () => Promise<number>,
): Promise<StepRow[]> => {
  const rows: StepRow[] = []

  for (const step of steps) {
    const start = await now()
    let isOk = true
    let detail = ''

    try {
      detail = (await step.run()) ?? ''
    } catch (error) {
      isOk = false
      detail = message(error)
    }

    rows.push({ name: step.name, isOk, ms: (await now()) - start, detail })
  }

  return rows
}

export const formatRows = (rows: readonly StepRow[]): string =>
  rows
    .map(
      r =>
        `${r.isOk ? 'OK  ' : 'FAIL'} ${r.name} (${r.ms} ms)${r.detail ? ` - ${r.detail}` : ''}`,
    )
    .join('\n')

export const summarize = (rows: readonly StepRow[]): string => {
  const failed = rows.filter(r => !r.isOk)

  return failed.length === 0
    ? `Session Hub self-test: all ${rows.length} steps OK`
    : `Session Hub self-test: ${failed.length} of ${rows.length} FAILED (${failed.map(r => r.name).join(', ')})`
}

const POWERSHELL = [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
] as const

export function buildSteps(
  $: SelfTestApi,
  found: { files: string[] },
): Step[] {
  let folder: string | undefined
  let file: string | undefined
  let written = ''

  const need = (value: string | undefined, what: string): string => {
    if (value === undefined) throw new Error(`skipped: ${what} is not available`)

    return value
  }

  return [
    {
      name: '(a) create shared folder and selftest\\',
      run: async () => {
        folder = await resolveSharedFolder($)
        await $.fs.write(`${folder}\\selftest\\.keep`, 'selftest folder\n')

        return `${folder}\\selftest`
      },
    },
    {
      name: '(b) write selftest\\<sessionId>.json',
      run: async () => {
        const dir = need(folder, 'the shared folder')
        const sessionId = await $.session.id()
        const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
        const body = {
          sessionId,
          time: new Date(await $.clock.now()).toISOString(),
          ...(configDir ? { configDir } : {}),
        }
        file = `${dir}\\selftest\\${sessionId}.json`
        written = JSON.stringify(body, null, 2)
        await $.fs.write(file, written)

        return file
      },
    },
    {
      name: '(c) read it back and compare',
      run: async () => {
        const back = await $.fs.read(need(file, 'the written file'))

        if (back !== written) {
          throw new Error('content read back differs from what was written')
        }

        return `${written.length} chars match`
      },
    },
    {
      name: '(d) list selftest\\',
      run: async () => {
        const entries = await $.fs.list(
          `${need(folder, 'the shared folder')}\\selftest`,
        )
        found.files = entries
          .filter(x => x.name.endsWith('.json'))
          .map(x => x.name)

        return `${found.files.length} file(s)`
      },
    },
    {
      name: '(e) process.run powershell',
      run: async () => {
        const out = await $.process.run(
          [...POWERSHELL, 'Write-Output session-hub-ok'],
          { timeoutMs: 20000 },
        )

        if (out.exitCode !== 0 || !out.stdout.includes('session-hub-ok')) {
          throw new Error(
            `exit ${out.exitCode}: ${out.stderr.trim() || out.stdout.trim()}`,
          )
        }

        return 'printed session-hub-ok'
      },
    },
    {
      name: '(f) process.spawn powershell, 3 lines streamed',
      run: async () => {
        const script =
          '1..3 | ForEach-Object { Write-Output "line $_"; Start-Sleep -Milliseconds 300 }'
        const it = $.process
          .spawn({ argv: [...POWERSHELL, script] })
          [Symbol.asyncIterator]()
        let text = ''
        let end: SpawnEnd | void = undefined

        for (;;) {
          const piece = await it.next()

          if (piece.done) {
            end = piece.value
            break
          }

          if (piece.value.stream === 'stdout') text += piece.value.text
        }

        const lines = text
          .split(/\r?\n/)
          .filter(l => l.startsWith('line ')).length

        if (lines !== 3) throw new Error(`expected 3 lines, got ${lines}`)
        if (end && end.code !== 0) throw new Error(`exit code ${end.code}`)

        return '3 lines, exited'
      },
    },
  ]
}

export async function runSelfTest($: SelfTestApi): Promise<SelfTestResult> {
  const found = { files: [] as string[] }
  const rows = await runSteps(buildSteps($, found), () => $.clock.now())
  const listing = found.files.length > 0 ? found.files.join('\n') : '(none)'
  const text = `${formatRows(rows)}\n\nSelftest files found:\n${listing}`

  return { rows, files: found.files, text, summary: summarize(rows) }
}
