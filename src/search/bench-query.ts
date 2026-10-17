// biome-ignore-all lint/style/noNonNullAssertion: fixed schema block and nonempty benchmark samples.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MessageChannel } from 'node:worker_threads'
import { THREADS } from '../ml/runtime.ts'
import { loadTextEncoders } from '../ml/text.ts'
import type { Filter, SearchResult } from '../shared/api.ts'
import { GENERATION } from '../shared/protocol.ts'
import { connect, type Port, serve } from '../shared/rpc.ts'
import { SearchEngine } from './engine.ts'

// Optional full-path check: node --experimental-strip-types src/search/bench-query.ts /path/to/models
// Synthetic vectors are NOT retrieval-quality evidence. Node MessagePorts do not measure Electron IPC.
const modelsDir = process.argv[2]
if (!modelsDir) throw new Error('usage: bench-query.ts /path/to/local/models')
const root = mkdtempSync(join(os.tmpdir(), 'viquery-search-bench-'))
const path = join(root, 'viquery.db')
const db = new DatabaseSync(path)
let engine: SearchEngine | undefined
const { port1, port2 } = new MessageChannel()
const adapt = (port: typeof port1): Port => ({
  post: (message) => port.postMessage(message),
  listen: (handler) => {
    port.on('message', handler)
  },
})
const stats = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    minMs: sorted[0],
    p50Ms: sorted[24],
    p95Ms: sorted[47],
    maxMs: sorted[49],
    samplesMs: samples,
  }
}
let seed = 42
function vector(dimensions: number) {
  const v = Float32Array.from({ length: dimensions }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  })
  const norm = Math.hypot(...v)
  return new Uint8Array(v.map((x) => x / norm).buffer)
}
try {
  const schema = readFileSync(
    new URL('../../docs/ARCHITECTURE.md', import.meta.url),
    'utf8',
  ).match(/```sql\n([\s\S]*?)```/u)![1]
  db.exec(`pragma journal_mode = wal; ${schema}`)
  db.exec("insert into folder values(1, '/synthetic', 0); begin")
  const media = db.prepare(
    'insert into media(id, sha256, kind, width, height, duration_ms, has_audio, taken_at, added_at, bytes) values(?, ?, ?, 100, 100, 1000, 1, 0, ?, 1)',
  )
  const file = db.prepare(
    'insert into file(path, folder_id, media_id, name, size, mtime_ms) values(?, 1, ?, ?, 1, 0)',
  )
  const sample = db.prepare(
    'insert into sample(media_id, scene_id, generation, t_ms, embedding) values(?, ?, ?, 0, ?)',
  )
  const scene = db.prepare('insert into scene values(?, ?, ?, 0, 1000)')
  const transcript = db.prepare(
    "insert into transcript(media_id, generation, start_ms, end_ms, language, text, embedding) values(?, ?, 0, 1000, 'en', 'needle in haystack', ?)",
  )
  const job = db.prepare(
    "insert into job(media_id, stage, generation, state) values(?, 'visual', ?, 'done')",
  )
  for (let id = 1; id <= 90_000; id++) {
    const video = id <= 10_000
    const hash = Buffer.alloc(32)
    hash.writeUInt32LE(id)
    media.run(id, hash, Number(video), Date.now())
    file.run(`/synthetic/${id}`, id, `${id % 10 ? 'frame' : 'needle'} ${id}`)
    if (video) scene.run(id, id, GENERATION.visual)
    sample.run(id, video ? id : null, GENERATION.visual, vector(512))
    if (video) transcript.run(id, GENERATION.speech, vector(384))
    job.run(id, GENERATION.visual)
  }
  db.exec(
    "commit; insert into file_fts(file_fts) values('rebuild'); insert into transcript_fts(transcript_fts) values('rebuild')",
  )
  const encoders = await loadTextEncoders(modelsDir)
  const clipMs: number[] = [],
    sentenceMs: number[] = []
  engine = new SearchEngine(path, {
    clip: async (query) => {
      const start = performance.now()
      const v = await encoders.clip(query)
      clipMs.push(performance.now() - start)
      return v
    },
    sentence: async (query) => {
      const start = performance.now()
      const v = await encoders.sentence(query)
      sentenceMs.push(performance.now() - start)
      return v
    },
  })
  const search = engine
  serve(adapt(port2), {
    search: ({ query, filter }: { query: string; filter: Filter }) =>
      search.search(query, filter),
  })
  const client = connect(adapt(port1))
  const elapsed: number[] = [],
    internal: number[] = []
  for (let i = 0; i < 60; i++) {
    const start = performance.now()
    const result = await client.call<SearchResult>('search', {
      query: `needle person in field ${i}`,
      filter: { scope: { kind: 'all' }, media: 'all' },
    })
    if (i >= 10) {
      elapsed.push(performance.now() - start)
      internal.push(result.tookMs)
    }
  }
  const repeated: number[] = []
  for (let i = 0; i < 50; i++) {
    const start = performance.now()
    await client.call('search', {
      query: 'needle person in field 59',
      filter: { scope: { kind: 'all' }, media: 'all' },
    })
    repeated.push(performance.now() - start)
  }
  console.log(
    JSON.stringify({
      encoderThreads: THREADS.search,
      repeated: stats(repeated),
      env: {
        cpu: os.cpus()[0]!.model,
        cores: os.availableParallelism(),
        memoryGiB: os.totalmem() / 2 ** 30,
        os: os.release(),
        node: process.version,
        v8: process.versions.v8,
        arch: process.arch,
      },
      warmups: 10,
      runs: 50,
      vectors: { samples: 90_000, transcripts: 10_000 },
      workload:
        'real local encoders, seeded normalized vectors, fts, fusion, node MessagePort roundtrip; excludes Electron IPC',
      roundtrip: stats(elapsed),
      internal: stats(internal),
      clip: stats(clipMs.slice(10)),
      sentence: stats(sentenceMs.slice(10)),
    }),
  )
} finally {
  await engine?.close()
  db.close()
  port1.close()
  port2.close()
  rmSync(root, { recursive: true, force: true })
}
