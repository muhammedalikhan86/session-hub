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
    'session-hub': { listenerPos: ListenerPos; joined: JoinedIdentity | null }
  }
}
