import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { createInterface } from 'node:readline'
import sharp from 'sharp'
import { THREADS } from '../ml/runtime.ts'
import type { Probe } from '../shared/protocol.ts'

export type Binaries = { ffmpeg: string; ffprobe: string }
type Frame = { pts: number; ms: number }
type Analysis = {
  frames: Frame[]
  scenes: { startMs: number; endMs: number }[]
}
type Stream = {
  codec_type: string
  codec_name?: string
  width?: number
  height?: number
  duration?: string
  tags?: Record<string, string>
  side_data_list?: { rotation?: number }[]
  disposition?: { attached_pic?: number }
}
type Container = {
  streams: Stream[]
  format: { duration?: string; tags?: Record<string, string> }
}

sharp.concurrency(THREADS.sharp)

async function run(
  binary: string,
  args: string[],
  onLine?: (line: string) => void,
) {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''
  const lines = createInterface({ input: child.stderr })
  lines.on('line', (line) => {
    errors = `${errors}${line}\n`.slice(-4096)
    onLine?.(line)
  })
  const output: Buffer[] = []
  await Promise.all([
    (async () => {
      for await (const chunk of child.stdout) output.push(chunk as Buffer)
    })(),
    new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`${binary} exited ${code}: ${errors.trim()}`))
      })
    }),
  ])
  return Buffer.concat(output)
}

const scale = (edge: number) =>
  `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease`

function timestamp(value?: string): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

// EXIF stores dates in TIFF IFDs. Bound every offset: EXIF is untrusted file data.
function exifDate(exif?: Buffer): number | null {
  if (!exif) return null
  const tiff = exif.subarray(
    exif.toString('ascii', 0, 6) === 'Exif\0\0' ? 6 : 0,
  )
  if (tiff.length < 8) return null
  const little = tiff.toString('ascii', 0, 2) === 'II'
  if (!little && tiff.toString('ascii', 0, 2) !== 'MM') return null
  const u16 = (offset: number) =>
    little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset)
  const u32 = (offset: number) =>
    little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset)
  if (u16(2) !== 42) return null
  const tags = new Map<number, string>()
  const readIfd = (offset: number): number => {
    if (offset < 8 || offset + 2 > tiff.length) return 0
    const count = u16(offset)
    if (offset + 2 + count * 12 > tiff.length) return 0
    let subIfd = 0
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12
      const tag = u16(entry)
      const type = u16(entry + 2)
      const length = u32(entry + 4)
      const value = u32(entry + 8)
      if (tag === 0x8769 && type === 4 && length === 1) subIfd = value
      if (type !== 2 || length === 0) continue
      const start = length <= 4 ? entry + 8 : value
      if (start + length <= tiff.length)
        tags.set(
          tag,
          tiff.toString('ascii', start, start + length).replace(/\0.*$/, ''),
        )
    }
    return subIfd
  }
  const subIfd = readIfd(u32(4))
  if (subIfd) readIfd(subIfd)
  const date = tags.get(0x9003) ?? tags.get(0x9004) ?? tags.get(0x0132)
  if (!date || !/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) return null
  const offset = tags.get(0x9011) ?? tags.get(0x9010) ?? ''
  return timestamp(
    date.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') + offset,
  )
}

function ptsReader(onFrame: (frame: Frame) => void) {
  let timebase = 0
  return (line: string) => {
    const config = /config in time_base:\s*(\d+)\/(\d+)/.exec(line)
    if (config) timebase = Number(config[1]) / Number(config[2])
    if (!line.includes('showinfo')) return
    const match = /\bpts:\s*(-?\d+)\s+pts_time:/.exec(line)
    if (match && timebase) {
      const pts = Number(match[1])
      onFrame({ pts, ms: Math.round(pts * timebase * 1000) })
    }
  }
}

function windows(cuts: { ms: number; score: number }[], durationMs: number) {
  const merged: { ms: number; score: number }[] = []
  let lastCandidate = -Infinity
  for (const cut of cuts) {
    if (cut.ms < 500 || durationMs - cut.ms < 500) continue
    const previous = merged.at(-1)
    if (previous && cut.ms - lastCandidate < 500) {
      if (cut.score > previous.score) merged[merged.length - 1] = cut
    } else merged.push(cut)
    lastCandidate = cut.ms
  }
  const scenes: Analysis['scenes'] = []
  let start = 0
  for (const end of [...merged.map((cut) => cut.ms), durationMs]) {
    for (; start < end; start += 10_000)
      scenes.push({ startMs: start, endMs: Math.min(start + 10_000, end) })
    start = end
  }
  return scenes
}

export function sampleFrames({ frames, scenes }: Analysis) {
  if (!frames.length) throw new Error('video decoded no frames')
  return scenes.flatMap((scene, index) => {
    const length = scene.endMs - scene.startMs
    return (length <= 2000 ? [0.5] : [0.2, 0.5, 0.8]).map((fraction) => {
      const target = scene.startMs + length * fraction
      let low = 0
      let high = frames.length
      while (low < high) {
        const mid = (low + high) >>> 1
        if ((frames[mid] as Frame).ms < target) low = mid + 1
        else high = mid
      }
      const before = frames[Math.max(0, low - 1)] as Frame
      const after = frames[Math.min(low, frames.length - 1)] as Frame
      // Keep cut-adjacent samples in their own shot whenever a frame exists there.
      const frame =
        after.ms >= scene.endMs ||
        (before.ms >= scene.startMs && target - before.ms <= after.ms - target)
          ? before
          : after
      return { scene: index, ...frame }
    })
  })
}

// A balanced expression avoids a deep parser stack and evaluates O(log n) per frame.
function selectPts(points: number[]): string {
  if (points.length === 1) return `eq(pts,${points[0]})`
  const mid = points.length >>> 1
  return `if(lt(pts,${points[mid]}),${selectPts(points.slice(0, mid))},${selectPts(points.slice(mid))})`
}

export function mediaTools(binaries: Binaries) {
  const ffmpeg = (args: string[], onLine?: (line: string) => void) =>
    run(
      binaries.ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-nostats',
        '-y',
        '-threads',
        String(THREADS.compute),
        '-filter_threads',
        String(THREADS.compute),
        '-protocol_whitelist',
        'file,pipe',
        ...args.slice(0, -1),
        '-threads',
        String(THREADS.compute),
        args.at(-1) as string,
      ],
      onLine,
    )
  const container = async (path: string): Promise<Container> =>
    JSON.parse(
      (
        await run(binaries.ffprobe, [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          path,
        ])
      ).toString(),
    )

  async function probe(path: string): Promise<Probe> {
    const metadata = await sharp(path)
      .metadata()
      .catch(() => null)
    if (metadata) {
      return {
        kind: 'image',
        ...metadata.autoOrient,
        durationMs: null,
        takenAt: exifDate(metadata.exif),
        codec: metadata.format,
        hasAudio: false,
      }
    }
    const { streams, format } = await container(path)
    const video = streams.find(
      (stream) =>
        stream.codec_type === 'video' && !stream.disposition?.attached_pic,
    )
    if (!video?.width || !video.height)
      throw new Error('no video or image stream')
    const image = /\.(heic|heif|avif|jpg|jpeg|png|webp|gif|tiff?|bmp)$/i.test(
      extname(path),
    )
    const rotation =
      video.side_data_list?.find((side) => side.rotation !== undefined)
        ?.rotation ?? Number(video.tags?.rotate ?? 0)
    const swap = Math.abs(rotation % 180) === 90
    const durationMs = Math.round(
      Number(format.duration ?? video.duration) * 1000,
    )
    if (!image && (!Number.isFinite(durationMs) || durationMs <= 0))
      throw new Error('video has no finite duration')
    return {
      kind: image ? 'image' : 'video',
      width: swap ? video.height : video.width,
      height: swap ? video.width : video.height,
      durationMs: image ? null : durationMs,
      takenAt: timestamp(
        video.tags?.creation_time ?? format.tags?.creation_time,
      ),
      codec: video.codec_name ?? null,
      hasAudio:
        !image && streams.some((stream) => stream.codec_type === 'audio'),
    }
  }

  async function image(path: string) {
    const decode = (input: string | Buffer) =>
      sharp(input)
        .autoOrient()
        .toColourspace('srgb')
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    try {
      return await decode(path)
    } catch {
      // sharp 0.35 may lack an HEVC decoder; ffmpeg is the existing fallback.
      return decode(
        await ffmpeg([
          '-v',
          'error',
          '-i',
          path,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-f',
          'image2pipe',
          '-c:v',
          'png',
          'pipe:1',
        ]),
      )
    }
  }

  async function poster(path: string, output: string) {
    await mkdir(dirname(output), { recursive: true })
    const png = await ffmpeg([
      '-v',
      'error',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-frames:v',
      '1',
      '-vf',
      scale(512),
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      'pipe:1',
    ])
    await sharp(png).webp().toFile(output)
  }

  async function sprite(path: string, durationMs: number, output: string) {
    await mkdir(dirname(output), { recursive: true })
    const png = await ffmpeg([
      '-v',
      'error',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-an',
      '-vf',
      `fps=fps=50/(${durationMs}/1000):start_time=0,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=10x5:nb_frames=50:padding=0:margin=0`,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      'pipe:1',
    ])
    await sharp(png).webp().toFile(output)
    return { columns: 10, rows: 5, frames: 50 }
  }

  async function analyze(path: string, durationMs: number): Promise<Analysis> {
    const frames: Frame[] = []
    const output = await ffmpeg(
      [
        '-v',
        'info',
        '-i',
        path,
        '-map',
        '0:v:0',
        '-an',
        '-vf',
        `${scale(384)},showinfo=checksum=0,select='gt(scene,0.3)',metadata=mode=print:key=lavfi.scene_score:file=-`,
        '-f',
        'null',
        '-',
      ],
      ptsReader((frame) => frames.push(frame)),
    )
    const cuts: { ms: number; score: number }[] = []
    const byPts = new Map(frames.map((frame) => [frame.pts, frame.ms]))
    let pts = 0
    for (const line of output.toString().split('\n')) {
      const frame = /\bpts:\s*(-?\d+)/.exec(line)
      if (frame) pts = Number(frame[1])
      const score = /lavfi.scene_score=([\d.e+-]+)/.exec(line)
      const ms = byPts.get(pts)
      if (score && ms !== undefined) cuts.push({ ms, score: Number(score[1]) })
    }
    return { frames, scenes: windows(cuts, durationMs) }
  }

  async function extract(path: string, points: number[], directory: string) {
    await mkdir(directory, { recursive: true })
    const temporary = await mkdtemp(join(directory, '.decode-'))
    try {
      const filter = join(temporary, 'filter.txt')
      // FFmpeg 8 supports -/filter:v to read the filter from disk, avoiding argv limits.
      // https://ffmpeg.org/ffmpeg.html#Options
      await writeFile(
        filter,
        `select='${selectPts(points)}',${scale(320)},showinfo=checksum=0`,
      )
      const frames: Frame[] = []
      await ffmpeg(
        [
          '-v',
          'info',
          '-i',
          path,
          '-map',
          '0:v:0',
          '-an',
          '-/filter:v',
          filter,
          '-fps_mode',
          'passthrough',
          '-c:v',
          'png',
          join(temporary, '%06d.png'),
        ],
        ptsReader((frame) => frames.push(frame)),
      )
      const results = new Map<number, { path: string; ms: number }>()
      for (const [i, frame] of frames.entries()) {
        const output = join(directory, `${frame.ms}.webp`)
        await sharp(
          await readFile(
            join(temporary, `${String(i + 1).padStart(6, '0')}.png`),
          ),
        )
          .webp()
          .toFile(output)
        results.set(frame.pts, { path: output, ms: frame.ms })
      }
      return results
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async function audio(path: string, durationMs: number) {
    const silence: { start: number; end: number }[] = []
    let start = 0
    // Preserve delayed audio and timeline gaps as silence rather than shifting cues to zero.
    // FFmpeg 8+: https://ffmpeg.org/ffmpeg-resampler.html#Resampler-Options
    const pcm = await ffmpeg(
      [
        '-v',
        'info',
        '-i',
        path,
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-t',
        String(durationMs / 1000),
        '-af',
        'aresample=16000:async=1:first_pts=0,silencedetect=noise=-50dB:d=0.5',
        '-f',
        'f32le',
        'pipe:1',
      ],
      (line) => {
        const begin = /silence_start: ([\d.e+-]+)/.exec(line)
        const end = /silence_end: ([\d.e+-]+)/.exec(line)
        if (begin) start = Number(begin[1])
        if (end) silence.push({ start, end: Number(end[1]) })
      },
    )
    // ponytail: whole-file PCM is 230 MB/hour before copies; use ffmpeg -ss/-t ASR windows if memory limits it.
    const samples = new Float32Array(pcm.length / 4)
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readFloatLE(i * 4)
    const duration = samples.length / 16000
    const spans: { start: number; end: number }[] = []
    let cursor = 0
    for (const gap of silence) {
      if (gap.start > cursor)
        spans.push({ start: cursor, end: Math.min(duration, gap.start + 0.15) })
      cursor = Math.max(cursor, gap.end - 0.15)
    }
    if (cursor < duration) spans.push({ start: cursor, end: duration })
    // Suppress residual padded silence, including all-silent clips.
    return spans
      .filter((span) => {
        const first = Math.floor(span.start * 16000)
        const last = Math.floor(span.end * 16000)
        let energy = 0
        for (const value of samples.subarray(first, last)) energy += value ** 2
        return energy / (last - first) > 1e-5
      })
      .map((span) => ({
        startMs: Math.round(span.start * 1000),
        samples: samples.subarray(
          Math.floor(span.start * 16000),
          Math.floor(span.end * 16000),
        ),
      }))
  }

  return { probe, image, poster, sprite, analyze, extract, audio }
}
