import type { ListenerPos } from '../types'

type Chunk = { stream: string; text: string }

export type SpawnFn = (request: {
  argv: readonly string[]
}) => AsyncIterable<Chunk, unknown>

export type Listener = {
  // Resolves with the starting position once the first #pos line has arrived.
  ready: Promise<ListenerPos>
  stop: () => void
}

const POS = /^#pos ([0-9a-fA-F]+-[0-9a-fA-F]+):(\d+)$/

export const parsePos = (line: string): ListenerPos | undefined => {
  const m = POS.exec(line.replace(/\r+$/, ''))

  return m ? { fileId: m[1] as string, offset: Number(m[2]) } : undefined
}

export const tailArgv = (
  helper: string,
  busPath: string,
  from: string,
): string[] => [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  helper,
  'tail',
  '-Path',
  busPath,
  '-From',
  from,
]

// Starts `bus.ps1 tail` and feeds it line by line: bus lines (start with `{`) to
// onLine, `#pos` lines to onPos; anything else is ignored. F-009 builds on this.
export const startListener = (
  spawn: SpawnFn,
  argv: readonly string[],
  handlers: {
    onLine: (line: string) => void
    onPos: (pos: ListenerPos) => void
  },
): Listener => {
  const stream = spawn({ argv })[Symbol.asyncIterator]()
  let isStopped = false
  let isFirst = true
  let buffer = ''
  let resolveReady: (pos: ListenerPos) => void = () => {}
  let rejectReady: (error: Error) => void = () => {}
  const ready = new Promise<ListenerPos>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  const handle = (raw: string) => {
    if (isStopped) return

    const line = raw.replace(/\r+$/, '')
    const pos = parsePos(line)

    if (pos) {
      handlers.onPos(pos)

      if (isFirst) {
        isFirst = false
        resolveReady(pos)
      }
    } else if (line.startsWith('{')) {
      handlers.onLine(line)
    }
  }

  void (async () => {
    try {
      for (;;) {
        const piece = await stream.next()

        if (piece.done || isStopped) break

        if (piece.value.stream !== 'stdout') continue

        buffer += piece.value.text

        let cut = buffer.indexOf('\n')

        while (cut >= 0) {
          handle(buffer.slice(0, cut))
          buffer = buffer.slice(cut + 1)
          cut = buffer.indexOf('\n')
        }
      }

      rejectReady(new Error('the listener ended before reporting a position'))
    } catch (error) {
      rejectReady(error instanceof Error ? error : new Error(String(error)))
    }
  })()

  // The spawn API has no kill handle or signal (only leaving the loop, or the
  // hook's `next.signal`, which belongs to a dispatch that ends with the
  // command): `return()` is the one lever. Called here, not from the loop, it
  // does not wait for our own pending `next()`; whether the stream ends the
  // child at once or queues the return behind that pull is the stream's own
  // behaviour. A native async generator queues it, so the child would then end
  // at its next output.
  const stop = () => {
    if (isStopped) return

    isStopped = true
    rejectReady(new Error('the listener was stopped'))
    void Promise.resolve(stream.return?.(undefined)).catch(() => {})
  }

  ready.catch(() => {})

  return { ready, stop }
}
