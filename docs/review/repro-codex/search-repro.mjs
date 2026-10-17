import { SearchEngine } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/search/engine.ts'
import { loadTextEncoders } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/ml/index.ts'
import { DatabaseSync } from 'node:sqlite'
const root='/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex'
const path=root+'/out/core-smoke-profile/library/viquery.db'
const db=new DatabaseSync(path,{readOnly:true})
const video=db.prepare("select m.id from media m join file f on f.media_id=m.id where f.name='launch.mp4'").get().id
const encoders=await loadTextEncoders(root+'/models')
const engine=new SearchEngine(path,encoders)
const result=await engine.search('a rocket launching',{scope:{kind:'all'},media:'all'})
const timeline=await engine.searchVideo(video,'a rocket launching')
console.log('rocket global',JSON.stringify(result.videos.find(v=>v.mediaId===video)))
console.log('rocket timeline',JSON.stringify(timeline))
const { mediaHandler } = await import(root+'/src/main/media-protocol.ts')
const { dataPaths } = await import(root+'/src/shared/paths.ts')
const handler=mediaHandler(dataPaths(root+'/out/core-smoke-profile/library'),()=>[],'null')
const spoken=await engine.search('ask what you can do for your country',{scope:{kind:'all'},media:'all'})
const moment=spoken.videos.find(v=>v.mediaId===video).moments[0]
const response=await handler(new Request('vq://frame/'+video+'/'+moment.seekMs))
console.log('speech global',JSON.stringify({moment,frameStatus:response.status}))
await engine.close();db.close()
