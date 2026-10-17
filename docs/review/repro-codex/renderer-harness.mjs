import { createElement } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/node_modules/react/index.js'
import { createRoot } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/node_modules/react-dom/client.js'
import { App } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/renderer/src/App.tsx'
import '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/renderer/src/styles.css'
const ids=Array.from({length:100},(_,i)=>i+1), changes=new Set(), requests=[]
const index=()=>({ids:Uint32Array.from(ids),ready:new Uint8Array(100).fill(1),aspect:new Float32Array(100).fill(1),kind:new Uint8Array(100),takenAt:Float64Array.from(ids,i=>Date.now()-i*86400000),durationMs:new Uint32Array(100)})
window.viquery={appInfo:async()=>({version:'fixture',platform:'darwin'}),folders:async()=>[{id:1,path:'/fixture',name:'fixture',count:100,state:'online'}],library:async()=>index(),items:async(ids)=>{requests.push([...ids]);return ids.map(id=>({id,kind:'image',folderId:1,name:`photo-${id}.jpg`,path:`/fixture/photo-${id}.jpg`,width:100,height:100,takenAt:Date.now(),durationMs:null,bytes:100,sprite:null}))},scenes:async()=>[],transcript:async()=>[],search:async()=>({query:'',images:[],videos:[],pending:{images:0,videos:0},tookMs:0}),similar:async()=>({images:[],videos:[],pending:{images:0,videos:0}}),searchVideo:async()=>[],pauseIndexing:async()=>{},addFolder:async()=>null,removeFolder:async()=>{},reveal:async()=>{},onLibraryChanged:fn=>{changes.add(fn);return()=>changes.delete(fn)},onIndex:fn=>{setTimeout(()=>fn({phase:'idle',items:100,failed:0}),0);return()=>{}}}
createRoot(document.getElementById('root')).render(createElement(App))
const delay=ms=>new Promise(r=>setTimeout(r,ms))
document.getElementById('open').onclick=()=>document.querySelector('[role="gridcell"]')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))
document.getElementById('advance').onclick=async()=>{for(let i=0;i<80;i++){document.querySelector('.viewer')?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await delay(25)}}
let eventCount=0
document.getElementById('change').onclick=()=>{eventCount++;for(const fn of changes)fn()}
setInterval(()=>{document.getElementById('status').textContent=JSON.stringify({viewerTitle:document.querySelector('.viewer .title')?.textContent??null,viewerBodyChildren:document.querySelector('.viewer-body')?.children.length??null,requests:requests.length,lastRequest:requests.at(-1),requestsFor81:requests.filter(ids=>ids.includes(81)).length,eventCount})},200)
