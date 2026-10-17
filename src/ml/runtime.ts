import { availableParallelism } from 'node:os'

// Keep indexing within the platform budget; search has its own utility process.
export const THREADS = {
  compute: availableParallelism() >= 8 ? 2 : 1,
  search: 2,
  sharp: 1,
} as const
