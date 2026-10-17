import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import { CHANNELS, type ServiceState, type ViqueryApi } from '../shared/api'
import { type Client, connect, type Port } from '../shared/rpc'

type RendererPort = IpcRendererEvent['ports'][number]
type Clients = { catalog: Client; search: Client }
const domPort = (port: RendererPort): Port => ({
  post: (message) => port.postMessage(message),
  listen: (handler) => {
    port.addEventListener('message', (event: Event) =>
      handler((event as MessageEvent).data),
    )
    port.start()
  },
})

let current: Clients | undefined
let ports: RendererPort[] = []
let resolveClients: (clients: Clients) => void
let rejectClients: (error: Error) => void
function waitForClients() {
  const ready = new Promise<Clients>((resolve, reject) => {
    resolveClients = resolve
    rejectClients = reject
  })
  void ready.catch(() => {})
  return ready
}
let clients = waitForClients()
let serviceState: ServiceState = 'ready'
const serviceListeners = new Set<(state: ServiceState) => void>()
const subscriptions = new Map<string, Set<(data: unknown) => void>>()

ipcRenderer.on(CHANNELS.services, (_event, state: ServiceState) => {
  if (state !== 'ready' && serviceState === 'ready') {
    current?.catalog.disconnect()
    current?.search.disconnect()
    current = undefined
    clients = waitForClients()
  }
  if (state === 'failed')
    rejectClients(new Error('services stopped; restart viquery'))
  serviceState = state
  for (const listener of serviceListeners) listener(state)
})

ipcRenderer.on(CHANNELS.ports, (event) => {
  for (const port of ports) port.close()
  ports = event.ports
  const [catalog, search] = ports as [RendererPort, RendererPort]
  current = {
    catalog: connect(domPort(catalog)),
    search: connect(domPort(search)),
  }
  for (const [event, listeners] of subscriptions)
    current.catalog.on(event, (data) => {
      for (const listener of listeners) listener(data)
    })
  resolveClients(current)
  for (const listener of subscriptions.get('libraryChanged') ?? [])
    listener(null)
})

const call = <T>(peer: keyof Clients, method: string, params?: unknown) =>
  serviceState === 'failed'
    ? Promise.reject<T>(new Error('services stopped; restart viquery'))
    : clients.then((c) => c[peer].call<T>(method, params))
const catalog = <T>(method: string, params?: unknown) =>
  call<T>('catalog', method, params)
const search = <T>(method: string, params?: unknown) =>
  call<T>('search', method, params)
const subscribe = (event: string, listener: (data: never) => void) => {
  let listeners = subscriptions.get(event)
  if (!listeners) {
    listeners = new Set()
    subscriptions.set(event, listeners)
    current?.catalog.on(event, (data) => {
      for (const listener of subscriptions.get(event) ?? []) listener(data)
    })
  }
  const fn = listener as (data: unknown) => void
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const api: ViqueryApi = {
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
  folders: () => catalog('folders'),
  addFolder: () => ipcRenderer.invoke(CHANNELS.addFolder),
  removeFolder: (id) => catalog('removeFolder', id),
  reveal: (id) => ipcRenderer.invoke(CHANNELS.reveal, id),
  library: (filter) => catalog('library', filter),
  items: (ids) => catalog('items', ids),
  scenes: (id) => catalog('scenes', id),
  transcript: (id) => catalog('transcript', id),
  search: (query, filter) => search('search', { query, filter }),
  similar: (id, filter) => search('similar', { id, filter }),
  searchVideo: (id, query) => search('searchVideo', { id, query }),
  pauseIndexing: (paused) => catalog('pauseIndexing', paused),
  onServices: (listener) => {
    serviceListeners.add(listener)
    listener(serviceState)
    return () => {
      serviceListeners.delete(listener)
    }
  },
  onIndex: (listener) => subscribe('index', listener),
  onLibraryChanged: (listener) => subscribe('libraryChanged', listener),
}
contextBridge.exposeInMainWorld('viquery', api)
