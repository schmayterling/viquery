// node --experimental-strip-types tests/text-encoders-bench.ts
import { writeFile } from 'node:fs/promises'
import { cpus, release } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { loadClipTextEncoder, loadSentenceEncoder } from '../src/ml/index.ts'
import { modelsDir, root } from './compute-tools.ts'

const query = 'kids jumping off a dock'
const warmups = 10
const runs = 50
const round = (value: number) => Math.round(value * 1000) / 1000
async function measure(fn: () => Promise<unknown>) {
  for (let i = 0; i < warmups; i++) await fn()
  const times = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    await fn()
    times.push(performance.now() - start)
  }
  const sorted = [...times].sort((a, b) => a - b)
  return {
    p50_ms: round(((sorted[24] as number) + (sorted[25] as number)) / 2),
    p95_ms: round(sorted[47] as number),
    min_ms: round(sorted[0] as number),
    max_ms: round(sorted[49] as number),
    samples_ms: times.map(round),
  }
}

const measurements = []
for (const threads of [1, 2]) {
  const clip = await loadClipTextEncoder(modelsDir, threads)
  const sentence = await loadSentenceEncoder(modelsDir, threads)
  const row = {
    threads,
    clip: await measure(() => clip(query)),
    sentence: await measure(() => sentence(query)),
    concurrent: await measure(() =>
      Promise.all([clip(query), sentence(query)]),
    ),
  }
  measurements.push(row)
  console.log(
    JSON.stringify({
      threads,
      clip: [row.clip.p50_ms, row.clip.p95_ms],
      sentence: [row.sentence.p50_ms, row.sentence.p95_ms],
      concurrent: [row.concurrent.p50_ms, row.concurrent.p95_ms],
    }),
  )
}
const result = {
  date: new Date().toISOString(),
  cpu: cpus()[0]?.model,
  cores: cpus().length,
  platform: process.platform,
  release: release(),
  node: process.version,
  provider: 'cpu',
  warmups,
  runs,
  query,
  timing:
    'tokenize + inference + pooling/normalization; warm; p95 nearest-rank 48/50',
  limitations:
    'shared laptop, short fixed query, no search scan/fts/fusion/ipc',
  measurements,
}
await writeFile(
  join(root, 'tests/text-encoders-bench-results.json'),
  `${JSON.stringify(result, null, 2)}\n`,
)
