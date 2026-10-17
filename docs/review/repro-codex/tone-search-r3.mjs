import { mkdtempSync, mkdirSync, cpSync } from 'node:fs'
import { Catalog } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/catalog/core.ts'
import { createComputeApi } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/compute/api.ts'
import { SearchEngine } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/search/engine.ts'
import { loadTextEncoders } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/ml/index.ts'
const root=mkdtempSync('/tmp/red-codex/tone-search-'),dataDir=root+'/data',folder=root+'/input'
const modelsDir='/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/models'
mkdirSync(folder);cpSync('/tmp/red-codex/r3-media/short-audio.mp4',folder+'/pure-tone.mp4')
const api=createComputeApi({type:'init',dataDir,modelsDir,ffmpeg:'/opt/homebrew/bin/ffmpeg',ffprobe:'/opt/homebrew/bin/ffprobe'})
const c=new Catalog(dataDir,api);c.on('warning',e=>console.log(JSON.stringify({warning:e.message})))
await c.addFolder(folder);await c.settled()
console.log(JSON.stringify({root,state:c.indexState(),transcript:c.transcript(1)}))
const s=new SearchEngine(dataDir+'/viquery.db',await loadTextEncoders(modelsDir))
console.log(JSON.stringify({query:'bye',result:await s.search('bye',{scope:{kind:'all'},media:'all'})}))
await s.close();await c.close()
