import { mkdirSync, mkdtempSync, statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createComputeApi } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/compute/api.ts'
import { mediaTools } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/compute/media.ts'
import { Catalog } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/catalog/core.ts'
import { cpSync } from 'node:fs'
const [action,file,runsArg='1']=process.argv.slice(2)
const dataDir=mkdtempSync('/tmp/red-codex/compute-r3-')
const init={type:'init',dataDir,modelsDir:'/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/models',ffmpeg:'/opt/homebrew/bin/ffmpeg',ffprobe:'/opt/homebrew/bin/ffprobe'}
const api=createComputeApi(init), tools=mediaTools(init)
const meta=await api.probe({path:file})
const mb=x=>Math.round(x/1048576*10)/10
const mem=()=>Object.fromEntries(Object.entries(process.memoryUsage()).map(([k,v])=>[k,mb(v)]))
console.log(JSON.stringify({action,file,bytes:statSync(file).size,meta,baselineMiB:mem(),node:process.version,platform:process.platform}))
if(action==='catalog'){
 const folder=dataDir+'/input';mkdirSync(folder);cpSync(file,folder+'/video.mp4')
 const c=new Catalog(dataDir,api);c.on('warning',e=>console.log(JSON.stringify({warning:e.message})))
 await c.addFolder(folder);await c.settled();console.log(JSON.stringify({state:c.indexState(),scenes:c.scenes(1)}));await c.close()
}else for(let run=0;run<Number(runsArg);run++){
 global.gc?.();const before=mem(),start=performance.now()
 let info={}
 if(action==='audio'){
  const spans=await tools.audio(file,meta.durationMs)
  info={spans:spans.map(s=>({startMs:s.startMs,length:s.samples.length})),backingMiB:mb([...new Set(spans.map(s=>s.samples.buffer))].reduce((a,b)=>a+b.byteLength,0))}
 }else if(action==='speech'){
  const result=await api.speech({path:file,mediaId:1});info={segments:result.segments.length,text:result.segments.slice(0,3).map(s=>s.text)}
 }else if(action==='visual'){
  const result=await api.visual({path:file,mediaId:1,kind:meta.kind,durationMs:meta.durationMs})
  const outside=result.samples.filter(s=>s.tMs<result.scenes[s.scene].startMs||s.tMs>result.scenes[s.scene].endMs)
  info={scenes:result.scenes.length,samples:result.samples.length,outside:outside.slice(0,10).map(s=>({scene:result.scenes[s.scene],tMs:s.tMs}))}
 }else if(action==='thumb')info=await api.thumb({path:file,mediaId:1,kind:meta.kind,durationMs:meta.durationMs})
 console.log(JSON.stringify({run,elapsedMs:Math.round(performance.now()-start),beforeMiB:before,afterMiB:mem(),peakRssMiB:mb(process.resourceUsage().maxRSS*1024),...info}))
}
console.log(JSON.stringify({dataDir}))
