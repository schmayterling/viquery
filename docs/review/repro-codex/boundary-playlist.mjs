import { mkdir, writeFile, rename, rm, readFile, symlink, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mediaTools } from '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/src/compute/media.ts'
const root = '/tmp/red-codex/boundary-playlist'
await mkdir(root + '/selected', { recursive: true })
await mkdir(root + '/outside', { recursive: true })
const require = createRequire('/Users/may/Documents/ChatGPT/viquery/.worktrees/red-codex/package.json')
const sharp = require('sharp')
const tools = mediaTools({ffmpeg:'/opt/homebrew/bin/ffmpeg', ffprobe:'/opt/homebrew/bin/ffprobe'})
const outside = root + '/outside/private.ts'
execFileSync('/opt/homebrew/bin/ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=red:s=32x32:r=25:d=1','-threads','1','-c:v','mpeg2video','-f','mpegts',outside])
const playlist = root + '/selected/holiday.mp4'
await writeFile(playlist, '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.0,\n../outside/private.ts\n#EXT-X-ENDLIST\n')
for (const label of ['relative traversal', 'absolute file url']) {
  if (label.startsWith('absolute')) await writeFile(playlist, (await readFile(playlist,'utf8')).replace('../outside/private.ts','file:' + outside))
  try {
    console.log(label, 'probe', JSON.stringify(await tools.probe(playlist)))
    await tools.poster(playlist,root + '/poster.webp')
    const pixel = await sharp(root+'/poster.webp').raw().toBuffer()
    console.log(label, 'poster rgb', [...pixel.subarray(0,3)])
  } catch (e) { console.log(label, 'ERROR', e.message) }
}
await rename(outside, outside + '.hidden')
try { await tools.probe(playlist); console.log('missing outside: unexpectedly succeeds') } catch(e) { console.log('missing outside:', e.message.split('\n').filter(x => /open|segment|No such/.test(x)).join(' | ')) }
await rename(outside + '.hidden', outside)
const network = (await readFile(playlist,'utf8')).replace('file:'+outside, 'http://127.0.0.1:9/private.ts')
await writeFile(root+'/selected/network.mp4', network)
try { await tools.probe(root+'/selected/network.mp4'); console.log('network: unexpectedly succeeds') } catch (e) { console.log('network:', e.message.split('\n').filter(x=> /whitelist/.test(x)).join(' | ')) }
