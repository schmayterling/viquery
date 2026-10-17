import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import * as ort from 'onnxruntime-node';
const base=path.resolve(import.meta.dirname,'node_modules/onnxruntime-node/bin/napi-v6');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);return e.isDirectory()?walk(p):[{path:path.relative(base,p),bytes:fs.statSync(p).size,symlink:fs.lstatSync(p).isSymbolicLink()}];});}
const data={date:new Date().toISOString(),node:process.version,npm:execFileSync('/opt/homebrew/bin/npm',['--version'],{encoding:'utf8'}).trim(),macos:execFileSync('/usr/bin/sw_vers',[],{encoding:'utf8'}),cpu:os.cpus()[0].model,cores:os.cpus().length,memory:os.totalmem(),providers:ort.listSupportedBackends(),native_files:walk(base),packages:Object.fromEntries(['onnxruntime-node','onnxruntime-web','@huggingface/transformers','sharp'].map(n=>[n,JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname,'node_modules',n,'package.json'))).version]))};
fs.writeFileSync(path.resolve(import.meta.dirname,'../raw/runtime-audit.json'),JSON.stringify(data,null,2));
console.log(JSON.stringify({...data,native_files:undefined}));
