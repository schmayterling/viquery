import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import * as ort from 'onnxruntime-node';
import {AutoProcessor, AutoTokenizer, RawImage, env} from '@huggingface/transformers';

const root=path.resolve(import.meta.dirname,'../raw');
env.allowRemoteModels=false;
env.localModelPath=path.join(root,'models')+path.sep;
env.cacheDir=path.join(root,'cache');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'images/manifest.json')));
const repos=['Xenova/clip-vit-base-patch32','Xenova/siglip-base-patch16-224','onnx-community/siglip2-base-patch16-224-ONNX'];
const models=process.argv[2] ? repos.filter(x=>x.includes(process.argv[2])) : repos;
const providers=ort.listSupportedBackends();
const result={date:new Date().toISOString(),env:{node:process.version,ort:ort.env.versions,platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0].model,cores:os.cpus().length,memory:os.totalmem(),providers},runs:20,warmups:4,measurements:[],retrieval:[],errors:[]};
const output=path.join(root,'bench-'+(process.argv[2]||'all').replace(/[^a-zA-Z0-9.-]/g,'-')+'.json');
const save=()=>fs.writeFileSync(output,JSON.stringify(result,null,2));
const tensor=x=>new ort.Tensor(x.type,x.data,x.dims);
function normalized(x){const a=Array.from(x); const n=Math.hypot(...a); return a.map(v=>v/n);}
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
async function time(session,feeds){
  for(let i=0;i<result.warmups;i++)await session.run(feeds);
  const times=[];
  for(let i=0;i<result.runs;i++){const start=performance.now();await session.run(feeds);times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);
  return {median_ms:(times[9]+times[10])/2,p90_ms:times[17],samples_ms:times};
}
for(const repo of models){
  const processor=await AutoProcessor.from_pretrained(repo,{local_files_only:true});
  const tokenizer=await AutoTokenizer.from_pretrained(repo,{local_files_only:true});
  const t0=performance.now();
  const images=await Promise.all(fixture.map(x=>RawImage.read(path.join(root,'images',x.file))));
  const pix=await processor(images);
  result.measurements.push({repo,task:'preprocess-10-images',ms:performance.now()-t0});
  const text=tokenizer(fixture.map(x=>x.query),{padding:'max_length',truncation:true,max_length:repo.includes('siglip')?64:77});
  const oneImage=new ort.Tensor('float32',pix.pixel_values.data.slice(0,pix.pixel_values.data.length/images.length),[1,...pix.pixel_values.dims.slice(1)]);
  const eightImages=new ort.Tensor('float32',pix.pixel_values.data.slice(0,pix.pixel_values.data.length/images.length*8),[8,...pix.pixel_values.dims.slice(1)]);
  for(const dtype of ['int8','fp32','q4']){
    const suffix=dtype==='fp32'?'':'_'+dtype;
    for(const ep of ['cpu','coreml']){
      // keep heavy thread sweeps serial; gpu/coreml runs are separate from cpu baseline.
      for(const threads of ep==='cpu'&&dtype==='int8'?[1,2,4]:[2]){
        const sessions={};
        try{
          for(const tower of ['vision','text']){
            const model=path.join(root,'models',repo,'onnx',tower+'_model'+suffix+'.onnx');
            const start=performance.now();
            sessions[tower]=await ort.InferenceSession.create(model,{executionProviders:ep==='coreml'?[{name:'coreml',coreMlFlags:0x010},'cpu']:['cpu'],intraOpNumThreads:threads,interOpNumThreads:1,executionMode:'sequential',graphOptimizationLevel:'all',logSeverityLevel:3});
            result.measurements.push({repo,dtype,ep,threads,task:tower+'-load',ms:performance.now()-start,inputs:sessions[tower].inputMetadata,outputs:sessions[tower].outputMetadata});
          }
          for(const [batch,values] of [[1,oneImage],[8,eightImages]]){
            const stats=await time(sessions.vision,{pixel_values:values});
            const row={repo,dtype,ep,threads,task:'image',batch,...stats,per_image_ms:stats.median_ms/batch};
            result.measurements.push(row);console.log(JSON.stringify({...row,samples_ms:undefined}));
          }
          const textFeeds={};
          for(const name of sessions.text.inputNames){const v=text[name];textFeeds[name]=new ort.Tensor(v.type,v.data.slice(0,v.dims[1]),[1,v.dims[1]]);}
          const stats=await time(sessions.text,textFeeds);
          result.measurements.push({repo,dtype,ep,threads,task:'text',batch:1,...stats});
          console.log(JSON.stringify({repo,dtype,ep,threads,task:'text',...stats,samples_ms:undefined}));
          if(ep==='cpu'&&threads===2){
            const ie=await sessions.vision.run({pixel_values:tensor(pix.pixel_values)});
            const te=await sessions.text.run(Object.fromEntries(sessions.text.inputNames.map(n=>[n,tensor(text[n])])));
            const iv=ie.image_embeds??ie.pooler_output??Object.values(ie).find(x=>x.dims.length===2);
            const tv=te.text_embeds??te.pooler_output??Object.values(te).find(x=>x.dims.length===2);
            const d=iv.dims[1];
            const vectors=fixture.map((_,i)=>normalized(iv.data.slice(i*d,(i+1)*d)));
            const rankings=fixture.map((q,i)=>{
              const t=normalized(tv.data.slice(i*d,(i+1)*d));
              const ranked=vectors.map((v,j)=>({image:fixture[j].file,score:dot(t,v)})).sort((a,b)=>b.score-a.score);
              return {query:q.query,expected:q.file,rank:ranked.findIndex(x=>x.image===q.file)+1,top3:ranked.slice(0,3)};
            });
            result.retrieval.push({repo,dtype,dim:d,top1:rankings.filter(x=>x.rank===1).length,total:fixture.length,rankings});
          }
        }catch(e){const row={repo,dtype,ep,threads,error:String(e)};result.errors.push(row);console.log(JSON.stringify(row));}
        finally{for(const s of Object.values(sessions))await s.release();save();}
      }
    }
  }
}
save();console.log('saved '+output);
