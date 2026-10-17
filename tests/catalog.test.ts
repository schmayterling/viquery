import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { Catalog } from '../src/catalog/core.ts'
import type { Filter } from '../src/shared/api.ts'
import { dataPaths } from '../src/shared/paths.ts'
import {
  type CatalogChange,
  type ComputeApi,
  GENERATION,
} from '../src/shared/protocol.ts'

const all: Filter = { scope: { kind: 'all' }, media: 'all' }
const vector = (length: number) => {
  const v = new Float32Array(length)
  v[0] = 1
  return v
}

test('catalog fixture: content identity, aliases, phased jobs, retries, resume and generations', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viquery-catalog-'))
  const library = join(root, 'library')
  const dataDir = join(root, 'data')
  await cp(new URL('./fixtures/library', import.meta.url), library, {
    recursive: true,
  })
  await cp(join(library, 'cat.jpg'), join(library, 'cat-copy.jpg'))
  const calls: string[] = []
  const changes: CatalogChange[] = []
  let thumbs = 0
  let maxThumbs = 0
  let visualFailures = 2
  let speechFails = true
  let staleVisual = false
  const compute: ComputeApi = {
    async probe({ path }) {
      calls.push(`probe:${basename(path)}`)
      const video = path.endsWith('.mp4')
      return {
        kind: video ? 'video' : 'image',
        width: 320,
        height: 240,
        durationMs: video ? 11000 : null,
        hasAudio: video,
        takenAt: null,
        codec: video ? 'h264' : 'mjpeg',
      }
    },
    async thumb({ kind }) {
      calls.push('thumb')
      maxThumbs = Math.max(maxThumbs, ++thumbs)
      // hold long enough for the sibling job's stat + probe to land, so the cap is what limits overlap
      await setTimeout(20)
      thumbs--
      return {
        sprite: kind === 'video' ? { columns: 5, rows: 1, frames: 5 } : null,
      }
    },
    async visual({ kind, path }) {
      calls.push(`visual:${kind}`)
      if (path.includes('cat') && visualFailures-- > 0)
        throw new Error('transient visual failure')
      const generation = staleVisual ? 0 : GENERATION.visual
      staleVisual = false
      return kind === 'image'
        ? {
            generation,
            scenes: [],
            samples: [{ scene: -1, tMs: null, embedding: vector(512) }],
          }
        : {
            generation,
            scenes: [
              { startMs: 0, endMs: 5500 },
              { startMs: 5500, endMs: 11000 },
            ],
            samples: [
              { scene: 0, tMs: 2750, embedding: vector(512) },
              { scene: 1, tMs: 8250, embedding: vector(512) },
            ],
          }
    },
    async ocr() {
      return { generation: GENERATION.ocr, spans: [] }
    },
    async speech() {
      calls.push('speech')
      if (speechFails) throw new Error('speech model unavailable')
      return {
        generation: GENERATION.speech,
        segments: [
          {
            startMs: 1000,
            endMs: 4000,
            language: 'en',
            text: 'ask what you can do for your country',
            embedding: vector(384),
          },
        ],
      }
    },
  }
  let catalog: Catalog | undefined = new Catalog(dataDir, compute)
  t.after(async () => {
    await catalog?.close()
    await rm(root, { recursive: true, force: true })
  })
  catalog.on('change', (change) => changes.push(change))
  catalog.pauseIndexing(true)
  const folder = await catalog.addFolder(library)
  assert.equal(folder.count, 3)
  assert.equal(calls.length, 0)
  assert.equal(catalog.library(all).ids.length, 3)
  const dbPath = dataPaths(dataDir).db
  let db = new DatabaseSync(dbPath, { readOnly: true })
  t.after(() => {
    if (db.isOpen) db.close()
  })
  const count = (table: string) =>
    Number(db.prepare(`select count(*) as n from ${table}`).get()?.n)
  assert.equal(count('file'), 4)
  assert.equal(count('media'), 3)
  assert.equal(count('job'), 3)

  catalog.pauseIndexing(false)
  await catalog.settled()
  assert.equal(maxThumbs, 2)
  const firstVisual = calls.findIndex((call) => call.startsWith('visual:'))
  assert.equal(
    calls.slice(firstVisual).some((call) => call === 'thumb'),
    false,
  )
  assert.ok(calls.lastIndexOf('visual:image') < calls.indexOf('visual:video'))
  assert.ok(calls.lastIndexOf('visual:video') < calls.indexOf('speech'))
  assert.equal(calls.filter((call) => call === 'speech').length, 3)
  assert.equal(catalog.indexState().phase, 'idle')
  const state = catalog.indexState()
  assert.equal('failed' in state && state.failed, 1)
  assert.equal(count('sample'), 4)
  assert.equal(count('scene'), 2)
  assert.equal(count('transcript'), 0)
  const items = catalog.items([...catalog.library(all).ids])
  const video = items.find((item) => item.kind === 'video')
  assert.ok(video)
  const digest = db
    .prepare('select sha256 from media where id=?')
    .get(video.id)?.sha256
  assert.deepEqual(
    Buffer.from(digest as Uint8Array),
    createHash('sha256')
      .update(await readFile(join(library, 'launch.mp4')))
      .digest(),
  )
  assert.deepEqual(
    catalog.scenes(video.id).map((scene) => scene.frameMs),
    [2750, 8250],
  )
  assert.equal(
    db
      .prepare("select count(*) as n from file_fts where file_fts match 'cat'")
      .get()?.n,
    2,
  )

  speechFails = false
  await catalog.rescan()
  await catalog.settled()
  assert.equal(
    catalog.transcript(video.id)[0]?.text,
    'ask what you can do for your country',
  )
  assert.equal(
    db
      .prepare(
        "select count(*) as n from transcript_fts where transcript_fts match 'country'",
      )
      .get()?.n,
    1,
  )
  const snapshot = JSON.stringify(
    db.prepare('select * from sample order by id').all(),
  )
  const before = calls.length
  await catalog.rescan()
  await catalog.settled()
  assert.equal(calls.length, before)
  assert.equal(
    JSON.stringify(db.prepare('select * from sample order by id').all()),
    snapshot,
  )

  const cat = items.find((item) => item.name.startsWith('cat'))
  assert.ok(cat)
  await rename(join(library, 'cat.jpg'), join(library, 'renamed.jpg'))
  await unlink(join(library, 'cat-copy.jpg'))
  await catalog.rescan()
  await catalog.settled()
  assert.equal(catalog.items([cat.id])[0]?.name, 'renamed.jpg')
  assert.equal(calls.length, before)
  assert.equal(
    db
      .prepare("select count(*) as n from file_fts where file_fts match 'cat'")
      .get()?.n,
    0,
  )

  await rename(library, `${library}-offline`)
  await catalog.rescan()
  assert.equal(catalog.folders()[0]?.state, 'offline')
  assert.equal(catalog.library(all).ids.length, 3)
  await rename(`${library}-offline`, library)
  const aliases = join(root, 'aliases')
  await mkdir(aliases)
  await cp(join(library, 'coffee.jpg'), join(aliases, 'coffee-alias.jpg'))
  const second = await catalog.addFolder(aliases)
  await unlink(join(library, 'coffee.jpg'))
  await catalog.rescan()
  await catalog.settled()
  assert.equal(calls.length, before)
  assert.equal(
    catalog.library({
      scope: { kind: 'folder', folderId: second.id },
      media: 'all',
    }).ids.length,
    1,
  )
  assert.equal(
    catalog.library({ scope: { kind: 'recent' }, media: 'all' }).ids.length,
    3,
  )

  catalog.removeFolder(folder.id)
  await catalog.settled()
  assert.equal(catalog.library(all).ids.length, 1)
  assert.ok(changes.some((change) => change.removedMedia.includes(cat.id)))
  await catalog.addFolder(library)
  await catalog.settled()
  assert.equal(catalog.items([cat.id])[0]?.id, cat.id)
  assert.equal(calls.length, before)
  await catalog.close()
  catalog = undefined
  db.close()

  const writer = new DatabaseSync(dbPath)
  writer
    .prepare(
      "update job set state='done',generation=0 where media_id=? and stage='visual'",
    )
    .run(video.id)
  writer
    .prepare('update sample set generation=0 where media_id=?')
    .run(video.id)
  writer.prepare('update scene set generation=0 where media_id=?').run(video.id)
  writer
    .prepare(
      "update job set state='running' where media_id=? and stage='speech'",
    )
    .run(video.id)
  writer.close()
  staleVisual = true
  catalog = new Catalog(dataDir, compute)
  await catalog.rescan()
  await catalog.settled()
  db = new DatabaseSync(dbPath, { readOnly: true })
  assert.equal(count('sample'), 4)
  assert.equal(count('scene'), 2)
  assert.equal(count('transcript'), 1)
  assert.equal(
    db
      .prepare("select attempts from job where media_id=? and stage='visual'")
      .get(video.id)?.attempts,
    2,
  )
  assert.equal(
    db.prepare("select count(*) as n from job where state!='done'").get()?.n,
    0,
  )
  assert.equal(catalog.scenes(video.id).length, 2)
  assert.equal(
    db
      .prepare(
        "select count(*) as n from transcript_fts where transcript_fts match 'country'",
      )
      .get()?.n,
    1,
  )
})

test('catalog folder boundaries: sampled identity, nested folders, missing roots', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'viquery-boundary-'))
  const catalog = new Catalog(join(root, 'data'), {} as ComputeApi)
  t.after(async () => {
    await catalog.close()
    await rm(root, { recursive: true, force: true })
  })
  catalog.pauseIndexing(true)

  // same size and identical sampled windows, different bytes at 8 MiB
  const large = join(root, 'large')
  await mkdir(large)
  for (const [name, patch] of [
    ['a.bmp', false],
    ['b.bmp', true],
    ['c.bmp', false],
  ] as const) {
    const file = await open(join(large, name), 'w')
    await file.truncate(75 * 1024 * 1024)
    if (patch) await file.write(Buffer.alloc(1024, 255), 0, 1024, 8 << 20)
    await file.close()
  }
  await catalog.addFolder(large)
  // a and c are true duplicates; b must not merge into them
  assert.equal(catalog.library(all).ids.length, 2)
})
