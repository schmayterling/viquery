import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { Catalog } from '../src/catalog/core.ts'
import { createComputeApi } from '../src/compute/api.ts'
import { loadTextEncoders } from '../src/ml/index.ts'
import { SearchEngine } from '../src/search/engine.ts'
import { dataPaths } from '../src/shared/paths.ts'
import { binaries, modelsDir } from './compute-tools.ts'

test('visible text fixture finds an image and the video scene containing its decoded OCR frame', {
  timeout: 120_000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viquery-ocr-'))
  const library = join(root, 'library')
  const dataDir = join(root, 'data')
  await mkdir(library)
  const tools = binaries()
  const phrase = 'ORBITAL ARCHIVE'
  const card = join(library, 'still.png')
  await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <rect width="100%" height="100%" fill="white"/>
    <text x="110" y="380" font-family="sans-serif" font-size="84" fill="black">${phrase}</text>
  </svg>`),
  )
    .png()
    .toFile(card)
  await promisify(execFile)(tools.ffmpeg, [
    '-v',
    'error',
    '-threads',
    '2',
    '-filter_complex_threads',
    '1',
    '-f',
    'lavfi',
    '-i',
    'color=c=navy:s=1280x720:r=2:d=8',
    '-loop',
    '1',
    '-framerate',
    '2',
    '-i',
    card,
    '-filter_complex',
    "[0:v][1:v]overlay=enable='gte(t,4)'",
    '-t',
    '8',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-threads',
    '2',
    '-g',
    '4',
    '-keyint_min',
    '4',
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p',
    join(library, 'clip.mp4'),
  ])
  const network = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('runtime network access forbidden')
  }
  const compute = createComputeApi({
    type: 'init',
    dataDir,
    modelsDir,
    ...tools,
  })
  const catalog = new Catalog(dataDir, compute)
  let search: SearchEngine | undefined
  t.after(async () => {
    globalThis.fetch = network
    await search?.close()
    await catalog.close()
    await rm(root, { recursive: true, force: true })
  })
  const engine = new SearchEngine(
    dataPaths(dataDir).db,
    await loadTextEncoders(modelsDir),
  )
  search = engine
  catalog.on('change', (change) => engine.refresh(change))
  const errors: Error[] = []
  catalog.on('warning', (error) => errors.push(error))
  await catalog.addFolder(library)
  await catalog.settled()
  assert.deepEqual(
    errors.map((error) => error.message),
    [],
  )
  const items = catalog.items([
    ...catalog.library({ scope: { kind: 'all' }, media: 'all' }).ids,
  ])
  const image = items.find((item) => item.kind === 'image')
  const video = items.find((item) => item.kind === 'video')
  assert.ok(image && video)
  const result = await search.search(phrase, {
    scope: { kind: 'all' },
    media: 'all',
  })
  assert.equal(result.images[0]?.mediaId, image.id)
  const moment = result.videos.find((hit) => hit.mediaId === video.id)
    ?.moments[0]
  assert.ok(moment)
  assert.ok(moment.sources.includes('text'))
  assert.match(moment.snippet ?? '', /ORBITAL ARCHIVE/i)
  assert.equal(
    moment.seekMs,
    4000,
    'seek to decoded keyframe, not the later visual sample',
  )
  const timeline = await search.searchVideo(video.id, phrase)
  const matches = timeline.filter((scene) => scene.sources.includes('text'))
  assert.ok(matches.length > 0)
  assert.ok(
    matches.every((scene) => scene.startMs >= 4000 && scene.seekMs >= 4000),
  )
})
