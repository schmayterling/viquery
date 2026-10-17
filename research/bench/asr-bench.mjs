import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {pipeline,env} from '@huggingface/transformers';
const root=path.resolve(import.meta.dirname,'../raw');
env.allowRemoteModels=false;env.localModelPath=path.join(root,'models')+path.sep;
const pcm=execFileSync('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-i',path.join(root,'audio/jfk.flac'),'-vn','-ac','1','-ar','16000','-f','s16le','pipe:1']);
const speech=Float32Array.from({length:pcm.length/2},(_,i)=>pcm.readInt16LE(i*2)/32768);
const result={date:new Date().toISOString(),node:process.version,model:'onnx-community/whisper-base.en',dtype:'q8',device:'cpu',audio_seconds:speech.length/16000,source:'https://github.com/openai/whisper/blob/main/tests/jfk.flac',warmups:1,runs:5,measurements:[]};
for(const threads of [1,2,4]){
  const start=performance.now();
  const asr=await pipeline('automatic-speech-recognition',result.model,{device:'cpu',dtype:'q8',local_files_only:true,session_options:{executionProviders:['cpu'],intraOpNumThreads:threads,interOpNumThreads:1,executionMode:'sequential',graphOptimizationLevel:'all'}});
  const load_ms=performance.now()-start;
  const options={return_timestamps:true,chunk_length_s:30,stride_length_s:5,num_beams:1,do_sample:false,max_new_tokens:128};
  await asr(speech,options);
  const samples=[];let output;
  for(let i=0;i<result.runs;i++){const s=performance.now();output=await asr(speech,options);samples.push(performance.now()-s);}
  samples.sort((a,b)=>a-b);
  const median_ms=samples[2],p90_ms=samples[4];
  const row={threads,load_ms,samples_ms:samples,median_ms,p90_ms,rtf:median_ms/(1000*result.audio_seconds),minutes_per_audio_hour:median_ms/(1000*result.audio_seconds)*60,output};
  result.measurements.push(row);
  console.log(JSON.stringify(row));
  await asr.dispose();
  fs.writeFileSync(path.join(root,'asr-bench.json'),JSON.stringify(result,null,2));
}
