// TC-040 harness: message.ts -> bus.ps1 append -> bus.ps1 tail -> parseLine, in a scratch folder.
// Usage: node e2e-roundtrip.mjs <bus.ps1 path> <scratch bus.jsonl path>
// Node strips the TypeScript types of message.ts natively. Prints one JSON summary line; exit 0 = pass.
import { spawn, spawnSync } from 'node:child_process'
import { buildMessage, parseLine, serializeMessage } from '../hooks/message.ts'

const [busScript, busFile] = process.argv.slice(2)
if (!busScript || !busFile) {
  console.error('usage: node e2e-roundtrip.mjs <bus.ps1> <bus.jsonl>')
  process.exit(2)
}
const ps = (args) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', busScript, ...args]

const bodies = {
  plain: 'run the tests',
  multiLine: 'line one\nline two\r\nline three\r\n',
  nonAscii: 'caf\u00e9 \u{1F600} na\u00efve \u65e5\u672c\u8a9e',
  long: 'x'.repeat(5000),
  posLike: '#pos 00000000-0000000000000001:42',
  quotes: ["back","slash \"double\" 'single' C:","temp","\"x\"",""].join(String.fromCharCode(92)),
}

const deps = { now: () => Date.now(), random: Math.random }
const sent = Object.entries(bodies).map(([name, body]) =>
  ({ name, message: buildMessage({ from: 'alpha', fromSession: 'abcdef12-3456', to: 'beta', kind: 'info', body }, deps) }))

for (const { name, message } of sent) {
  const b64 = Buffer.from(serializeMessage(message), 'utf8').toString('base64')
  const r = spawnSync('powershell.exe', ps(['append', '-Path', busFile, '-LineBase64', b64]), { encoding: 'utf8' })
  if (r.status !== 0) { console.error(`append ${name} failed: ${r.status} ${r.stderr}`); process.exit(1) }
}

const tail = (from, wantBusLines) => new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', ps(['tail', '-Path', busFile, '-From', from]))
  let out = ''
  const finish = (err) => { clearTimeout(timer); child.kill(); err ? reject(err) : resolve(out.split('\n').filter((l) => l !== '')) }
  const timer = setTimeout(() => finish(new Error(`tail timed out; got: ${out}`)), 20000)
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d) => {
    out += d
    const lines = out.split('\n').filter((l) => l !== '')
    if (lines.filter((l) => !l.startsWith('#')).length >= wantBusLines && lines.some((l) => l.startsWith('#pos') && l.endsWith(`:${Buffer.byteLength(sentBytes)}`))) finish()
    else if (wantBusLines === 0 && lines.some((l) => l.startsWith('#pos'))) finish()
  })
  child.on('error', finish)
})

const sentBytes = sent.map(({ message }) => serializeMessage(message) + '\n').join('')

const head = await tail('end', 0)
const pos = /^#pos ([0-9a-f]+-[0-9a-f]+):(\d+)$/i.exec(head[0] ?? '')
if (!pos) { console.error(`no #pos from tail end: ${head}`); process.exit(1) }
const lines = await tail(`${pos[1]}:0`, sent.length)

const problems = []
const busLines = lines.filter((l) => !l.startsWith('#'))
const posLines = lines.filter((l) => l.startsWith('#'))
if (busLines.length !== sent.length) problems.push(`expected ${sent.length} bus lines, got ${busLines.length}`)
if (posLines.length === 0) problems.push('no #pos lines')
for (const l of posLines) if (parseLine(l).ok) problems.push(`#pos line parsed as a message: ${l}`)
sent.forEach(({ name, message }, i) => {
  const parsed = parseLine(busLines[i] ?? '')
  if (!parsed.ok) problems.push(`${name}: ${parsed.reason}`)
  else if (JSON.stringify(parsed.message) !== JSON.stringify(message)) problems.push(`${name}: message differs`)
  else if (parsed.message.body !== bodies[name]) problems.push(`${name}: body differs`)
})
console.log(JSON.stringify({ ok: problems.length === 0, sent: sent.length, received: busLines.length, posLines: posLines.length, problems }))
process.exit(problems.length === 0 ? 0 : 1)
