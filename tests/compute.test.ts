import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { createComputeApi } from '../src/compute/api.ts'
import { loadTextEncoders } from '../src/ml/text.ts'
import { dataPaths } from '../src/shared/paths.ts'
import { binaries, dot, fixture, modelsDir } from './compute-tools.ts'

test('compute indexes fixture metadata, previews, visual moments and speech offline', {
  skip:
    !existsSync(modelsDir) &&
    'run npm run models to provision the local model pack',
  timeout: 180_000,
}, async (t) => {
  const dataDir = await mkdtemp(join(modelsDir, '.compute-test-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const network = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('runtime network access forbidden')
  }
  t.after(() => {
    globalThis.fetch = network
  })
  const compute = createComputeApi({
    type: 'init',
    dataDir,
    modelsDir,
    ...binaries(),
  })
  const paths = dataPaths(dataDir)
  const cat = {
    mediaId: 1,
    path: join(fixture, 'cat.jpg'),
    kind: 'image' as const,
    durationMs: null,
  }
  const coffee = { ...cat, mediaId: 2, path: join(fixture, 'coffee.jpg') }
  const launch = {
    mediaId: 3,
    path: join(fixture, 'launch.mp4'),
    kind: 'video' as const,
    durationMs: 11_000,
  }

  for (const input of [cat, coffee, launch]) {
    const metadata = await compute.probe(input)
    assert.equal(metadata.kind, input.kind)
    assert.equal(metadata.hasAudio, input.kind === 'video')
    assert.ok(metadata.width > 0 && metadata.height > 0)
    assert.equal(metadata.durationMs, input.durationMs)
    const preview = await compute.thumb(input)
    const thumbnail = await sharp(paths.thumb(input.mediaId)).metadata()
    assert.ok(Math.max(thumbnail.width, thumbnail.height) <= 512)
    if (input.kind === 'video') {
      assert.deepEqual(preview.sprite, { columns: 10, rows: 5, frames: 50 })
      const sprite = await sharp(paths.sprite(input.mediaId)).metadata()
      assert.equal(sprite.width, 1600)
      assert.equal(sprite.height, 450)
    } else assert.equal(preview.sprite, null)
  }

  const oriented = { ...cat, mediaId: 4, path: join(dataDir, 'oriented.jpg') }
  await sharp(cat.path)
    .resize(80, 40, { fit: 'fill' })
    .withExif({
      IFD2: {
        DateTimeOriginal: '2020:01:02 03:04:05',
        OffsetTimeOriginal: '+08:00',
      },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toFile(oriented.path)
  const metadata = await compute.probe(oriented)
  assert.equal(metadata.width, 40)
  assert.equal(metadata.height, 80)
  assert.equal(metadata.takenAt, Date.parse('2020-01-02T03:04:05+08:00'))
  await compute.thumb(oriented)
  const rotated = await sharp(paths.thumb(oriented.mediaId)).metadata()
  assert.equal(rotated.width, 40)
  assert.equal(rotated.height, 80)

  const text = await loadTextEncoders(modelsDir)
  const catVisual = await compute.visual(cat)
  assert.deepEqual(catVisual.scenes, [])
  const catSample = catVisual.samples[0]
  assert.ok(catSample)
  assert.equal(catSample.tMs, null)
  assert.equal(catSample.scene, -1)
  assert.equal(catSample.embedding.length, 512)
  assert.ok(Math.abs(dot(catSample.embedding, catSample.embedding) - 1) < 1e-5)
  assert.ok(
    dot(catSample.embedding, await text.clip('a cat')) >
      dot(catSample.embedding, await text.clip('a cup of coffee')),
  )

  const video = await compute.visual(launch)
  assert.equal(video.scenes.length, 2)
  assert.ok(Math.abs((video.scenes[0]?.endMs ?? NaN) - 5500) < 100)
  assert.equal(video.scenes[1]?.endMs, 11_000)
  assert.equal(video.samples.length, 6)
  const rocket = await text.clip('a rocket launching')
  const scores = video.samples.map((sample) => ({
    ms: sample.tMs as number,
    score: dot(sample.embedding, rocket),
  }))
  assert.ok(
    Math.max(
      ...scores
        .filter((sample) => sample.ms < 5500)
        .map((sample) => sample.score),
    ) >
      Math.max(
        ...scores
          .filter((sample) => sample.ms > 5500)
          .map((sample) => sample.score),
      ),
  )
  for (const sample of video.samples) {
    assert.ok(sample.tMs !== null)
    const frame = await sharp(
      paths.frame(launch.mediaId, sample.tMs),
    ).metadata()
    assert.ok(Math.max(frame.width, frame.height) <= 320)
  }

  const speech = await compute.speech(launch)
  assert.match(
    speech.segments
      .map((segment) => segment.text)
      .join(' ')
      .toLowerCase(),
    /ask not what your country can do for you/,
  )
  for (const segment of speech.segments) {
    assert.ok(segment.startMs >= 0 && segment.endMs <= 11_000)
    assert.ok(segment.endMs > segment.startMs)
    assert.equal(segment.embedding.length, 384)
    assert.ok(Math.abs(dot(segment.embedding, segment.embedding) - 1) < 1e-5)
  }
})
