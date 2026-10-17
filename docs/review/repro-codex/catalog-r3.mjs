import { mkdtemp, mkdir, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Catalog } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/catalog/core.ts'
const root = await mkdtemp('/tmp/red-codex/retries-')
const a = join(root, 'a'), b = join(root, 'b'), data = join(root, 'data')
await mkdir(a); await mkdir(b)
await cp('/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/tests/fixtures/library/cat.jpg',join(a,'broken.jpg'))
await cp('/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/tests/fixtures/library/coffee.jpg',join(b,'healthy.jpg'))
let calls=0
const v = new Float32Array(512); v[0]=1
const compute = {
 async probe() {return {kind:'image',width:20,height:20,durationMs:null,hasAudio:false,takenAt:null,codec:'jpeg'}},
 async thumb(){return {sprite:null}},
 async visual({path}) {if(path.includes('broken')) {calls++;throw new Error('permanent decoder failure')}return {generation:1,scenes:[],samples:[{scene:-1,tMs:null,embedding:v}]}},
 async speech(){throw new Error('unused')}
}
const c=new Catalog(data,compute)
c.on('warning',()=>{})
const fa=await c.addFolder(a);await c.settled()
const db=new DatabaseSync(join(data,'viquery.db'),{readOnly:true})
const status=()=>db.prepare("select j.*,f.folder_id from job j join file f on f.media_id=j.media_id where j.stage='visual'").all()
console.log(JSON.stringify({step:'broken folder settled',calls,jobs:status()}))
const fb=await c.addFolder(b);await c.settled()
console.log(JSON.stringify({step:'add unrelated folder',calls,jobs:status()}))
await c.rescan(fb.id);await c.settled()
console.log(JSON.stringify({step:'unchanged unrelated folder rescan',calls,jobs:status(),state:c.indexState()}))
await c.close();db.close()
console.log(JSON.stringify({root,fa,fb}))
