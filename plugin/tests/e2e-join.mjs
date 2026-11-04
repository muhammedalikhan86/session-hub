// TC-F005 harness (acceptance criterion 4): the join order against the real bus.ps1, in a scratch folder.
// Worker: tail from end, wait for its first #pos, then append the join line (the order /hub-join uses).
// Hub: a tail started from end beforehand; the instant it reads the join line it appends an order to the worker.
// Passes when the worker's tail prints that order. Usage: node e2e-join.mjs <bus.ps1 path> <scratch bus.jsonl path>
// Node strips the TypeScript types of message.ts natively. Prints one JSON summary line; exit 0 = pass.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildMessage, parseLine, serializeMessage } from '../hooks/message.ts'

const [busScript, busFile] = process.argv.slice(2)
if (!busScript || !busFile) {
  console.error('usage: node e2e-join.mjs <bus.ps1> <bus.jsonl>')
  process.exit(2)
}
const ps = (args) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', busScript, ...args]
const deps = { now: () => Date.now(), random: Math.random }

const append = (message) => {
  const b64 = Buffer.from(serializeMessage(message), 'utf8').toString('base64')
  const r = spawnSync('powershell.exe', ps(['append', '-Path', busFile, '-LineBase64', b64]), { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`append failed: ${r.status} ${r.stderr}`)
}

const children = []
const startTail = (onBusLine) => {
  const child = spawn('powershell.exe', ps(['tail', '-Path', busFile, '-From', 'end']))
  children.push(child)
  const tail = { busLines: [], gotPos: null }
  tail.firstPos = new Promise((resolve) => { tail.gotPos = resolve })
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => {
    buffer += d
    let cut
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut).replace(/\r$/, '')
      buffer = buffer.slice(cut + 1)
      if (line.startsWith('#pos ')) tail.gotPos(line)
      else if (line.startsWith('{')) { tail.busLines.push(line); onBusLine?.(line) }
    }
  })
  return tail
}

const until = (what, test, ms = 20000) => new Promise((resolve, reject) => {
  const t0 = Date.now()
  const timer = setInterval(() => {
    if (test()) { clearInterval(timer); resolve() }
    else if (Date.now() - t0 > ms) { clearInterval(timer); reject(new Error(`timed out waiting for ${what}`)) }
  }, 25)
})

const problems = []
try {
  // Like join.ts (ensureBusFile): tail prints no #pos until the file exists, so create it empty first.
  mkdirSync(dirname(busFile), { recursive: true })
  closeSync(openSync(busFile, 'a'))
  // The Hub is already listening before the worker joins.
  const hub = startTail((line) => {
    const parsed = parseLine(line)
    if (parsed.ok && parsed.message.kind === 'join') {
      append(buildMessage({ from: 'Hub', fromSession: 'hub-session-1', to: parsed.message.from, kind: 'order', body: 'welcome, start now' }, deps))
    }
  })
  await hub.firstPos

  // Join order: (2) listener at end and running, then (4) the join line (presence, step 3, is not a bus matter).
  const worker = startTail()
  await worker.firstPos
  append(buildMessage({ from: 'worker1', fromSession: 'worker-session-1', to: '*', kind: 'join', body: 'joined' }, deps))

  await until('the worker to receive the Hub order', () =>
    worker.busLines.some((l) => { const p = parseLine(l); return p.ok && p.message.kind === 'order' && p.message.to === 'worker1' }))

  const kinds = worker.busLines.map((l) => { const p = parseLine(l); return p.ok ? p.message.kind : 'bad' })
  if (kinds.join(',') !== 'join,order') problems.push(`worker saw ${kinds.join(',')}, expected join,order`)
} catch (error) {
  problems.push(String(error.message ?? error))
} finally {
  for (const c of children) c.kill()
}
console.log(JSON.stringify({ ok: problems.length === 0, problems }))
process.exit(problems.length === 0 ? 0 : 1)
