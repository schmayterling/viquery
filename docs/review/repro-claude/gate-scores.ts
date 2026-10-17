// per-media best clip cosine for queries over the smoke db, to characterize the .20 floor / .08 band
import { DatabaseSync } from 'node:sqlite'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const { loadClipTextEncoder } = await import(`${wt}/src/ml/index.ts`)
const clip = await loadClipTextEncoder(`${wt}/models`)
const db = new DatabaseSync(`${wt}/out/core-smoke-profile/library/viquery.db`, { readOnly: true })
const rows = db.prepare('select s.media_id, s.scene_id, s.t_ms, s.embedding, f.name from sample s join file f on f.media_id = s.media_id').all() as any[]
for (const q of ['a rocket launching', 'purple giraffe', 'a cat', 'a cup of coffee', 'an astronaut']) {
  const v = await clip(q)
  const best = new Map<string, number>()
  const scenes = new Map<string, number>()
  for (const r of rows) {
    const e = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, 512)
    let s = 0; for (let i = 0; i < 512; i++) s += e[i] * v[i]
    best.set(r.name, Math.max(best.get(r.name) ?? -1, s))
    if (r.name === 'launch.mp4') scenes.set(`scene${r.scene_id}`, Math.max(scenes.get(`scene${r.scene_id}`) ?? -1, s))
  }
  const top = Math.max(...best.values())
  const cutoff = Math.max(0.2, top - 0.08)
  console.log(JSON.stringify({ q, top: +top.toFixed(3), globalCutoff: +cutoff.toFixed(3), perMediaBest: Object.fromEntries([...best].sort((a, b) => b[1] - a[1]).map(([k, s]) => [k, +s.toFixed(3)])), launchScenes: Object.fromEntries([...scenes].map(([k, s]) => [k, +s.toFixed(3)])) }))
}
