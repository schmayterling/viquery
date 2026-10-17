import { mkdir, writeFile, rename, rm, readFile, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { mediaTools } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/compute/media.ts'
const root='/tmp/red-codex/boundary-playlist'
const require=createRequire('/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/package.json')
const sharp=require('sharp')
const tools=mediaTools({ffmpeg:'/opt/homebrew/bin/ffmpeg',ffprobe:'/opt/homebrew/bin/ffprobe'})
const path=root+'/selected/concat.mp4'
await rm(root+'/selected/segment.ts',{force:true})
await symlink(root+'/outside/private.ts',root+'/selected/segment.ts')
for(const target of ['../outside/private.ts','file:'+root+'/outside/private.ts','segment.ts']){
  await writeFile(path, "ffconcat version 1.0\nfile '"+target+"'\nduration 1\n")
  try{
    console.log(target,'probe',JSON.stringify(await tools.probe(path)))
    await tools.poster(path,root+'/concat.webp')
    console.log(target,'poster rgb',[...(await sharp(root+'/concat.webp').raw().toBuffer()).subarray(0,3)])
  }catch(e){console.log(target,'error',e.message.split('\n').slice(0,2).join(' | '))}
}
await rename(root+'/outside/private.ts',root+'/outside/private.ts.hidden')
try{await tools.probe(path)}catch(e){console.log('missing outside',e.message.split('\n').slice(0,2).join(' | '))}
await rename(root+'/outside/private.ts.hidden',root+'/outside/private.ts')
