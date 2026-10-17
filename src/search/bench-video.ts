// biome-ignore-all lint/style/noNonNullAssertion: generated rows and nonempty timing samples are bounded here.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import type { MessagePortMain } from 'electron'
import { openDatabase } from '../catalog/schema.ts'
import type { SceneMatch } from '../shared/api.ts'
import { dataPaths } from '../shared/paths.ts'
import { GENERATION } from '../shared/protocol.ts'
import { connect } from '../shared/rpc.ts'
import { startSearchUtility } from './index.ts'

// node --experimental-strip-types src/search/bench-video.ts [models]
// Same 2h/2,000-scene video before/after unrelated library growth; real utility RPC.
// Seeded normalized vectors measure latency, not retrieval quality. Models load before timing.
const modelsDir = process.argv[2]
const unit = (dimensions: number) => {
  const v = new Float32Array(dimensions)
  v[0] = 1
  return v
}
const encoders = modelsDir
  ? await (await import('../ml/text.ts')).loadTextEncoders(modelsDir)
  : { clip: async () => unit(512), sentence: async () => unit(384) }
const root = mkdtempSync(join(os.tmpdir(), 'viquery-video-bench-'))
const db = openDatabase(dataPaths(root).db)
const runs = 50
const warmups = 10
const sceneCount = 2000
let seed = 42
function vector(dimensions: number) {
  const v = Float32Array.from({ length: dimensions }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  })
  const norm = Math.hypot(...v)
  return new Uint8Array(v.map((x) => x / norm).buffer)
}
const visual = Array.from({ length: 32 }, () => vector(512))
const speech = Array.from({ length: 32 }, () => vector(384))
const media =
  db.prepare(`insert into media(id, sha256, kind, width, height, duration_ms, has_audio, taken_at, added_at, bytes)
  values(?, ?, 1, 128, 96, 7200000, 1, 0, 0, 1)`)
const file = db.prepare(
  "insert into file(path, folder_id, media_id, name, size, mtime_ms) values(?, 1, ?, 'video.mp4', 1, 0)",
)
const scene = db.prepare('insert into scene values(?, ?, ?, ?, ?)')
const sample = db.prepare(
  'insert into sample(media_id, scene_id, generation, t_ms, embedding) values(?, ?, ?, ?, ?)',
)
const transcript = db.prepare(
  "insert into transcript(media_id, generation, start_ms, end_ms, language, text, embedding) values(?, ?, ?, ?, 'en', 'needle in haystack', ?)",
)
function addMedia(id: number) {
  const hash = Buffer.alloc(32)
  hash.writeUInt32LE(id)
  media.run(id, hash)
  file.run(`/synthetic/${id}.mp4`, id)
}
function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    minMs: sorted[0],
    p50Ms: sorted[24],
    p95Ms: sorted[47],
    maxMs: sorted[49],
    samplesMs: samples,
  }
}
async function measure(unrelatedVectors: number) {
  const parent = new EventEmitter()
  const utility = startSearchUtility(parent, async () => encoders)
  const { port1, port2 } = new MessageChannel()
  parent.emit('message', {
    data: {
      type: 'init',
      dataDir: root,
      modelsDir: '',
      ffmpeg: '',
      ffprobe: '',
    },
    ports: [],
  })
  parent.emit('message', {
    data: { type: 'port', peer: 'renderer' },
    ports: [
      {
        postMessage: (data: unknown) => port2.postMessage(data),
        on: (_event: string, handler: (e: { data: unknown }) => void) =>
          port2.on('message', (data) => handler({ data })),
        start: () => port2.start(),
        close: () => port2.close(),
      } as unknown as MessagePortMain,
    ],
  })
  const client = connect({
    post: (message) => port1.postMessage(message),
    listen: (handler) => {
      port1.on('message', handler)
    },
  })
  const call = async (query: string) => {
    const start = performance.now()
    const result = await client.call<SceneMatch[]>('searchVideo', {
      id: 1,
      query,
    })
    const elapsed = performance.now() - start
    assert.equal(result.length, sceneCount)
    return elapsed
  }
  try {
    // The first request includes utility startup, encoder warmup and building the video FTS.
    const firstMs = await call('needle')
    for (let i = 0; i < warmups; i++) await call('needle')
    const cached: number[] = [],
      uncached: number[] = []
    for (let i = 0; i < runs; i++) cached.push(await call('needle'))
    for (let i = 0; i < runs; i++) uncached.push(await call(`needle ${i}`))
    return {
      unrelatedVectors,
      firstMs,
      cached: stats(cached),
      uncached: stats(uncached),
    }
  } finally {
    await utility.close()
    port1.close()
  }
}
try {
  db.exec("insert into folder values(1, '/synthetic', 0); begin")
  addMedia(1)
  for (let i = 0; i < sceneCount; i++) {
    const start = i * 3600
    scene.run(i + 1, 1, GENERATION.visual, start, start + 3600)
    for (const offset of [720, 1800, 2880])
      sample.run(1, i + 1, GENERATION.visual, start + offset, visual[i % 32]!)
    transcript.run(1, GENERATION.speech, start, start + 3600, speech[i % 32]!)
  }
  db.exec('commit')
  const baseline = await measure(0)
  db.exec('begin')
  addMedia(2)
  scene.run(3000, 2, GENERATION.visual, 0, 10000)
  for (let i = 0; i < 92000; i++)
    sample.run(2, 3000, GENERATION.visual, 5000, visual[i % 32]!)
  for (let i = 0; i < 10000; i++)
    transcript.run(2, GENERATION.speech, 0, 10000, speech[i % 32]!)
  db.exec('commit')
  const grown = await measure(102000)
  console.log(
    JSON.stringify({
      env: {
        cpu: os.cpus()[0]!.model,
        os: os.release(),
        node: process.version,
        arch: process.arch,
      },
      workload:
        '2h video, 2000 scenes, 6000 CLIP samples, 2000 transcript segments; 50 cached + 50 uncached queries after 10 warmups; Node MessagePort roundtrip, excludes Electron IPC and model loading',
      encoders: modelsDir ? 'real local models' : 'fake',
      runs,
      warmups,
      baseline,
      grown,
    }),
  )
} finally {
  db.close()
  rmSync(root, { recursive: true, force: true })
}
