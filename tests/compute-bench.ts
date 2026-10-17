// Run serially: node --experimental-strip-types tests/compute-bench.ts
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants, cpus, release, setPriority } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { createComputeApi } from '../src/compute/api.ts'
import { THREADS } from '../src/ml/runtime.ts'
import { binaries, fixture, modelsDir, root } from './compute-tools.ts'

setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL)
const dataDir = await mkdtemp(join(modelsDir, '.compute-bench-'))
const tools = binaries()
const compute = createComputeApi({ type: 'init', dataDir, modelsDir, ...tools })
const launch = join(fixture, 'launch.mp4')
const cat = {
  mediaId: 1,
  path: join(fixture, 'cat.jpg'),
  kind: 'image' as const,
  durationMs: null,
}

async function time(fn: () => Promise<unknown>) {
  const start = performance.now()
  await fn()
  return performance.now() - start
}
const round = (value: number) => Math.round(value * 1000) / 1000
function stats(times: number[], durationMs?: number) {
  const sorted = [...times].sort((a, b) => a - b)
  const p50 =
    ((sorted[Math.floor((sorted.length - 1) / 2)] as number) +
      (sorted[Math.floor(sorted.length / 2)] as number)) /
    2
  return {
    runs: times.length,
    min_ms: round(Math.min(...times)),
    p50_ms: round(p50),
    max_ms: round(Math.max(...times)),
    samples_ms: times.map(round),
    ...(durationMs
      ? { seconds_per_media_minute: round((p50 / durationMs) * 60) }
      : {}),
  }
}

try {
  const coldImageMs = await time(() => compute.visual(cat))
  for (let i = 0; i < 2; i++) await compute.visual(cat)
  const imageTimes: number[] = []
  for (let i = 0; i < 12; i++) {
    const path = join(fixture, i % 2 ? 'coffee.jpg' : 'cat.jpg')
    imageTimes.push(await time(() => compute.visual({ ...cat, path })))
  }

  const longer = join(dataDir, 'repeated-launch-66s.mp4')
  await promisify(execFile)(tools.ffmpeg, [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-stream_loop',
    '5',
    '-i',
    launch,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-t',
    '66',
    '-c',
    'copy',
    longer,
  ])
  const metadata = await compute.probe({ path: launch })
  const input = {
    mediaId: 2,
    path: launch,
    kind: 'video' as const,
    durationMs: metadata.durationMs,
  }
  await compute.visual(input)
  await compute.speech(input)
  const videoRows = []
  for (const [label, path] of [
    ['fixture', launch],
    ['synthetic-6x-fixture', longer],
  ]) {
    const probe = await compute.probe({ path: path as string })
    assert.ok(probe.durationMs)
    const video = {
      ...input,
      path: path as string,
      durationMs: probe.durationMs,
    }
    const visualTimes: number[] = []
    const speechTimes: number[] = []
    let scenes = 0
    let samples = 0
    let segments = 0
    for (let i = 0; i < 3; i++) {
      visualTimes.push(
        await time(async () => {
          const result = await compute.visual(video)
          scenes = result.scenes.length
          samples = result.samples.length
          assert.ok(
            result.scenes.every(
              (scene) => scene.endMs - scene.startMs <= 10_000,
            ),
          )
          assert.equal(result.scenes.at(-1)?.endMs, probe.durationMs)
        }),
      )
      speechTimes.push(
        await time(async () => {
          const result = await compute.speech(video)
          segments = result.segments.length
          assert.ok(segments > 0)
          assert.ok(
            result.segments.every(
              (segment) => segment.endMs <= (probe.durationMs as number),
            ),
          )
        }),
      )
      console.log(
        `${label} run ${i + 1}: visual ${round(visualTimes[i] as number)} ms; speech ${round(speechTimes[i] as number)} ms`,
      )
    }
    videoRows.push({
      workload: label,
      width: probe.width,
      height: probe.height,
      duration_ms: probe.durationMs,
      scenes,
      samples,
      segments,
      visual: stats(visualTimes, probe.durationMs),
      speech: stats(speechTimes, probe.durationMs),
      combined: stats(
        visualTimes.map((value, i) => value + (speechTimes[i] as number)),
        probe.durationMs,
      ),
    })
  }
  const pins = await readFile(join(root, 'research/default-model-pins.json'))
  const result = {
    date: new Date().toISOString(),
    commit: (
      await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })
    ).stdout.trim(),
    ffmpeg: (
      await promisify(execFile)(tools.ffmpeg, ['-version'])
    ).stdout.split('\n')[0],
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    platform: process.platform,
    release: release(),
    node: process.version,
    threads: THREADS,
    provider: 'cpu',
    priority: 'below normal',
    model_manifest_sha256: createHash('sha256').update(pins).digest('hex'),
    scope:
      'compute api end-to-end, warm models; image decode/preprocess/inference; video two decode passes/frame writes/inference; speech ffmpeg/ASR/sentence vectors; excludes db/hash/thumb',
    baseline:
      'real time = 60 wall seconds per media minute; no before/after optimization comparison',
    limitations:
      'shared laptop; 320x240 h264 repeated static images and public-domain english speech; no sustained 4k/hevc/hour-long/cross-platform claim',
    cold_image_visual_ms: round(coldImageMs),
    image: {
      workload: 'alternating cat.jpg and coffee.jpg; 2 warmups after cold load',
      ...stats(imageTimes),
    },
    videos: videoRows,
  }
  const output = join(root, 'tests/compute-bench-results.json')
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  console.log(
    JSON.stringify({ image: result.image, videos: result.videos }, null, 2),
  )
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
