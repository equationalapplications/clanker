type Listener = (...args: unknown[]) => void
export function installChromeStub(over: Record<string, unknown> = {}): void {
  const store: Record<string, unknown> = {}
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: { sendMessage: async () => undefined, onMessage: { addListener: (_l: Listener) => {} }, getURL: (p: string) => p, lastError: undefined },
    storage: { local: {
      get: async (k: string) => ({ [k]: store[k] }),
      set: async (o: Record<string, unknown>) => { Object.assign(store, o) },
    } },
    gcm: { register: (_ids: string[], cb: (t: string) => void) => cb('gcm-token'), onMessage: { addListener: (_l: Listener) => {} } },
    offscreen: { hasDocument: async () => false, createDocument: async () => {}, closeDocument: async () => {} },
    scripting: { executeScript: async () => [{ result: undefined }] },
    permissions: { contains: async () => true, request: async () => true },
    notifications: { create: () => {}, onClicked: { addListener: (_l: Listener) => {} } },
    tabs: {
      create: async () => ({ id: 1 }),
      query: async () => [{ id: 1, url: 'https://x' }],
      update: async () => ({}),
      sendMessage: (_tabId: number, _msg: unknown, cb: (response: unknown) => void) => { cb(undefined) },
    },
    sidePanel: { open: async () => {} },
    ...over,
  }
}
