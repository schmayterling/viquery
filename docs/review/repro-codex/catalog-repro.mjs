import { Catalog } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/catalog/core.ts'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, mkdir, open, writeFile, copyFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'

const base = await mkdtemp('/tmp/red-codex/catalog-')
const all = { scope: { kind: 'all' }, media: 'all' }
const stub = {
  async probe() { return {kind:'image',width:5000,height:5000,durationMs:null,hasAudio:false,takenAt:null,codec:'bmp'} },
  async thumb() { return {sprite:null} },
  async visual() { const embedding=new Float32Array(512);embedding[0]=1;return {generation:1,scenes:[],samples:[{scene:-1,tMs:null,embedding}]} },
  async speech() { return {generation:1,segments:[]} }
}
async function hash(path) {
  const h=createHash('sha256')
  for await (const c of createReadStream(path)) h.update(c)
  return h.digest('hex')
}
async function bmp(path, patch=false) {
  const n=54+5000*5000*3, header=Buffer.alloc(54)
  header.write('BM');header.writeUInt32LE(n,2);header.writeUInt32LE(54,10);header.writeUInt32LE(40,14)
  header.writeInt32LE(5000,18);header.writeInt32LE(5000,22);header.writeUInt16LE(1,26);header.writeUInt16LE(24,28)
  const f=await open(path,'w');await f.truncate(n);await f.write(header,0,54,0)
  if(patch) { const p=Buffer.alloc(4*1024*1024,255);await f.write(p,0,p.length,8*1024*1024) }
  await f.close()
}
{
  const dir=join(base,'collision');await mkdir(dir)
  const a=join(dir,'black.bmp'),b=join(dir,'band.bmp')
  await bmp(a);await bmp(b,true)
  const c=new Catalog(join(base,'collision-db'),stub);c.pauseIndexing(true)
  await c.addFolder(dir)
  const db=new DatabaseSync(join(base,'collision-db/viquery.db'),{readOnly:true})
  console.log('sample collision',JSON.stringify({fullShaA:await hash(a),fullShaB:await hash(b),libraryIds:[...c.library(all).ids],aliases:db.prepare('select path,media_id from file').all()}))
  const frameHashes=[a,b].map(p=>execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i',p,'-frames:v','1','-f','framemd5','-'],{encoding:'utf8'}).trim().split('\n').at(-1))
  console.log('decoded bmp frame hashes',frameHashes)
  db.close();await c.close()
}
{
  const dir=join(base,'parent'),sub=join(dir,'child');await mkdir(sub,{recursive:true})
  await writeFile(join(sub,'x.jpg'),'nested-image')
  const c=new Catalog(join(base,'nested-db'),stub);c.pauseIndexing(true)
  const p=await c.addFolder(dir),s=await c.addFolder(sub)
  const before=c.folders()
  c.removeFolder(s.id)
  console.log('overlapping folders',JSON.stringify({parent:p.id,child:s.id,before,after:c.folders(),libraryIds:[...c.library(all).ids]}))
  await c.close()
}
{
  const dir=join(base,'drive');await mkdir(dir)
  await writeFile(join(dir,'x.jpg'),'drive-image')
  const c=new Catalog(join(base,'drive-db'),stub);c.pauseIndexing(true)
  const f=await c.addFolder(dir)
  await rename(dir,dir+'-unmounted');await mkdir(dir)
  await c.rescan()
  console.log('empty mountpoint',JSON.stringify({folder:c.folders()[0],libraryIds:[...c.library(all).ids]}))
  await c.close()
}
console.log('scratch',base)
