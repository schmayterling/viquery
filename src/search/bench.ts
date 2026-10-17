// biome-ignore-all lint/style/noNonNullAssertion: generated matrices and nonempty timing samples are bounded here.
import assert from 'node:assert/strict'
import os from 'node:os'
import { Scanner } from './parallel.ts'
import { scan, scanPlain } from './scan.ts'

const dimensions = 512
const runs = 50
const warmups = 10
const limit = 200
let seed = 0x12345678
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 4294967296 - 0.5
}
function vector() {
  const v = Float32Array.from({ length: dimensions }, random)
  const norm = Math.hypot(...v)
  return v.map((x) => x / norm)
}
function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    minMs: sorted[0],
    p50Ms: sorted[Math.ceil(runs * 0.5) - 1],
    p95Ms: sorted[Math.ceil(runs * 0.95) - 1],
    maxMs: sorted.at(-1),
    samplesMs: samples,
  }
}
console.log(
  JSON.stringify({
    env: {
      cpu: os.cpus()[0]!.model,
      cores: os.availableParallelism(),
      memoryGiB: os.totalmem() / 2 ** 30,
      os: os.release(),
      arch: process.arch,
      node: process.version,
      v8: process.versions.v8,
    },
    dimensions,
    runs,
    warmups,
    limit,
    workload:
      'seeded normalized f32, warm ram; dot + filter mask + exact top-200; workers include query/mask/result ipc; excludes models/db/fusion/electron ipc',
  }),
)
for (const count of [100_000, 500_000]) {
  const data = new Float32Array(new SharedArrayBuffer(count * dimensions * 4))
  for (let i = 0; i < count; i++) data.set(vector(), i * dimensions)
  const matrix = { data, count, dimensions }
  const allowed = new Uint8Array(count).fill(1)
  const queries = Array.from({ length: runs + warmups }, vector)
  const oracle = scanPlain(matrix, queries[0]!, allowed, limit)
  const fast = scan(matrix, queries[0]!, allowed, limit)
  assert.deepEqual(
    fast.map((n) => n.index),
    oracle.map((n) => n.index),
  )
  for (let i = 0; i < limit; i++)
    assert.ok(Math.abs(fast[i]!.score - oracle[i]!.score) < 1e-9)
  for (const [kernel, fn] of [
    ['plain', scanPlain],
    ['unrolled4', scan],
  ] as const) {
    const samples: number[] = []
    let checksum = 0
    for (let i = 0; i < queries.length; i++) {
      const start = performance.now()
      const result = fn(matrix, queries[i]!, allowed, limit)
      const took = performance.now() - start
      checksum += result[0]!.index
      if (i >= warmups) samples.push(took)
    }
    console.log(
      JSON.stringify({
        count,
        bytes: data.byteLength,
        kernel,
        ...summary(samples),
        checksum,
      }),
    )
  }
  const scanner = new Scanner()
  try {
    const samples: number[] = []
    let checksum = 0
    for (let i = 0; i < queries.length; i++) {
      const start = performance.now()
      const result = await scanner.scan(matrix, queries[i]!, allowed)
      const took = performance.now() - start
      if (i === 0) assert.deepEqual(result, fast)
      checksum += result[0]!.index
      if (i >= warmups) samples.push(took)
    }
    console.log(
      JSON.stringify({
        count,
        bytes: data.byteLength,
        kernel: 'unrolled4-workers2',
        ...summary(samples),
        checksum,
      }),
    )
  } finally {
    await scanner.close()
  }
}
