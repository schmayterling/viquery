import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const { openDatabase } = await import(`${wt}/src/catalog/schema.ts`)
const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'rc-fts-')), 'v.db'))
db.exec("insert into folder values (1,'/a',0); insert into media(id,sha256,kind,width,height,has_audio,taken_at,added_at,bytes) values (1,x'01',0,1,1,0,0,0,1)")
db.exec("insert into file(id,path,folder_id,media_id,name,size,mtime_ms) values (7,'/a/cat.jpg',1,1,'cat.jpg',1,1)")
console.log('fk pragma', db.prepare('pragma foreign_keys').get())
db.exec('delete from folder where id=1')
console.log('file rows', db.prepare('select count(*) n from file').get(), 'fts hits for cat', db.prepare("select rowid from file_fts where file_fts match 'cat'").all())
db.exec("insert into folder values (2,'/b',0); insert into file(id,path,folder_id,media_id,name,size,mtime_ms) values (7,'/b/dog.jpg',2,1,'dog.jpg',1,1)")
console.log('after rowid reuse: cat ->', db.prepare("select f.name from file_fts join file f on f.id=file_fts.rowid where file_fts match 'cat'").all())
console.log('integrity', db.prepare("insert into file_fts(file_fts) values('integrity-check')").run())
