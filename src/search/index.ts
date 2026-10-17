import type { MessagePortMain } from 'electron'
import type { Filter } from '../shared/api.ts'
import { dataPaths } from '../shared/paths.ts'
import type {
  CatalogChange,
  TextEncoders,
  UtilityMessage,
} from '../shared/protocol.ts'
import { connect, mainPort, serve } from '../shared/rpc.ts'
import { SearchEngine } from './engine.ts'

type ParentPort = {
  on(
    event: 'message',
    listener: (event: {
      data: UtilityMessage
      ports: MessagePortMain[]
    }) => void,
  ): unknown
}
type LoadEncoders = (modelsDir: string) => Promise<TextEncoders>

// Kept lazy so node --test can exercise the real utility with a fake encoder and no model pack.
const loadEncoders: LoadEncoders = async (modelsDir) => {
  const { loadTextEncoders } = await import('../ml/text.ts')
  return loadTextEncoders(modelsDir)
}

export function startSearchUtility(
  parent: ParentPort,
  load: LoadEncoders = loadEncoders,
) {
  let ready: Promise<SearchEngine>
  let renderer: MessagePortMain | undefined
  let catalog: MessagePortMain | undefined
  let engine: SearchEngine | undefined
  parent.on('message', ({ data, ports }) => {
    if (data.type === 'init') {
      ready = load(data.modelsDir).then((encoders) => {
        engine = new SearchEngine(dataPaths(data.dataDir).db, encoders)
        return engine
      })
      // Observe startup errors immediately; waiting renderer calls still receive the rejection.
      ready.catch((error: unknown) =>
        console.error('search startup failed', error),
      )
      return
    }
    const port = ports[0]
    if (!port) throw new Error('missing search utility port')
    if (data.peer === 'renderer') {
      renderer?.close()
      renderer = port
      serve(mainPort(port), {
        search: async ({ query, filter }: { query: string; filter: Filter }) =>
          (await ready).search(query, filter),
        similar: async ({ id, filter }: { id: number; filter: Filter }) =>
          (await ready).similar(id, filter),
      })
    } else if (data.peer === 'catalog') {
      catalog?.close()
      catalog = port
      connect(mainPort(port)).on('change', (change) => {
        // Catalog is trusted, emits only after commit, and changed media may reuse rowids.
        void ready.then((search) => search.refresh(change as CatalogChange))
      })
    }
  })
  return {
    async close() {
      renderer?.close()
      catalog?.close()
      await ready?.then(
        () => engine?.close(),
        () => {},
      )
    },
  }
}

if (process.parentPort) startSearchUtility(process.parentPort)
