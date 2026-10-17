import { mkdir, mkdtemp, writeFile, readFile, symlink, rm, stat, utimes } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Catalog } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/catalog/core.ts'
import { createComputeApi } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/compute/api.ts'
import { dataPaths } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/shared/paths.ts'
import { mediaHandler } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/main/media-protocol.ts'
const require=createRequire('/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/package.json')
const sharp=require('sharp')
const root=await mkdtemp('/tmp/red-codex/boundary-catalog-')
for(const dir of ['selected','outside','data']) await mkdir(root+'/'+dir)
const input=root+'/selected/photo.png'
const outside=root+'/outside/private.png'
await sharp({create:{width:32,height:32,channels:3,background:'red'}}).png().toFile(input)
await sharp({create:{width:32,height:32,channels:3,background:'blue'}}).png().toFile(outside)
await utimes(input,1700000000,1700000000)
await utimes(outside,1700000000,1700000000)
const before=await stat(input), external=await stat(outside)
console.log('same size/mtime',before.size===external.size,before.mtimeMs===external.mtimeMs)
const actual=createComputeApi({type:'init',dataDir:root+'/data',modelsDir:root+'/no-models',ffmpeg:'/opt/homebrew/bin/ffmpeg',ffprobe:'/opt/homebrew/bin/ffprobe'})
let thumbId
const catalog=new Catalog(root+'/data',{
  probe:p=>actual.probe(p),
  thumb:async p=>{const result=await actual.thumb(p);thumbId=p.mediaId;catalog.pauseIndexing(true);return result},
  visual:()=>{throw new Error('model use forbidden')},
  speech:()=>{throw new Error('model use forbidden')}
})
catalog.on('warning',e=>console.log('warning',e.message))
catalog.pauseIndexing(true)
await catalog.addFolder(root+'/selected')
await rm(input)
await symlink(outside,input)
catalog.pauseIndexing(false)
await catalog.settled()
const thumb=dataPaths(root+'/data').thumb(thumbId)
console.log('catalog indexed symlink escape: thumb rgb',[...(await sharp(thumb).raw().toBuffer()).subarray(0,3)],'phase',JSON.stringify(catalog.indexState()))
const handler=mediaHandler(dataPaths(root+'/data'),()=>[{path:input,root:root+'/selected',size:before.size,mtimeMs:before.mtimeMs}],'null')
console.log('same symlink original protocol status',(await handler(new Request('vq://media/1'))).status)
await catalog.close()
console.log('artifacts',root)
