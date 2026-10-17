const path=require('node:path');
const ort=require('onnxruntime-node');
(async()=>{
  const {AutoProcessor,AutoTokenizer,RawImage,pipeline,env}=await import('@huggingface/transformers');
  const root=path.resolve(__dirname,'../raw');
  env.localModelPath=path.join(root,'models')+path.sep;
  env.allowRemoteModels=false;
  const repo='Xenova/clip-vit-base-patch32';
  const processor=await AutoProcessor.from_pretrained(repo,{local_files_only:true});
  const tokenizer=await AutoTokenizer.from_pretrained(repo,{local_files_only:true});
  const pixels=await processor(await RawImage.read(path.join(root,'images/coffee.png')));
  const tokens=tokenizer('a cup of coffee',{padding:'max_length',truncation:true,max_length:77});
  const checks=[];
  for(const tower of ['vision','text']){
    const s=await ort.InferenceSession.create(path.join(root,'models',repo,'onnx',tower+'_model_int8.onnx'),{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,executionMode:'sequential',graphOptimizationLevel:'all'});
    const input=tower==='vision'?pixels:tokens;
    const out=await s.run(Object.fromEntries(s.inputNames.map(n=>[n,new ort.Tensor(input[n].type,input[n].data,input[n].dims)])));
    const t=Object.values(out)[0];
    if(t.dims[1]!==512||!Array.from(t.data).every(Number.isFinite))throw Error('bad embedding');
    checks.push({tower,shape:t.dims,finite:true});await s.release();
  }
  const pcm=require('node:child_process').execFileSync('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-i',path.join(root,'audio/jfk.flac'),'-vn','-ac','1','-ar','16000','-f','s16le','pipe:1']);
  const audio=Float32Array.from({length:pcm.length/2},(_,i)=>pcm.readInt16LE(i*2)/32768);
  const asr=await pipeline('automatic-speech-recognition','onnx-community/whisper-base.en',{device:'cpu',dtype:'q8',local_files_only:true,session_options:{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1}});
  const output=await asr(audio,{return_timestamps:true,num_beams:1,do_sample:false,max_new_tokens:128});
  checks.push({task:'asr',audio_seconds:audio.length/16000,output});await asr.dispose();
  process.parentPort.postMessage({date:new Date().toISOString(),versions:process.versions,providers:ort.listSupportedBackends(),checks});
})().catch(error=>process.parentPort.postMessage({error:String(error)}));
