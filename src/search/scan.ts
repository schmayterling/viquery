// biome-ignore-all lint/style/noNonNullAssertion: array accesses stay inside matrix dimensions and heap bounds.
export type Matrix = {
  data: Float32Array
  count: number
  dimensions: number
}
export type Neighbor = { index: number; score: number }

function offer(heap: Neighbor[], index: number, score: number, limit: number) {
  if (heap.length === limit && score <= heap[0]!.score) return
  let i: number
  if (heap.length < limit) {
    i = heap.length
    heap.push({ index, score })
    while (i > 0) {
      const p = (i - 1) >>> 1
      if (heap[p]!.score <= score) break
      heap[i] = heap[p]!
      i = p
    }
  } else {
    i = 0
    while (i * 2 + 1 < heap.length) {
      let child = i * 2 + 1
      if (
        child + 1 < heap.length &&
        heap[child + 1]!.score < heap[child]!.score
      )
        child++
      if (heap[child]!.score >= score) break
      heap[i] = heap[child]!
      i = child
    }
  }
  heap[i] = { index, score }
}

export function scan(
  matrix: Matrix,
  query: Float32Array,
  allowed?: Uint8Array,
  limit = 200,
  indices?: readonly number[],
): Neighbor[] {
  const { data, count, dimensions } = matrix
  if (!count || limit <= 0) return []
  if (query.length !== dimensions)
    throw new Error('embedding dimension mismatch')
  const heap: Neighbor[] = []
  const unrolled = dimensions - (dimensions % 4)
  for (let row = 0; row < (indices?.length ?? count); row++) {
    const index = indices ? indices[row]! : row
    const offset = index * dimensions
    if (allowed && !allowed[index]) continue
    let a = 0,
      b = 0,
      c = 0,
      d = 0
    let j = 0
    for (; j < unrolled; j += 4) {
      a += data[offset + j]! * query[j]!
      b += data[offset + j + 1]! * query[j + 1]!
      c += data[offset + j + 2]! * query[j + 2]!
      d += data[offset + j + 3]! * query[j + 3]!
    }
    let score = a + b + c + d
    for (; j < dimensions; j++) score += data[offset + j]! * query[j]!
    if (limit >= (indices?.length ?? count)) heap.push({ index, score })
    else offer(heap, index, score, limit)
  }
  return heap.sort((a, b) => b.score - a.score || a.index - b.index)
}

// Baseline retained for the synthetic benchmark's before/after comparison.
export function scanPlain(
  matrix: Matrix,
  query: Float32Array,
  allowed?: Uint8Array,
  limit = 200,
): Neighbor[] {
  const { data, count, dimensions } = matrix
  const heap: Neighbor[] = []
  for (
    let index = 0, offset = 0;
    index < count;
    index++, offset += dimensions
  ) {
    if (allowed && !allowed[index]) continue
    let score = 0
    for (let j = 0; j < dimensions; j++) score += data[offset + j]! * query[j]!
    offer(heap, index, score, limit)
  }
  return heap.sort((a, b) => b.score - a.score || a.index - b.index)
}
