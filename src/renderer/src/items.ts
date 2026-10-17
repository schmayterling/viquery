import { useSyncExternalStore } from 'react'
import type { IndexPhase, MediaId, MediaItem } from '../../shared/api'

// MediaItem cache. the columnar LibraryIndex lays out the grid; full items (names, sprites) are
// fetched only for what is on screen or opened, batched into one items() call per tick.
const cache = new Map<MediaId, MediaItem>()
const listeners = new Set<() => void>()
let version = 0
let batch: { ids: Set<MediaId>; done: Promise<void> } | null = null

function notify() {
  version++
  for (const l of listeners) l()
}

export const getItem = (id: MediaId) => cache.get(id)

export function ensureItems(ids: Iterable<MediaId>): Promise<void> {
  const missing = [...ids].filter((id) => !cache.has(id))
  if (!missing.length) return Promise.resolve()
  if (!batch) {
    const ids = new Set<MediaId>()
    batch = {
      ids,
      done: Promise.resolve().then(async () => {
        batch = null
        for (const item of await window.viquery.items([...ids]))
          cache.set(item.id, item)
        notify()
      }),
    }
  }
  for (const id of missing) batch.ids.add(id)
  return batch.done
}

// sprites and names change as indexing proceeds
export function clearItems() {
  cache.clear()
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
