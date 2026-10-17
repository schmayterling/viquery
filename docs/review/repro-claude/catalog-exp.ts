// red-team scratch: catalog behaviors with a stub compute (no models)
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Catalog } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude/src/catalog/core.ts'
import { GENERATION, type ComputeApi } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude/src/shared/protocol.ts'

const all = { scope: { kind: 'all' as const }, media: 'all' as const }
const unit = (n: number) => { const v = new Float32Array(n); v[0] = 1; return v }
const calls: Record<string, number> = {}
const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1)
const compute: ComputeApi = {
  async probe({ path }) {
    bump(`probe:${path.split('/').at(-1)}`)
    if (path.includes('bad')) throw new Error('corrupt file')
    return { kind: 'image', width: 4, height: 3, durationMs: null, hasAudio: false, takenAt: null, codec: 'jpeg' }
  },
  async thumb() { return { sprite: null } },
  async visual() { return { generation: GENERATION.visual, scenes: [], samples: [{ scene: -1, tMs: null, embedding: unit(512) }] } },
  async speech() { return { generation: GENERATION.speech, segments: [] } },
}
const jpg = (dir: string, name: string, bytes = 1024) => writeFile(join(dir, name), randomBytes(bytes))

async function fresh(tag: string) {
  const root = await mkdtemp(join(tmpdir(), `rc-${tag}-`))
  const lib = join(root, 'lib')
  await mkdir(lib)
  const catalog = new Catalog(join(root, 'data'), compute)
  const changes: number[] = []
  catalog.on('change', (c) => changes.push(c.changedMedia.length + c.removedMedia.length))
  return { root, lib, catalog, changes }
}
const rows = (c: Catalog, sql: string) => (c as any).db.prepare(sql).all()

// C1 nested folders
{
  const { root, lib, catalog, changes } = await fresh('nested')
  const sub = join(lib, 'sub')
  await mkdir(sub)
  for (let i = 0; i < 5; i++) await jpg(sub, `s${i}.jpg`)
  await jpg(lib, 'top.jpg')
  await catalog.addFolder(lib)
  await catalog.addFolder(sub)
  await catalog.settled()
  const before = rows(catalog, 'select f.name, f.folder_id from file f order by name')
  const counts: string[] = []
  for (let round = 0; round < 3; round++) {
    changes.length = 0
    const t = performance.now()
    await catalog.rescan()
    await catalog.settled()
    counts.push(`round${round}: change-event media=${changes.reduce((a, b) => a + b, 0)} folders=${JSON.stringify(catalog.folders().map((f) => [f.name, f.count]))} ${Math.round(performance.now() - t)}ms`)
  }
  const subId = catalog.folders().find((f) => f.name === 'sub')!.id
  catalog.removeFolder(subId)
  const afterRemove = catalog.library(all).ids.length
  console.log('C1 nested', JSON.stringify({ before }), '\n ', counts.join('\n  '), '\n  library after removing sub (lib still added):', afterRemove, 'of 6 files under lib')
  await catalog.close(); await rm(root, { recursive: true, force: true })
}

// C2 unreadable subdirectory
{
  const { root, lib, catalog } = await fresh('eacces')
  await jpg(lib, 'a.jpg'); await jpg(lib, 'b.jpg')
  const locked = join(lib, 'lost+found')
  await mkdir(locked); await jpg(locked, 'x.jpg'); await chmod(locked, 0o000)
  for (const d of ['m1', 'm2', 'z1']) { await mkdir(join(lib, d)); await jpg(join(lib, d), `${d}.jpg`) }
  const probesBefore = Object.keys(calls).filter((k) => k.startsWith('probe:')).length
  await catalog.addFolder(lib)
  await catalog.settled()
  const st = catalog.folders()[0]
  const jobs = rows(catalog, "select state, count(*) n from job group by state")
  console.log('C2 eacces subdir:', JSON.stringify({ state: st.state, count: st.count, libraryItems: catalog.library(all).ids.length, readableFiles: 5, jobs, indexState: catalog.indexState(), probeCallsThisCase: Object.keys(calls).filter((k) => k.startsWith('probe:')).length - probesBefore }))
  await chmod(locked, 0o755)
  await catalog.close(); await rm(root, { recursive: true, force: true })
}

// C3 failed jobs reset by every rescan (main calls rescan on every window focus)
{
  const { root, lib, catalog } = await fresh('failed')
  await jpg(lib, 'bad.jpg'); await jpg(lib, 'good.jpg')
  await catalog.addFolder(lib)
  await catalog.settled()
  const s1 = { probes: calls['probe:bad.jpg'], job: rows(catalog, "select stage,state,attempts,error from job where state!='done'"), idle: catalog.indexState() }
  await catalog.rescan(); await catalog.settled()
  await catalog.rescan(); await catalog.settled()
  console.log('C3 failed reset:', JSON.stringify({ afterFirst: s1, probesAfterTwoFocusRescans: calls['probe:bad.jpg'] }))
  await catalog.close(); await rm(root, { recursive: true, force: true })
}

// C4 rescan calls are queued, not coalesced: N focus events -> N full walks
{
  const { root, lib, catalog } = await fresh('queue')
  for (let d = 0; d < 20; d++) { const dir = join(lib, `d${d}`); await mkdir(dir); for (let i = 0; i < 500; i++) await jpg(dir, `${i}.jpg`, 16) }
  await catalog.addFolder(lib); await catalog.settled()
  let scans = 0
  catalog.on('index', (s) => { if (s.phase === 'scanning') scans++ })
  let t = performance.now(); await catalog.rescan(); await catalog.settled()
  const one = performance.now() - t
  t = performance.now()
  await Promise.all(Array.from({ length: 10 }, () => catalog.rescan())); await catalog.settled()
  console.log('C4 queue: 10k files; one stat-gated rescan', Math.round(one), 'ms; 10 rapid rescans', Math.round(performance.now() - t), 'ms')
  await catalog.close(); await rm(root, { recursive: true, force: true })
}

// C5 addFolder resolves only after the whole scan + hashing
{
  const { root, lib, catalog } = await fresh('add')
  for (let i = 0; i < 40; i++) await jpg(lib, `big${i}.jpg`, 32 * 1024 * 1024)
  catalog.pauseIndexing(true)
  const t = performance.now()
  let firstLibraryChanged = 0
  catalog.on('libraryChanged', () => { firstLibraryChanged ||= performance.now() - t })
  await catalog.addFolder(lib)
  console.log('C5 addFolder: 40 x 32MiB; folder row visible after', Math.round(firstLibraryChanged), 'ms; addFolder() resolved after', Math.round(performance.now() - t), 'ms')
  await catalog.close(); await rm(root, { recursive: true, force: true })
}

// C6 folder root present but empty (unmounted fstab mount point) -> aliases dropped, then full re-hash
{
  const { root, lib, catalog, changes } = await fresh('mount')
  for (let i = 0; i < 20; i++) await jpg(lib, `${i}.jpg`, 4 * 1024 * 1024)
  await catalog.addFolder(lib); await catalog.settled()
  const aside = join(root, 'aside'); await rename(lib, aside); await mkdir(lib)
  await catalog.rescan(); await catalog.settled()
  const whileUnmounted = { library: catalog.library(all).ids.length, folder: catalog.folders()[0] }
  await rm(lib, { recursive: true }); await rename(aside, lib)
  changes.length = 0
  const t = performance.now()
  await catalog.rescan(); await catalog.settled()
  console.log('C6 empty mount point:', JSON.stringify(whileUnmounted), '; remount rescan re-hashed media:', changes.reduce((a, b) => a + b, 0), 'in', Math.round(performance.now() - t), 'ms')
  await catalog.close(); await rm(root, { recursive: true, force: true })
}
