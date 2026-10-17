import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const { Catalog } = await import(`${wt}/src/catalog/core.ts`)
const { dataPaths } = await import(`${wt}/src/shared/paths.ts`)
const { GENERATION } = await import(`${wt}/src/shared/protocol.ts`)
const root = await mkdtemp(join(tmpdir(), 'rc-loop-'))
const data = join(root, 'data'); const paths = dataPaths(data)
const unit = (n: number) => { const v = new Float32Array(n); v[0] = 1; return v }
const compute: any = {
  probe: async () => ({ kind: 'image', width: 512, height: 512, durationMs: null, hasAudio: false, takenAt: null, codec: 'webp' }),
  // like the real compute: writes a fresh webp into <data>/thumbs/xx/<id>.webp
  thumb: async ({ mediaId }: { mediaId: number }) => { await mkdir(dirname(paths.thumb(mediaId)), { recursive: true }); await writeFile(paths.thumb(mediaId), randomBytes(2048)); return { sprite: null } },
  visual: async () => ({ generation: GENERATION.visual, scenes: [], samples: [{ scene: -1, tMs: null, embedding: unit(512) }] }),
  speech: async () => ({ generation: GENERATION.speech, segments: [] }),
}
const catalog = new Catalog(data, compute)
await mkdir(join(data, 'thumbs', '00'), { recursive: true })
await writeFile(join(data, 'thumbs', '00', 'seed.webp'), randomBytes(2048))
let error = null
try { await catalog.addFolder(join(data, 'thumbs')) } catch (e) { error = String(e) }
const counts = []
for (let round = 0; round < 5; round++) { await catalog.settled(); counts.push((catalog as any).db.prepare('select count(*) n from media').get().n); await catalog.rescan() }
console.log(JSON.stringify({ addFolderError: error, mediaCountPerWatcherRescan: counts }))
await catalog.close()
