// biome-ignore-all lint/style/noNonNullAssertion: the manifest and nonempty score groups are fixed fixtures.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { binaries, dot } from '../../tests/compute-tools.ts'
import { createComputeApi } from '../compute/api.ts'
import { loadTextEncoders } from '../ml/text.ts'
import { relevanceCutoff } from './engine.ts'

// node --experimental-strip-types src/search/bench-calibration.ts /path/to/research/raw/images
// Production decode, preprocessing and encoders; all models/data local. No downloads.
const imagesDir = resolve(process.argv[2] ?? 'research/raw/images')
const manifest = JSON.parse(
  readFileSync(join(imagesDir, 'manifest.json'), 'utf8'),
) as {
  file: string
  query: string
  sha256: string
}[]
const compute = createComputeApi({
  type: 'init',
  dataDir: resolve('out/calibration'),
  modelsDir: resolve('models'),
  ...binaries(),
})
const encoders = await loadTextEncoders(resolve('models'))
const vectors: Float32Array[] = []
for (const [i, item] of manifest.entries())
  vectors.push(
    (
      await compute.visual({
        mediaId: i + 1,
        path: join(imagesDir, item.file),
        kind: 'image',
        durationMs: null,
      })
    ).samples[0]!.embedding,
  )
const abstractQueries = [
  'a happy moment',
  'scenery at dusk',
  'a quiet place',
  'a warm drink',
  'a journey into space',
  'natural textures',
  'a person outside',
  'an animal resting',
]
const unrelatedQueries = [
  'purple giraffe',
  'an underwater wedding',
  'a snowmobile in a blizzard',
  'a dragon juggling pancakes',
]
const queries = [
  ...manifest.map((item) => item.query),
  ...abstractQueries,
  ...unrelatedQueries,
]
const rows = []
for (const query of queries) {
  const encoded = await encoders.clip(query)
  const scores = vectors.map((v) => dot(v, encoded))
  const ranked = scores
    .map((score, i) => ({ image: manifest[i]!.file, score }))
    .sort((a, b) => b.score - a.score)
  rows.push({ query, scores, ranked })
}
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return {
    n: sorted.length,
    min: sorted[0],
    median:
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2,
    max: sorted.at(-1),
  }
}
const matching = rows.slice(0, manifest.length).map((r, i) => r.scores[i]!)
const nonMatching = rows
  .slice(0, manifest.length)
  .flatMap((r, i) => r.scores.filter((_, j) => i !== j))
const corpus = []
const db = new DatabaseSync(
  resolve('out/core-smoke-profile/library/viquery.db'),
  { readOnly: true },
)
for (const query of [
  'a rocket launching',
  'an astronaut',
  'ask what you can do for your country',
  'a cat',
  'a cup of coffee',
  ...abstractQueries,
  ...unrelatedQueries,
]) {
  const signals = []
  for (const [table, encode] of [
    ['sample', encoders.clip],
    ['transcript', encoders.sentence],
  ] as const) {
    const q = await encode(query)
    for (const row of db
      .prepare(
        `select x.*, f.name from ${table} x join file f on f.media_id = x.media_id`,
      )
      .all()) {
      const v = new Float32Array((row.embedding as Uint8Array).slice().buffer)
      signals.push({
        signal: table,
        name: row.name,
        sceneId: row.scene_id,
        startMs: row.start_ms,
        endMs: row.end_ms,
        tMs: row.t_ms,
        text: row.text,
        cosine: dot(v, q),
      })
    }
  }
  const best = new Map<string, (typeof signals)[number]>()
  for (const signal of signals) {
    const key = `${signal.signal}:${signal.name}:${signal.sceneId ?? `${signal.startMs}:${signal.endMs}`}`
    if (signal.cosine > (best.get(key)?.cosine ?? -Infinity))
      best.set(key, signal)
  }
  corpus.push({ query, signals: [...best.values()] })
}
db.close()
const correct = rows
  .slice(0, manifest.length)
  .filter((row, i) => row.ranked[0]!.image === manifest[i]!.file).length
assert.equal(correct, manifest.length)
const gated = rows.slice(0, manifest.length).map((row, i) => {
  const cutoff = relevanceCutoff('visual', row.ranked[0]!.score)
  return {
    positive: row.scores[i]! >= cutoff,
    negatives: row.scores.filter((score, j) => j !== i && score >= cutoff)
      .length,
  }
})
assert.ok(gated.every((row) => row.positive))
assert.equal(
  gated.reduce((n, row) => n + row.negatives, 0),
  0,
)
console.log(
  JSON.stringify({
    date: new Date().toISOString(),
    cpu: os.cpus()[0]!.model,
    models: 'Xenova/clip-vit-base-patch32 int8; Xenova/all-MiniLM-L6-v2 q8',
    workload:
      'full 10x10 named-pair matrix + 8 unlabeled abstract queries; production compute.visual/text encoders; launch + generated bars/tone/silence from core-smoke',
    manifest,
    matching: summary(matching),
    nonMatching: summary(nonMatching),
    top1: correct,
    gated: {
      namedAccepted: gated.filter((r) => r.positive).length,
      mismatchedAccepted: gated.reduce((n, r) => n + r.negatives, 0),
    },
    rows: rows.map(({ query, scores, ranked }) => ({
      query,
      scores,
      top: ranked[0],
      gap: ranked[0]!.score - ranked[1]!.score,
      cutoff: relevanceCutoff('visual', ranked[0]!.score),
      accepted: ranked
        .filter((r) => r.score >= relevanceCutoff('visual', ranked[0]!.score))
        .map((r) => r.image),
    })),
    corpus,
  }),
)
