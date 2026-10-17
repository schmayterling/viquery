import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import { CHANNELS, type ViqueryApi } from '../shared/api'
import { type Client, connect, type Port } from '../shared/rpc'

type RendererPort = IpcRendererEvent['ports'][number]

const domPort = (port: RendererPort): Port => ({
  post: (message) => port.postMessage(message),
  listen: (handler) => {
    port.addEventListener('message', (event: Event) =>
      handler((event as MessageEvent).data),
    )
    port.start()
  },
})

// main sends [catalog, search] ports once the page loads; calls made earlier wait for them.
const clients = new Promise<{ catalog: Client; search: Client }>((resolve) => {
  ipcRenderer.once(CHANNELS.ports, (event) => {
    const [catalog, search] = event.ports as [RendererPort, RendererPort]
    resolve({
      catalog: connect(domPort(catalog)),
      search: connect(domPort(search)),
    })
  })
})

const catalog = <T>(method: string, params?: unknown) =>
  clients.then((c) => c.catalog.call<T>(method, params))
const search = <T>(method: string, params?: unknown) =>
  clients.then((c) => c.search.call<T>(method, params))
const subscribe = (event: string, listener: (data: never) => void) => {
  let off = () => {}
  let closed = false
  clients.then((c) => {
    if (!closed) off = c.catalog.on(event, listener as (data: unknown) => void)
  })
  return () => {
    closed = true
    off()
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
  pauseIndexing: (paused) => catalog('pauseIndexing', paused),
  onIndex: (listener) => subscribe('index', listener),
  onLibraryChanged: (listener) => subscribe('libraryChanged', listener),
}

contextBridge.exposeInMainWorld('viquery', api)
