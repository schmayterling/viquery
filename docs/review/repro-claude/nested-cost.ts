import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const { Catalog } = await import(`${wt}/src/catalog/core.ts`)
const { GENERATION } = await import(`${wt}/src/shared/protocol.ts`)
const compute: any = { probe: async () => ({ kind: 'image', width: 4, height: 3, durationMs: null, hasAudio: false, takenAt: null, codec: 'jpeg' }), thumb: async () => ({ sprite: null }), visual: async () => ({ generation: GENERATION.visual, scenes: [], samples: [{ scene: -1, tMs: null, embedding: Float32Array.from({ length: 512 }, (_, i) => (i ? 0 : 1)) }] }), speech: async () => ({ generation: GENERATION.speech, segments: [] }) }
for (const nested of [false, true]) {
  const root = await mkdtemp(join(tmpdir(), 'rc-nest-'))
  const lib = join(root, 'Pictures'), sub = join(lib, '2024')
  await mkdir(sub, { recursive: true })
  for (let i = 0; i < 20; i++) await writeFile(join(sub, `IMG_${i}.jpg`), randomBytes(32 * 1024 * 1024))
  const catalog = new Catalog(join(root, 'data'), compute)
  await catalog.addFolder(lib)
  if (nested) await catalog.addFolder(sub)
  await catalog.settled()
  const xs: number[] = []
  for (let r = 0; r < 3; r++) { const t = performance.now(); await catalog.rescan(); await catalog.settled(); xs.push(Math.round(performance.now() - t)) }
  console.log(JSON.stringify({ nested, files: '20 x 32MiB under Pictures/2024', rescanMs: xs }))
  await catalog.close(); await rm(root, { recursive: true, force: true })
}
