import { expect, test } from 'claude-code/testing'

import { createInbox, HOLD_LIMIT, SEEN_LIMIT } from './inbox'
import type { InboxDeps } from './inbox'
import { buildMessage, serializeMessage } from './message'
import type { MessageInput } from './message'

let seq = 0

const line = (over: Partial<MessageInput> & { id?: string } = {}): string => {
  const message = buildMessage(
    {
      from: 'bravo',
      fromSession: 'sB',
      to: 'alpha',
      kind: 'info',
      body: 'hello',
      ...over,
    },
    { now: () => 1_000 + seq++, random: () => 0.1 },
  )

  return serializeMessage(over.id ? { ...message, id: over.id } : message)
}

const rig = (over: Partial<InboxDeps> = {}, seed: string[] = []) => {
  const events: string[] = []
  const stored: string[][] = []
  const delivered: string[] = []
  const logs: string[] = []
  const inbox = createInbox(
    {
      me: () => ({ name: 'alpha', sessionId: 'sA' }),
      joining: () => false,
      storePos: async pos => {
        events.push(`pos ${pos.offset}`)
      },
      persist: async ids => {
        events.push('persist')
        stored.push(ids)
      },
      onMessage: m => {
        events.push('deliver')
        delivered.push(m.id)
      },
      log: text => logs.push(text),
      ...over,
    },
    seed,
  )

  return { inbox, events, stored, delivered, logs }
}

test('an unparseable line is logged and skipped; the next good line is delivered', async () => {
  const r = rig()

  await r.inbox.handle('{not json')
  await r.inbox.handle(line({ id: 'good' }))

  expect(r.logs).toHaveLength(1)
  expect(r.delivered).toEqual(['good'])
})

test('own lines are dropped, by name and by fromSession', async () => {
  const r = rig()

  await r.inbox.handle(line({ id: 'byName', from: 'alpha', fromSession: 'x' }))
  await r.inbox.handle(line({ id: 'bySession', from: 'bravo', fromSession: 'sA' }))

  expect(r.delivered).toEqual([])
})

test('a line to another name is dropped; to me and to * are delivered', async () => {
  const r = rig()

  await r.inbox.handle(line({ id: 'other', to: 'charlie' }))
  await r.inbox.handle(line({ id: 'mine', to: 'alpha' }))
  await r.inbox.handle(line({ id: 'all', to: '*' }))

  expect(r.delivered).toEqual(['mine', 'all'])
})

test('a duplicate id is delivered once', async () => {
  const r = rig()

  await r.inbox.handle(line({ id: 'dup' }))
  await r.inbox.handle(line({ id: 'dup' }))

  expect(r.delivered).toEqual(['dup'])
})

test('the seen ids are persisted before onMessage runs', async () => {
  const r = rig()

  await r.inbox.handle(line({ id: 'a' }))

  expect(r.events).toEqual(['persist', 'deliver'])
  expect(r.stored[0]).toEqual(['a'])
})

test('the seen set is bounded: the oldest id is evicted after N+1', async () => {
  const r = rig()

  for (let i = 0; i <= SEEN_LIMIT; i++) await r.inbox.handle(line({ id: `id${i}` }))

  const last = r.stored[r.stored.length - 1] ?? []

  expect(last).toHaveLength(SEEN_LIMIT)
  expect(last).not.toContain('id0')
  expect(last).toContain(`id${SEEN_LIMIT}`)

  await r.inbox.handle(line({ id: 'id0' }))

  expect(r.delivered[r.delivered.length - 1]).toBe('id0')
})

test('replay after a reload: restored seen ids stop a repeated batch', async () => {
  const first = rig()
  const batch = [line({ id: 'm1' }), line({ id: 'm2' }), line({ id: 'm3' })]

  for (const l of batch) await first.inbox.handle(l)

  const again = rig({}, first.stored[first.stored.length - 1])

  for (const l of batch) await again.inbox.handle(l)

  expect(again.delivered).toEqual([])
})

test('the name is read at line time, and nothing is delivered when not joined', async () => {
  let me: { name: string; sessionId: string } | undefined = {
    name: 'alpha',
    sessionId: 'sA',
  }
  const r = rig({ me: () => me })

  me = { name: 'delta', sessionId: 'sD' }
  await r.inbox.handle(line({ id: 'toAlpha', to: 'alpha' }))
  await r.inbox.handle(line({ id: 'toDelta', to: 'delta' }))
  me = undefined
  await r.inbox.handle(line({ id: 'unjoined', to: '*' }))

  expect(r.delivered).toEqual(['toDelta'])
})

test('a failing persist or onMessage never throws and later lines still flow', async () => {
  let fail = true
  const r = rig({
    persist: async () => {
      if (fail) throw new Error('disk')
    },
  })

  await r.inbox.handle(line({ id: 'a' }))
  fail = false
  await r.inbox.handle(line({ id: 'b' }))

  expect(r.delivered).toEqual(['a', 'b'])
})

test('a slow onMessage for line 1 still finishes before line 2 is delivered', async () => {
  const order: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const r = rig({
    onMessage: async m => {
      order.push(`start ${m.id}`)
      if (m.id === 'one') await gate
      order.push(`end ${m.id}`)
    },
  })

  const first = r.inbox.handle(line({ id: 'one' }))
  const second = r.inbox.handle(line({ id: 'two' }))

  await Promise.resolve()
  release()
  await first
  await second

  expect(order).toEqual(['start one', 'end one', 'start two', 'end two'])
})

test('a rejecting onMessage is logged and later lines still flow', async () => {
  const order: string[] = []
  const r = rig({
    onMessage: async m => {
      order.push(m.id)
      if (m.id === 'one') throw new Error('boom')
    },
  })

  await r.inbox.handle(line({ id: 'one' }))
  await r.inbox.handle(line({ id: 'two' }))

  expect(order).toEqual(['one', 'two'])
  expect(r.logs).toHaveLength(1)
})

// A join in progress: no name yet, so `me()` is undefined until `completeJoin` runs.
const joinRig = () => {
  let me: { name: string; sessionId: string } | undefined
  let joining = true
  const r = rig({ me: () => me, joining: () => joining })

  return {
    ...r,
    complete: () => {
      me = { name: 'alpha', sessionId: 'sA' }
    },
    fail: () => {
      joining = false
    },
  }
}

test('lines to my name or * that arrive before the join completes are delivered after it, in order, ahead of a later line', async () => {
  const r = joinRig()

  await r.inbox.handle(line({ id: 'toMe', to: 'alpha' }))
  await r.inbox.handle(line({ id: 'toAll', to: '*' }))
  await r.inbox.handle(line({ id: 'other', to: 'charlie' }))

  expect(r.delivered).toEqual([])

  r.complete()
  void r.inbox.handle(line({ id: 'later', to: 'alpha' }))
  await r.inbox.release()

  expect(r.delivered).toEqual(['toMe', 'toAll', 'later'])
})

test('a later line is still ordered after held lines when it is handled before release runs', async () => {
  const r = joinRig()

  await r.inbox.handle(line({ id: 'h1', to: 'alpha' }))
  r.complete()
  await r.inbox.handle(line({ id: 'later', to: 'alpha' }))

  expect(r.delivered).toEqual(['h1', 'later'])
})

test('held lines are discarded, never delivered, when the join fails', async () => {
  const r = joinRig()

  await r.inbox.handle(line({ id: 'toMe', to: 'alpha' }))
  r.fail()
  r.inbox.discard()
  r.complete()
  await r.inbox.release()
  await r.inbox.handle(line({ id: 'after', to: 'alpha' }))

  expect(r.delivered).toEqual(['after'])
})

test('lines are dropped, not held, when no join is in progress', async () => {
  const r = joinRig()

  r.fail()
  await r.inbox.handle(line({ id: 'x', to: 'alpha' }))
  r.complete()
  await r.inbox.release()

  expect(r.delivered).toEqual([])
})

test('the hold buffer is bounded: the oldest held line is dropped after N+1', async () => {
  const r = joinRig()

  for (let i = 0; i <= HOLD_LIMIT; i++) await r.inbox.handle(line({ id: `h${i}` }))

  r.complete()
  await r.inbox.release()

  expect(r.delivered).toHaveLength(HOLD_LIMIT)
  expect(r.delivered[0]).toBe('h1')
  expect(r.delivered[HOLD_LIMIT - 1]).toBe(`h${HOLD_LIMIT}`)
})

test('a position is stored after its batch was persisted and delivered', async () => {
  const r = rig()

  void r.inbox.handle(line({ id: 'a' }))
  void r.inbox.handle(line({ id: 'b' }))
  await r.inbox.position({ fileId: 'f', offset: 7 })

  expect(r.events).toEqual(['persist', 'deliver', 'persist', 'deliver', 'pos 7'])
})

test('a position still waits for a slow persist', async () => {
  let open: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  const r = rig({
    persist: async () => {
      r.events.push('persist')
      await gate
    },
  })

  void r.inbox.handle(line({ id: 'a' }))
  const done = r.inbox.position({ fileId: 'f', offset: 7 })

  await Promise.resolve()
  await Promise.resolve()

  expect(r.events).toEqual(['persist'])

  open()
  await done

  expect(r.events).toEqual(['persist', 'deliver', 'pos 7'])
})

test('no position is stored past held lines while the join is pending; it is stored once they are processed', async () => {
  const r = joinRig()

  await r.inbox.handle(line({ id: 'h1', to: 'alpha' }))
  await r.inbox.position({ fileId: 'f', offset: 9 })
  await r.inbox.position({ fileId: 'f', offset: 10 })

  expect(r.events).toEqual([])

  r.complete()
  await r.inbox.release()

  expect(r.events).toEqual(['persist', 'deliver', 'pos 10'])
})

test('a held position is dropped when the join fails', async () => {
  const r = joinRig()

  await r.inbox.handle(line({ id: 'h1', to: 'alpha' }))
  await r.inbox.position({ fileId: 'f', offset: 9 })
  r.fail()
  r.inbox.discard()
  r.complete()
  await r.inbox.release()

  expect(r.events).toEqual([])
})

test('a position that arrives after the name is known but before the held lines are processed waits for them', async () => {
  const r = joinRig()

  await r.inbox.handle(line({ id: 'h1', to: 'alpha' }))
  r.complete()
  await r.inbox.position({ fileId: 'f', offset: 9 })

  expect(r.events).toEqual([])

  await r.inbox.release()

  expect(r.events).toEqual(['persist', 'deliver', 'pos 9'])
})
