import { Catalog } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/catalog/core.ts'
import { mkdtemp,mkdir,chmod,writeFile } from 'node:fs/promises'
const base=await mkdtemp('/tmp/red-codex/permission-')
await mkdir(base+'/selected/blocked',{recursive:true})
await writeFile(base+'/selected/visible.jpg','content')
const c=new Catalog(base+'/data',{});c.pauseIndexing(true)
const warnings=[];c.on('warning',e=>warnings.push(e.message))
await chmod(base+'/selected/blocked',0)
try {
  const folder=await c.addFolder(base+'/selected')
  console.log(JSON.stringify({folder,phase:c.indexState(),warnings}))
} finally {await chmod(base+'/selected/blocked',0o700);await c.close()}
