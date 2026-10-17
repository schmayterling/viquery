import { Catalog } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/catalog/core.ts'
import { SearchEngine } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/search/engine.ts'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
const root=await mkdtemp('/tmp/red-codex/r2-refresh-')
await mkdir(root+'/parent/child',{recursive:true})
const path=root+'/parent/child/x.jpg'
await writeFile(path,'old')
const vector=n=>{ const v=new Float32Array(n);v[0]=1;return v }
const c=new Catalog(root+'/data',{
 async probe(){return {kind:'image',width:10,height:10,durationMs:null,hasAudio:false,takenAt:null,codec:'jpeg'}},
 async thumb(){return {sprite:null}},
 async visual(){return {generation:1,scenes:[],samples:[{scene:-1,tMs:null,embedding:vector(512)}]}},
 async speech(){return {generation:1,segments:[]}}
})
const parent=await c.addFolder(root+'/parent')
await c.settled()
await c.addFolder(root+'/parent/child')
await c.settled()
const engine=new SearchEngine(root+'/data/viquery.db',{clip:async()=>vector(512),sentence:async()=>vector(384)})
const changes=[]
c.on('change',change=>{changes.push(change);engine.refresh(change)})
await writeFile(path,'new-content')
await c.rescan(parent.id);await c.settled()
const all={scope:{kind:'all'},media:'all'}
const db=new DatabaseSync(root+'/data/viquery.db',{readOnly:true})
console.log(JSON.stringify({root,library:[...c.library(all).ids],files:db.prepare('select path,media_id,folder_id from file').all(),changes,result:await engine.search('unrelatedword',all)}))
db.close();await engine.close();await c.close()
