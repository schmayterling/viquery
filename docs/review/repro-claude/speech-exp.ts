// craft clips: speech A, exact digital silence, speech B cut mid-word at EOF; check compute.speech segment ends vs probe duration
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const wt = '/Users/may/Documents/ChatGPT/viquery/.worktrees/red-claude'
const { createComputeApi } = await import(`${wt}/src/compute/api.ts`)
const dir = '/tmp/red-claude/speech'
const f32 = (p: string) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) }
const trimLead = (x: Float32Array) => { let i = 0; while (i < x.length && Math.abs(x[i]) < 0.02) i++; return x.subarray(i) }
const A = f32(`${dir}/a.f32`), B = trimLead(f32(`${dir}/b.f32`))
const api = createComputeApi({ type: 'init', dataDir: `${dir}/data`, modelsDir: `${wt}/models`, ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe' })
for (let extra = 0; extra < 16; extra++) {
  const silence = 16000 + extra // 1 s + extra samples of digital silence
  let n = A.length + silence + Math.floor(B.length * 0.8)
  n -= n % 16 // whole milliseconds of audio
  const pcm = new Float32Array(n)
  pcm.set(A, 0)
  pcm.set(B.subarray(0, n - A.length - silence), A.length + silence)
  writeFileSync(`${dir}/clip.f32`, pcm)
  const out = `${dir}/clip${extra}.mov`
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:size=64x64:rate=25:duration=${(n / 16000 - 0.2).toFixed(3)}`, '-f', 'f32le', '-ar', '16000', '-ac', '1', '-i', `${dir}/clip.f32`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', out])
  const probe = await api.probe({ path: out })
  const speech = await api.speech({ mediaId: 1, path: out })
  const last = speech.segments.at(-1)
  console.log(JSON.stringify({ extra, bStartSample: A.length + silence, mod16: (A.length + silence - 2400) % 16, durationMs: probe.durationMs, segments: speech.segments.map((s) => `${s.startMs}-${s.endMs}`), lastEndMs: last?.endMs, overflow: last ? last.endMs > (probe.durationMs as number) : null }))
}
