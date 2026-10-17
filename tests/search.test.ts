// biome-ignore-all lint/style/noNonNullAssertion: fixture ids and schema block are fixed by this test.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import type { MessagePortMain } from 'electron'
import { openDatabase } from '../src/catalog/schema.ts'
import { startSearchUtility } from '../src/search/index.ts'
import type { Filter, SceneMatch, SearchResult } from '../src/shared/api.ts'
import { dataPaths } from '../src/shared/paths.ts'
import { GENERATION, type TextEncoders } from '../src/shared/protocol.ts'
import { connect, emit, type Port } from '../src/shared/rpc.ts'

const all: Filter = { scope: { kind: 'all' }, media: 'all' }
const vector = (first: number, dimensions: number) => {
  const v = new Float32Array(dimensions)
  v[0] = first
  v[1] = Math.sqrt(1 - first * first)
  return v
}
const bytes = (v: Float32Array) =>
  new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
const rpcPort = (port: MessagePort): Port => ({
  post: (data) => port.postMessage(data),
  listen: (handler) => {
    port.on('message', handler)
  },
})
const utilityPort = (port: MessagePort): MessagePortMain =>
  ({
    postMessage: (data: unknown) => port.postMessage(data),
    on: (_event: string, handler: (e: { data: unknown }) => void) =>
      port.on('message', (data) => handler({ data })),
    start: () => port.start(),
    close: () => port.close(),
  }) as unknown as MessagePortMain

function fixture(db: DatabaseSync) {
  db.exec("insert into folder values(1, '/first', 0), (2, '/second', 0)")
  const media =
    db.prepare(`insert into media(id, sha256, kind, width, height, duration_ms, has_audio, taken_at, added_at, bytes)
    values(?, ?, ?, 100, 100, ?, ?, ?, ?, 1)`)
  const file = db.prepare(
    'insert into file(path, folder_id, media_id, name, size, mtime_ms) values(?, ?, ?, ?, 1, 0)',
  )
  const sample = db.prepare(
    'insert into sample(media_id, scene_id, generation, t_ms, embedding) values(?, ?, ?, ?, ?)',
  )
  const add = (
    id: number,
    name: string | null,
    folderId: number,
    takenAt: number,
    old = false,
    video = false,
  ) => {
    const hash = Buffer.alloc(32)
    hash.writeUInt32LE(id)
    media.run(
      id,
      hash,
      video ? 1 : 0,
      video ? 15_000 : null,
      video ? 1 : 0,
      takenAt,
      Date.now() - (old ? 60 * 86_400_000 : 0),
    )
    if (name) file.run(`/${folderId}/${id}/${name}`, folderId, id, name)
  }
  add(1, 'birch.jpg', 1, 10)
  for (let i = 0; i < 25; i++)
    sample.run(1, null, GENERATION.visual, null, bytes(vector(1, 512)))
  add(2, 'needle.jpg', 1, 20)
  file.run('/second/needle.jpg', 2, 2, 'needle.jpg')
  sample.run(2, null, GENERATION.visual, null, bytes(vector(0.9995, 512)))
  add(3, 'needle.jpg', 2, 30, true)
  add(4, 'walk.mp4', 1, 40, false, true)
  add(5, 'lecture.mp4', 2, 50, false, true)
  add(7, 'stale.jpg', 1, 70)
  sample.run(7, null, GENERATION.visual - 1, null, bytes(vector(1, 512)))
  add(8, null, 1, 80)
  sample.run(8, null, GENERATION.visual, null, bytes(vector(1, 512)))
  const scene = db.prepare('insert into scene values(?, ?, ?, ?, ?)')
  for (const [id, start, end, score, ms] of [
    [401, 0, 1000, 0.999, 500],
    [402, 2500, 3500, 0.998, 2800],
    [403, 5500, 6500, 0.997, 6000],
  ]) {
    scene.run(id!, 4, GENERATION.visual, start!, end!)
    sample.run(4, id!, GENERATION.visual, ms!, bytes(vector(score!, 512)))
  }
  scene.run(501, 5, GENERATION.visual, 0, 1000)
  const transcript = db.prepare(
    "insert into transcript(media_id, generation, start_ms, end_ms, language, text, embedding) values(?, ?, ?, ?, 'en', ?, ?)",
  )
  transcript.run(
    4,
    GENERATION.speech,
    800,
    2700,
    'needle in haystack',
    bytes(vector(1, 384)),
  )
  transcript.run(
    5,
    GENERATION.speech,
    400,
    800,
    'spoken words',
    bytes(vector(0.8, 384)),
  )
  for (let id = 10; id < 214; id++) {
    add(id, `filler${id}.jpg`, 2, 15, true)
    sample.run(id, null, GENERATION.visual, null, bytes(vector(-1, 512)))
  }
  db.exec(`insert into job(media_id, stage, generation, state) values
    (2, 'visual', ${GENERATION.visual}, 'pending'), (4, 'speech', ${GENERATION.speech}, 'running'), (5, 'speech', ${GENERATION.speech}, 'failed')`)
  return { sample, file }
}

test('video rpc returns ordered heat, gated markers and speech-only scenes using cached query vectors', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'viquery-video-search-'))
  const db = openDatabase(dataPaths(root).db)
  fixture(db)
  db.exec('delete from transcript where media_id = 4')
  const update = db.prepare(
    'update sample set embedding = ? where scene_id = ?',
  )
  for (const [id, score] of [
    [401, 0.31],
    [402, 0.338],
    [403, 0.3], // inside the global band, outside the timeline band
  ])
    update.run(bytes(vector(score!, 512)), id!)
  // The later inserted sample is the winner, not the first sample or scene midpoint.
  db.prepare(
    'insert into sample(media_id, scene_id, generation, t_ms, embedding) values(4, 401, ?, 700, ?)',
  ).run(GENERATION.visual, bytes(vector(0.34, 512)))
  db.prepare(
    'insert into scene values(405, 4, ?, 9000, 10000), (404, 4, ?, 7000, 9000), (406, 4, ?, 10000, 11000)',
  ).run(GENERATION.visual, GENERATION.visual, GENERATION.visual - 1)
  db.prepare(
    "insert into transcript(media_id, generation, start_ms, end_ms, language, text, embedding) values(4, ?, 7200, 9500, 'en', 'ask what you can do for your country', ?)",
  ).run(GENERATION.speech, bytes(vector(0.8, 384)))
  let encoded = 0
  const parent = new EventEmitter()
  const utility = startSearchUtility(parent, async () => ({
    clip: async (q) => {
      encoded++
      return vector(q === 'rocket' ? 1 : -1, 512)
    },
    sentence: async (q) => vector(q === 'rocket' ? -1 : 1, 384),
  }))
  const channel = new MessageChannel()
  t.after(async () => {
    await utility.close()
    channel.port1.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
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
    ports: [utilityPort(channel.port2)],
  })
  const client = connect(rpcPort(channel.port1))
  const global = await client.call<SearchResult>('search', {
    query: 'rocket',
    filter: { ...all, media: 'video' },
  })
  const video = (query: string, id = 4) =>
    client.call<SceneMatch[]>('searchVideo', { id, query })
  const heat = await video('rocket')
  assert.equal(encoded, 1, 'global and in-video search share cached encodings')
  assert.deepEqual(
    heat.map((s) => s.sceneId),
    [401, 402, 403, 404, 405],
  )
  assert.ok(heat[0]!.score > heat[1]!.score && heat[1]!.score > heat[2]!.score)
  assert.ok(heat.every((s) => s.score >= 0 && s.score <= 1))
  assert.deepEqual(
    heat.map((s) => s.match),
    [true, true, false, false, false],
  )
  assert.equal(heat[0]!.seekMs, 700)
  assert.deepEqual(
    global.videos
      .find((v) => v.mediaId === 4)!
      .moments.map((m) => [m.startMs, m.endMs]),
    [[0, 3500]],
    'global moment spans only scenes the timeline marks',
  )
  const spoken = await video('ask what you can do for your country')
  assert.deepEqual(
    spoken.map((s) => s.match),
    [false, false, false, true, true],
  )
  assert.deepEqual(spoken[3], {
    sceneId: 404,
    startMs: 7000,
    endMs: 9000,
    seekMs: 7000,
    frameMs: 6000, // no frame at the speech scene start: nearest saved sample
    score: 1,
    match: true,
    sources: ['speech', 'text'],
    snippet: 'ask what you can do for your country',
  })
  assert.equal(spoken[4]!.seekMs, 9000, 'overlapping speech maps to each scene')
  assert.deepEqual(await video('rocket', 99999), [])
})

test('search utility fuses branches, merges moments, filters, and refreshes rewritten/removed media over rpc', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'viquery-search-'))
  const db = openDatabase(dataPaths(root).db)
  const { sample, file } = fixture(db)
  let encodedQueries = 0
  const encoders: TextEncoders = {
    clip: async () => {
      encodedQueries++
      return vector(1, 512)
    },
    sentence: async () => vector(1, 384),
  }
  const parent = new EventEmitter()
  const utility = startSearchUtility(parent, async () => encoders)
  const renderer = new MessageChannel()
  const catalog = new MessageChannel()
  const otherPorts: MessagePort[] = []
  t.after(async () => {
    await utility.close()
    renderer.port1.close()
    catalog.port1.close()
    for (const port of otherPorts) port.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
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
    ports: [utilityPort(renderer.port2)],
  })
  parent.emit('message', {
    data: { type: 'port', peer: 'catalog' },
    ports: [utilityPort(catalog.port2)],
  })
  let client = connect(rpcPort(renderer.port1))
  const search = (filter = all, query = 'needle') =>
    client.call<SearchResult>('search', { query, filter })
  let result = await search()
  assert.equal(
    result.images[0]!.mediaId,
    2,
    'visual + lexical beats a higher visual score and filename-only match; duplicate samples cast one vote',
  )
  assert.ok(result.images.some((h) => h.mediaId === 1))
  assert.ok(result.images.some((h) => h.mediaId === 3))
  assert.ok(
    !result.images.some((h) => h.mediaId === 7 || h.mediaId === 8),
    'stale generations and media without aliases stay out',
  )
  assert.deepEqual(result.pending, { images: 1, videos: 2 })
  assert.ok(result.tookMs >= 0)
  const walk = result.videos.find((v) => v.mediaId === 4)!
  assert.equal(
    walk.moments.length,
    2,
    'gap < 2s merges; exact 2s gap stays separate',
  )
  assert.deepEqual(walk.moments[0], {
    sceneId: 401,
    startMs: 0,
    endMs: 3500,
    seekMs: 800,
    frameMs: 500,
    sources: ['visual', 'text', 'speech'],
    snippet: 'needle in haystack',
  })
  const lecture = result.videos.find((v) => v.mediaId === 5)!.moments[0]!
  assert.equal(lecture.seekMs, 400, 'speech-only hit seeks segment start')
  assert.equal(lecture.snippet, 'spoken words')
  assert.deepEqual(lecture.sources, ['speech'])
  result = await search({
    scope: { kind: 'folder', folderId: 2 },
    media: 'image',
    takenFrom: 20,
    takenTo: 30,
  })
  assert.deepEqual(
    result.images,
    [{ mediaId: 2 }],
    'folder aliases + inclusive/exclusive dates apply before candidates are capped',
  )
  assert.deepEqual(result.videos, [])
  result = await search({ scope: { kind: 'recent' }, media: 'image' })
  assert.deepEqual(
    result.images.map((h) => h.mediaId),
    [2, 1],
    'recent uses indexed time, not old capture time',
  )
  const similar = await client.call<SearchResult>('similar', {
    id: 1,
    filter: { ...all, media: 'image' },
  })
  assert.equal(similar.images[0]!.mediaId, 2)
  assert.ok(
    !similar.images.some((h) => h.mediaId === 1),
    'similarity excludes source media',
  )
  await search(all, 'needle" OR (name:*) NOT x')
  assert.equal(encodedQueries, 2, 'filter changes reuse the query vectors')

  // A renderer reload gets a fresh port without reloading vectors/models.
  const replacement = new MessageChannel()
  otherPorts.push(replacement.port1)
  parent.emit('message', {
    data: { type: 'port', peer: 'renderer' },
    ports: [utilityPort(replacement.port2)],
  })
  client = connect(rpcPort(replacement.port1))

  const changed = async (
    changedMedia: number[],
    removedMedia: number[],
    predicate: (result: SearchResult) => boolean,
  ) => {
    emit(rpcPort(catalog.port1), 'change', { changedMedia, removedMedia })
    const deadline = performance.now() + 2000
    let next: SearchResult
    do {
      next = await search()
      if (predicate(next)) return next
      await new Promise<void>((resolve) => setImmediate(resolve))
    } while (performance.now() < deadline)
    assert.fail('catalog change did not reach search')
  }
  db.exec('delete from file where media_id = 2') // keep orphan media + vectors for identity restoration
  await changed([], [2], (r) => !r.images.some((h) => h.mediaId === 2))
  file.run('/returned/needle.jpg', 2, 2, 'needle.jpg')
  await changed([2], [], (r) => r.images[0]?.mediaId === 2)
  // Replace the highest rowid in place: refresh by media id must not rely on an id watermark.
  db.exec('delete from sample where media_id = 213')
  sample.run(213, null, GENERATION.visual, null, bytes(vector(1, 512)))
  result = await changed([213], [], (r) =>
    r.images.some((h) => h.mediaId === 213),
  )
  assert.ok(result.images.some((h) => h.mediaId === 213))
  db.exec("update job set state = 'done' where media_id = 2")
  await changed([], [], (r) => r.pending.images === 0)
})
