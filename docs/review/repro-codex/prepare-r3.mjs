import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
const dir='/tmp/red-codex/r3-media';mkdirSync(dir,{recursive:true})
function make(name,args){const path=`${dir}/${name}.mp4`;execFileSync('/opt/homebrew/bin/ffmpeg',['-hide_banner','-nostdin','-y','-v','error',...args,path],{stdio:['ignore','ignore','pipe']});console.log(JSON.stringify({path,bytes:statSync(path).size}))}
for(const [name,duration,offset] of [['short-audio',12,0],['late-audio-2h',7201,7200]])make(name,['-f','lavfi','-i','testsrc2=size=96x64:rate=1','-itsoffset',String(offset),'-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=1','-t',String(duration),'-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-crf','35','-threads','1','-c:a','aac','-b:a','32k'])
make('sparse-frames',['-f','lavfi','-i','testsrc2=size=96x64:rate=1/20','-t','60','-an','-c:v','libx264','-preset','ultrafast','-crf','35','-threads','1'])
make('visual-10min',['-f','lavfi','-i','testsrc2=size=96x64:rate=1','-t','600','-an','-c:v','libx264','-preset','ultrafast','-crf','35','-threads','1'])
