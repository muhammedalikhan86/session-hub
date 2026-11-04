import { expect, test } from 'claude-code/testing'

import { startListener } from './listener'

// A hand-rolled stream whose return() ends the "process" at once, as a stream
// that does not queue it behind a pending next() would.
const quietStream = () => {
  const state = { ended: false }
  const iterator: AsyncIterator<{ stream: string; text: string }, unknown> = {
    next: () => new Promise(() => {}),
    return: async () => {
      state.ended = true

      return { done: true, value: undefined }
    },
  }

  return { state, spawn: () => ({ [Symbol.asyncIterator]: () => iterator }) }
}

test('stop() on a quiet bus ends the process without waiting for more output', async () => {
  const { state, spawn } = quietStream()
  const listener = startListener(spawn, ['x'], {
    onLine: () => {},
    onPos: () => {},
  })

  listener.stop()

  expect(state.ended).toBe(true)
  await expect(listener.ready).rejects.toThrow('stopped')
})

test('after stop(), output that still arrives reaches neither handler', async () => {
  let push: (text: string) => void = () => {}
  const seen: string[] = []
  const iterator: AsyncIterator<{ stream: string; text: string }, unknown> = {
    next: () =>
      new Promise(resolve => {
        push = text => resolve({ done: false, value: { stream: 'stdout', text } })
      }),
    return: async () => ({ done: true, value: undefined }),
  }
  const listener = startListener(
    () => ({ [Symbol.asyncIterator]: () => iterator }),
    ['x'],
    { onLine: l => seen.push(l), onPos: p => seen.push(`pos ${p.offset}`) },
  )

  listener.stop()
  push('#pos 0-1:5\n{"a":1}\n')
  for (let i = 0; i < 20; i++) await Promise.resolve()

  expect(seen).toEqual([])
})
