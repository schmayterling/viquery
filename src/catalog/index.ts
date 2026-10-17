import { realpath } from 'node:fs/promises'
import watcher from '@parcel/watcher'
import type { Filter } from '../shared/api.ts'
import type { ComputeApi, UtilityMessage } from '../shared/protocol.ts'
import { type Client, connect, emit, mainPort, serve } from '../shared/rpc.ts'
import { Catalog } from './core.ts'

export type CatalogReady = { type: 'ready' }

const parent = process.parentPort
let catalog: Catalog
let renderer: Electron.MessagePortMain | undefined
let search: Electron.MessagePortMain | undefined
let resolveCompute: (client: Client) => void
const compute = new Promise<Client>((resolve) => {
  resolveCompute = resolve
})
const subscriptions = new Map<string, watcher.AsyncSubscription>()
const rescans = new Map<number, ReturnType<typeof setTimeout>>()

async function watch(path: string, folderId: number): Promise<void> {
  if (subscriptions.has(path)) return
  try {
    subscriptions.set(
      path,
      await watcher.subscribe(path, (error) => {
        if (error) {
          console.error('watcher:', error.message)
          void subscriptions.get(path)?.unsubscribe().catch(console.error)
          subscriptions.delete(path)
        }
        clearTimeout(rescans.get(folderId))
        rescans.set(
          folderId,
          setTimeout(() => {
            rescans.delete(folderId)
            void rescan(folderId).catch(console.error)
          }, 200),
        )
      }),
    )
  } catch (error) {
    // removable roots can be offline; focus/launch reconciliation retries the watch.
    console.error('watcher:', error)
  }
}

async function rescan(folderId?: number): Promise<void> {
  for (const folder of catalog.folders()) {
    if (folderId === undefined || folder.id === folderId)
      await watch(folder.path, folder.id)
  }
  await catalog.rescan(folderId)
}

const rendererHandlers = () => ({
  folders: () => catalog.folders(),
  removeFolder: async (value: unknown) => {
    const folderId = id(value)
    const folder = catalog.folders().find((row) => row.id === folderId)
    if (folder) {
      await subscriptions.get(folder.path)?.unsubscribe()
      subscriptions.delete(folder.path)
      clearTimeout(rescans.get(folder.id))
      rescans.delete(folder.id)
    }
    catalog.removeFolder(folderId)
  },
  library: (value: unknown) => catalog.library(filter(value)),
  items: (value: unknown) => {
    if (!Array.isArray(value) || value.length > 10000)
      throw new Error('invalid media ids')
    return catalog.items(value.map(id))
  },
  scenes: (value: unknown) => catalog.scenes(id(value)),
  transcript: (value: unknown) => catalog.transcript(id(value)),
  pauseIndexing: (value: unknown) => {
    if (typeof value !== 'boolean') throw new Error('invalid pause state')
    catalog.pauseIndexing(value)
  },
})

parent.on('message', ({ data, ports }) => {
  const message = data as UtilityMessage
  if (message.type === 'init') {
    const call = <T>(method: keyof ComputeApi, params: unknown) =>
      compute.then((client) => client.call<T>(method, params))
    catalog = new Catalog(message.dataDir, {
      probe: (p) => call('probe', p),
      thumb: (p) => call('thumb', p),
      visual: (p) => call('visual', p),
      speech: (p) => call('speech', p),
      ocr: (p) => call('ocr', p),
    })
    catalog.on('index', (state) => {
      if (renderer) emit(mainPort(renderer), 'index', state)
    })
    catalog.on('libraryChanged', () => {
      if (renderer) emit(mainPort(renderer), 'libraryChanged', null)
    })
    catalog.on('change', (change) => {
      if (search) emit(mainPort(search), 'change', change)
    })
    catalog.on('warning', (error) => console.error('catalog:', error.message))
    parent.postMessage({ type: 'ready' } satisfies CatalogReady)
    void compute.then(() => rescan()).catch(console.error)
    return
  }
  const port = ports[0]
  if (!port) return
  if (message.peer === 'compute') resolveCompute(connect(mainPort(port)))
  if (message.peer === 'main')
    serve(mainPort(port), {
      addFolder: async (value: unknown) => {
        if (typeof value !== 'string') throw new Error('invalid folder path')
        const path = await realpath(value)
        // subscribe before the scan so edits during discovery get reconciled.
        return catalog.addFolder(path, (folderId) => watch(path, folderId))
      },
      lookup: (value: unknown) => catalog.lookup(id(value)),
      rescan: () => rescan(),
    })
  if (message.peer === 'renderer') {
    renderer?.close()
    renderer = port
    serve(mainPort(port), rendererHandlers())
    emit(mainPort(port), 'index', catalog.indexState())
  }
  if (message.peer === 'search') {
    search?.close()
    search = port
    port.start()
  }
})

function id(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 0xffffffff
  ) {
    throw new Error('invalid media or folder id')
  }
  return value
}

function filter(value: unknown): Filter {
  if (!value || typeof value !== 'object')
    throw new Error('invalid library filter')
  const f = value as Filter
  if (
    !f.scope ||
    !['all', 'recent', 'folder'].includes(f.scope.kind) ||
    !['all', 'image', 'video'].includes(f.media) ||
    (f.takenFrom !== undefined && !Number.isFinite(f.takenFrom)) ||
    (f.takenTo !== undefined && !Number.isFinite(f.takenTo))
  )
    throw new Error('invalid library filter')
  if (f.scope.kind === 'folder') id(f.scope.folderId)
  return f
}
