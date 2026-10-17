// red-team scratch: 100k-item catalog + search costs on a synthetic db (stub compute, fake encoders)
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const { Catalog } = await import(`${wt}/src/catalog/core.ts`)
const { SearchEngine } = await import(`${wt}/src/search/engine.ts`)
const { dataPaths } = await import(`${wt}/src/shared/paths.ts`)
const N = Number(process.argv[2] ?? 100_000)
const root = await mkdtemp(join(tmpdir(), 'rc-perf-'))
const stub: any = { probe: async () => { throw new Error('x') }, thumb: async () => ({ sprite: null }), visual: async () => { throw new Error('x') }, speech: async () => { throw new Error('x') } }
const catalog = new Catalog(join(root, 'data'), stub)
catalog.pauseIndexing(true)
const db = (catalog as any).db
db.exec('begin')
db.prepare("insert into folder(id,path,added_at) values (1,'/nowhere',0)").run()
const media = db.prepare('insert into media(id,sha256,kind,width,height,duration_ms,has_audio,taken_at,added_at,bytes) values (?,?,?,?,?,?,?,?,?,?)')
const file = db.prepare('insert into file(path,folder_id,media_id,name,size,mtime_ms) values (?,1,?,?,?,?)')
const job = db.prepare("insert into job(media_id,stage,generation,state) values (?,?,1,?)")
const now = Date.now()
for (let i = 1; i <= N; i++) {
  const video = i % 5 === 0
  media.run(i, randomBytes(32), video ? 1 : 0, 4000, 3000, video ? 60000 : null, video ? 1 : 0, now - Math.floor(Math.random() * 10 * 365 * 86400000), now, 1000)
  file.run(`/nowhere/${i}.${video ? 'mp4' : 'jpg'}`, i, `IMG_${i}.${video ? 'MP4' : 'JPG'}`, 1000, 1)
  job.run(i, 'thumb', 'done')
  job.run(i, 'visual', i % 2 ? 'done' : 'pending')
  if (video) job.run(i, 'speech', 'pending')
}
db.exec('commit')
const time = (label: string, fn: () => unknown, runs = 7) => {
  const t: number[] = []
  for (let r = 0; r < runs; r++) { const s = performance.now(); fn(); t.push(performance.now() - s) }
  t.sort((a, b) => a - b)
  console.log(`${label}: median ${t[runs >> 1].toFixed(1)}ms min ${t[0].toFixed(1)} max ${t.at(-1)!.toFixed(1)} (n=${runs})`)
}
const all = { scope: { kind: 'all' }, media: 'all' }
time(`catalog.library(all) N=${N}`, () => catalog.library(all))
time('catalog.library(recent)', () => catalog.library({ scope: { kind: 'recent' }, media: 'all' }))
time('catalog.indexState() [runs every 100ms while indexing]', () => catalog.indexState())
time('catalog.folders()', () => catalog.folders())
const ids = Array.from({ length: 200 }, (_, i) => i * 37 + 1)
time('catalog.items(200 ids)', () => catalog.items(ids))
const unit = (n: number) => { const v = new Float32Array(n); v[0] = 1; return v }
const engine = new SearchEngine(dataPaths(join(root, 'data')).db, { clip: async () => unit(512), sentence: async () => unit(384) })
time('search.refresh(1 changed media) [runs per catalog change batch, <=10/s]', () => engine.refresh({ changedMedia: [1], removedMedia: [] }))
const t = performance.now(); await engine.search('dog', all as any); console.log('search(\"dog\") with 0 vectors', (performance.now() - t).toFixed(1), 'ms')
// renderer layout cost on the same columns
const { justify, monthGroups } = await import(`${wt}/src/renderer/src/layout.ts`)
const lib = catalog.library(all)
time('renderer monthGroups(100k)', () => monthGroups(lib), 5)
const groups = monthGroups(lib)
time(`renderer justify(100k, ${groups.length} groups, 1100px)`, () => justify(lib.aspect, groups, 1100, 196, false), 5)
await engine.close(); await catalog.close(); await rm(root, { recursive: true, force: true })
