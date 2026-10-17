import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const { openDatabase } = await import(`${wt}/src/catalog/schema.ts`)
const db: DatabaseSync = openDatabase(join(mkdtempSync(join(tmpdir(), 'rc-sql-')), 'v.db'))
db.exec('begin'); db.prepare("insert into folder values (1,'/x',0)").run()
const m = db.prepare('insert into media(id,sha256,kind,width,height,duration_ms,has_audio,taken_at,added_at,bytes) values (?,?,?,4000,3000,?,0,?,?,1)')
const f = db.prepare('insert into file(path,folder_id,media_id,name,size,mtime_ms) values (?,1,?,?,1,1)')
const j = db.prepare("insert into job values (?,?,1,?,0,null)")
for (let i = 1; i <= 100000; i++) { m.run(i, randomBytes(32), i % 5 ? 0 : 1, i % 5 ? null : 1000, Date.now() - i * 1000, Date.now()); f.run(`/x/${i}.jpg`, i, `${i}.jpg`); j.run(i, 'thumb', 'done'); j.run(i, 'visual', i % 2 ? 'done' : 'pending') }
db.exec('commit')
const time = (label: string, fn: () => unknown) => { const xs: number[] = []; for (let r = 0; r < 5; r++) { const s = performance.now(); fn(); xs.push(performance.now() - s) } xs.sort((a, b) => a - b); console.log(label, xs[2].toFixed(0), 'ms median of 5') }
const shipped = db.prepare(`select m.*,exists(select 1 from job j where j.media_id=m.id and j.stage='thumb' and j.state='done') as ready
      from media m where exists(select 1 from file f where f.media_id=m.id) order by m.taken_at desc,m.id desc`)
time('shipped library sql .all() (objects, m.* incl sha256 blob):', () => shipped.all())
const lean = db.prepare(`select m.id, m.kind, m.width, m.height, m.taken_at, m.duration_ms, exists(select 1 from job j where j.media_id=m.id and j.stage='thumb' and j.state='done') as ready
      from media m where exists(select 1 from file f where f.media_id=m.id) order by m.taken_at desc,m.id desc`)
time('same rows, needed columns only (.all objects):', () => lean.all())
time('same rows, needed columns, .iterate() into typed arrays:', () => { const ids = new Uint32Array(100000); let i = 0; for (const r of lean.iterate()) ids[i++] = r.id as number })
console.log((db.prepare('explain query plan ' + shipped.sourceSQL).all() as any[]).map((r) => r.detail).join(' | '))
