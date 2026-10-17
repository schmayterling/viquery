import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/catalog/schema.ts'
import { SearchEngine } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/search/engine.ts'
const root=mkdtempSync('/tmp/red-codex/search-scale-'), path=root+'/db.sqlite'
const db=openDatabase(path)
const vector=(score,n=512)=>{const v=new Float32Array(n);v[0]=score;v[1]=Math.sqrt(1-score*score);return v}
const blob=v=>new Uint8Array(v.buffer,v.byteOffset,v.byteLength)
const encoders={clip:async()=>vector(1),sentence:async()=>vector(1,384)}
const all={scope:{kind:'all'},media:'all'}
db.exec("insert into folder values(1,'/fixture',0)")
const media=db.prepare('insert into media(id,sha256,kind,width,height,duration_ms,has_audio,taken_at,added_at,bytes)values(?,?,?,96,64,?,0,0,?,1)')
const file=db.prepare('insert into file(path,folder_id,media_id,name,size,mtime_ms) values(?,1,?,?,1,0)')
const sample=db.prepare('insert into sample(media_id,scene_id,generation,t_ms,embedding)values(?,?,1,?,?)')
for (const [id,kind,name,duration]of[[1,1,'movie.mp4',710000],[2,0,'photo.jpg',null]]){
 media.run(id,Buffer.alloc(32,id),kind,duration,Date.now());file.run('/fixture/'+name,id,name)
}
db.exec('begin')
for(let i=0;i<71;i++){
 const id=i+1,start=i*10000;db.prepare('insert into scene values(?,1,1,?,?)').run(id,start,start+10000)
 for(const offset of[2000,5000,8000])sample.run(1,id,start+offset,blob(vector(.31)))
}
sample.run(2,null,null,blob(vector(.30)));db.exec('commit')
const s=new SearchEngine(path,encoders)
for(const filter of[all,{...all,media:'image'}]){
 const r=await s.search('unrelated-name',filter)
 console.log(JSON.stringify({filter,images:r.images,videos:r.videos.map(v=>({id:v.mediaId,moments:v.moments.length})),pending:r.pending}))
}
await s.close()
db.exec('delete from sample;delete from scene');db.prepare('insert into scene values(1,1,1,0,710000)').run()
sample.run(1,1,1000,blob(vector(.42)));sample.run(2,null,null,blob(vector(.33)))
const s2=new SearchEngine(path,encoders)
for(const filter of[all,{...all,media:'image'}]){const r=await s2.search('another-name',filter);console.log(JSON.stringify({scenario:'one video sample, one image sample',filter,images:r.images,videos:r.videos.map(v=>v.mediaId)}))}
await s2.close();db.close();console.log(JSON.stringify({root}))
