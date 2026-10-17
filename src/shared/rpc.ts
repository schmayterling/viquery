// tiny request/response + event rpc over any message port.
// electron MessagePortMain (main, utility) and dom MessagePort (preload) both adapt to Port.
export type Port = {
  post(message: unknown): void
  listen(handler: (message: unknown) => void): void
}

type Request = { id: number; method: string; params: unknown }
type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
type Event = { event: string; data: unknown }

// biome-ignore lint/suspicious/noExplicitAny: handler tables are typed by their callers
type Handlers = Record<string, (params: any) => unknown>

export function serve(port: Port, handlers: Handlers): void {
  port.listen(async (message) => {
    const { id, method, params } = message as Request
    if (typeof id !== 'number') return
    const handler = handlers[method]
    if (!handler) {
      port.post({ id, ok: false, error: `unknown method ${method}` })
      return
    }
    try {
      port.post({ id, ok: true, value: await handler(params) })
    } catch (error) {
      port.post({
        id,
        ok: false,
        error: String((error as Error)?.message ?? error),
      })
    }
  })
}

export function emit(port: Port, event: string, data: unknown): void {
  port.post({ event, data } satisfies Event)
}

export function connect(port: Port) {
  let next = 0
  const pending = new Map<
    number,
    { resolve(v: unknown): void; reject(e: Error): void }
  >()
  const listeners = new Map<string, Set<(data: unknown) => void>>()
  port.listen((message) => {
    const m = message as Response | Event
    if ('event' in m) {
      for (const fn of listeners.get(m.event) ?? []) fn(m.data)
      return
    }
    const call = pending.get(m.id)
    if (!call) return
    pending.delete(m.id)
    if (m.ok) call.resolve(m.value)
    else call.reject(new Error(m.error))
  })
  return {
    call<T>(method: string, params?: unknown): Promise<T> {
      const id = next++
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        port.post({ id, method, params } satisfies Request)
      })
    },
    on(event: string, fn: (data: unknown) => void): () => void {
      const set = listeners.get(event) ?? new Set()
      listeners.set(event, set)
      set.add(fn)
      return () => set.delete(fn)
    },
  }
}

export type Client = ReturnType<typeof connect>

// electron MessagePortMain (main + utility processes)
export const mainPort = (port: {
  postMessage(message: unknown): void
  on(event: 'message', listener: (e: { data: unknown }) => void): unknown
  start(): void
}): Port => ({
  post: (message) => port.postMessage(message),
  listen: (handler) => {
    port.on('message', (e) => handler(e.data))
    port.start()
  },
})
