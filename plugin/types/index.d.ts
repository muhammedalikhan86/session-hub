export type ListenerPos = { fileId: string; offset: number }

// What a reloaded mod needs to take its join back up: the module's variables
// reset on a reload, `$.state` does not.
export type JoinedIdentity = {
  name: string
  role: 'hub' | 'worker'
  presencePath: string
  startedAt: string
  sessionId: string
  account: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-hub': {
      // Cleared (null) on every join and every leave, so one join's position never serves another.
      listenerPos: ListenerPos | null
      // The last delivered line ids, oldest first (bounded; see hooks/inbox.ts).
      seenIds: string[]
      joined: JoinedIdentity | null
    }
  }
}
