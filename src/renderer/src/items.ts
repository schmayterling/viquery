import { useSyncExternalStore } from 'react'
import type { IndexPhase, MediaId, MediaItem } from '../../shared/api'

// MediaItem cache. the columnar LibraryIndex lays out the grid; full items (names, sprites) are
// fetched only for what is on screen or opened, batched into one items() call per tick.
const cache = new Map<MediaId, MediaItem>()
// cached but possibly outdated: still shown, refetched by the next ensureItems
const stale = new Set<MediaId>()
let staleEpoch = 0
const listeners = new Set<() => void>()
let version = 0
let batch: { ids: Set<MediaId>; done: Promise<void> } | null = null

function notify() {
  version++
  for (const l of listeners) l()
}

export const getItem = (id: MediaId) => cache.get(id)

export function ensureItems(ids: Iterable<MediaId>): Promise<void> {
  const missing = [...ids].filter((id) => !cache.has(id) || stale.has(id))
  if (!missing.length) return Promise.resolve()
  if (!batch) {
    const ids = new Set<MediaId>()
    batch = {
      ids,
      done: Promise.resolve().then(async () => {
        batch = null
        const epoch = staleEpoch
        const items = await window.viquery.items([...ids])
        for (const id of ids) {
          // a library change during the request keeps the answer stale
          if (epoch === staleEpoch) stale.delete(id)
          cache.delete(id) // removed media come back without an item
        }
        for (const item of items) cache.set(item.id, item)
        notify()
      }),
    }
  }
  for (const id of missing) batch.ids.add(id)
  return batch.done
}

// sprites and names change as indexing proceeds. items stay readable while they refetch,
// so an open viewer or player never unmounts on an unrelated library change.
export function staleItems() {
  staleEpoch++
  for (const id of cache.keys()) stale.add(id)
  notify()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const useItemsVersion = () =>
  useSyncExternalStore(subscribe, () => version)

// latest indexing phase, for views that only need to know whether work is still pending
let phase: IndexPhase | null = null
let watching = false
const phaseListeners = new Set<() => void>()
const subscribePhase = (l: () => void) => {
  if (!watching) {
    watching = true
    window.viquery.onIndex((s) => {
      phase = s
      for (const p of phaseListeners) p()
    })
  }
  phaseListeners.add(l)
  return () => phaseListeners.delete(l)
}
export const useIndexPhase = () =>
  useSyncExternalStore(subscribePhase, () => phase)
