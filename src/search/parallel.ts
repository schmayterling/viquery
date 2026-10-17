// biome-ignore-all lint/style/noNonNullAssertion: the two shard offsets and pending request ids are generated here.
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads'
import { type Matrix, type Neighbor, scan } from './scan.ts'

type Request = {
  id: number
  matrix: Matrix
  query: Float32Array
  allowed: Uint8Array
}
type Reply = { id: number; hits: Neighbor[] }
if (!isMainThread && workerData === 'viquery-scan') {
  parentPort!.on('message', ({ id, matrix, query, allowed }: Request) => {
    parentPort!.postMessage({
      id,
      hits: scan(matrix, query, allowed),
    } satisfies Reply)
  })
}

export class Scanner {
  private next = 0
  private pending = new Map<
    number,
    { resolve(hits: Neighbor[]): void; reject(error: Error): void }
  >()
  private failure: Error | undefined
  // Node 24: workers share SharedArrayBuffer matrices; query and mask messages are copied.
  // The same URL works standalone and inside the bundled utility entry (whose startup is main-thread only).
  // https://nodejs.org/docs/latest-v24.x/api/worker_threads.html
  private workers = [0, 1].map(() => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: 'viquery-scan',
    })
    worker.on('message', ({ id, hits }: Reply) => {
      this.pending.get(id)?.resolve(hits)
      this.pending.delete(id)
    })
    worker.on('error', (error) => {
      this.failure = error
      for (const call of this.pending.values()) call.reject(error)
      this.pending.clear()
    })
    return worker
  })

  async scan(
    matrix: Matrix,
    query: Float32Array,
    allowed: Uint8Array,
  ): Promise<Neighbor[]> {
    if (this.failure) throw this.failure
    if (!matrix.count) return []
    if (query.length !== matrix.dimensions)
      throw new Error('embedding dimension mismatch')
    const half = Math.ceil(matrix.count / 2)
    const parts = await Promise.all(
      this.workers.map((worker, shard) => {
        const offset = shard * half
        const count = Math.max(0, Math.min(half, matrix.count - offset))
        return new Promise<Neighbor[]>((resolve, reject) => {
          const id = this.next++
          this.pending.set(id, {
            resolve: (hits) =>
              resolve(
                hits.map((h) => ({ index: h.index + offset, score: h.score })),
              ),
            reject,
          })
          worker.postMessage({
            id,
            matrix: {
              data: matrix.data.subarray(
                offset * matrix.dimensions,
                (offset + count) * matrix.dimensions,
              ),
              count,
              dimensions: matrix.dimensions,
            },
            query,
            allowed: allowed.subarray(offset, offset + count),
          } satisfies Request)
        })
      }),
    )
    return parts
      .flat()
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 200)
  }

  async close() {
    await Promise.all(this.workers.map((worker) => worker.terminate()))
  }
}
