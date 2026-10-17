// red-team scratch: real text encoders + smoke db (built by core-smoke) through the real SearchEngine
import { SearchEngine } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude/src/search/engine.ts'
import { loadTextEncoders } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude/src/ml/index.ts'
import { DatabaseSync } from 'node:sqlite'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const dbPath = process.argv[2] ?? `${wt}/out/core-smoke-profile/library/viquery.db`
const encoders = await loadTextEncoders(`${wt}/models`)
const engine = new SearchEngine(dbPath, encoders)
const db = new DatabaseSync(dbPath, { readOnly: true })
const names = new Map((db.prepare('select media_id, name from file').all() as any[]).map((r) => [r.media_id, r.name]))
const all = { scope: { kind: 'all' as const }, media: 'all' as const }
const queries = process.argv.slice(3).length ? process.argv.slice(3) : [
  'a rocket launching', 'an astronaut', 'a cat', 'a dog and a cat', 'what is this', 'pictures of my kids',
  'can you see the sunset', 'purple giraffe', 'ask what you can do for your country', 'country', 'so',
]
for (const q of queries) {
  const r = await engine.search(q, all)
  console.log(JSON.stringify({
    q,
    images: r.images.map((h) => names.get(h.mediaId)),
    videos: r.videos.map((v) => ({ v: names.get(v.mediaId), moments: v.moments.map((m) => `${m.startMs}-${m.endMs} seek=${m.seekMs} scene=${m.sceneId} [${m.sources}]${m.snippet ? ' "' + m.snippet.slice(0, 30) + '…"' : ''}`) })),
    pending: r.pending,
  }))
}
for (const q of ['a rocket launching', 'a dog and a cat', 'what is this']) {
  const id = [...names].find(([, n]) => n === 'launch.mp4')![0]
  const scenes = await engine.searchVideo(id, q)
  console.log('searchVideo', q, JSON.stringify(scenes.map((s) => ({ s: `${s.startMs}-${s.endMs}`, seek: s.seekMs, src: s.sources, match: s.match, score: +s.score.toFixed(3) }))))
}
await engine.close()
