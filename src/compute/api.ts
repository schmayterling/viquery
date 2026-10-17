import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import sharp from 'sharp'
import {
  loadImageEncoder,
  loadSentenceEncoder,
  loadSpeechEncoder,
} from '../ml/index.ts'
import { dataPaths } from '../shared/paths.ts'
import {
  type ComputeApi,
  GENERATION,
  type SpeechResult,
  type UtilityMessage,
} from '../shared/protocol.ts'
import { mediaTools, sampleFrames } from './media.ts'

export type ComputeInit = Extract<UtilityMessage, { type: 'init' }>

function localPath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0'))
    throw new Error('expected an absolute local path')
}

function mediaRequest(p: Parameters<ComputeApi['visual']>[0]) {
  localPath(p.path)
  if (!Number.isSafeInteger(p.mediaId) || p.mediaId < 1)
    throw new Error('invalid media id')
  if (p.kind !== 'image' && p.kind !== 'video')
    throw new Error('invalid media kind')
  if (
    p.kind === 'video' &&
    !(
      typeof p.durationMs === 'number' &&
      Number.isFinite(p.durationMs) &&
      p.durationMs > 0
    )
  )
    throw new Error('video needs a finite duration')
}

export function createComputeApi(init: ComputeInit): ComputeApi {
  for (const path of [init.dataDir, init.modelsDir, init.ffmpeg, init.ffprobe])
    localPath(path)
  const paths = dataPaths(init.dataDir)
  const media = mediaTools(init)
  let imageEncoder: ReturnType<typeof loadImageEncoder> | undefined
  let speechEncoder: ReturnType<typeof loadSpeechEncoder> | undefined
  let sentenceEncoder: ReturnType<typeof loadSentenceEncoder> | undefined

  return {
    async probe(p) {
      localPath(p.path)
      return media.probe(p.path)
    },
    async thumb(p) {
      mediaRequest(p)
      const output = paths.thumb(p.mediaId)
      if (p.kind === 'image') {
        const { data, info } = await media.image(p.path)
        await mkdir(dirname(output), { recursive: true })
        await sharp(data, { raw: info })
          .resize(512, 512, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp()
          .toFile(output)
        return { sprite: null }
      }
      await media.poster(p.path, output)
      return {
        sprite: await media.sprite(
          p.path,
          p.durationMs as number,
          paths.sprite(p.mediaId),
        ),
      }
    },
    async visual(p) {
      mediaRequest(p)
      imageEncoder ??= loadImageEncoder(init.modelsDir)
      const encode = await imageEncoder
      if (p.kind === 'image') {
        const { data, info } = await media.image(p.path)
        return {
          generation: GENERATION.visual,
          scenes: [],
          samples: [
            {
              scene: -1,
              tMs: null,
              embedding: await encode(data, info.width, info.height),
            },
          ],
        }
      }
      const analysis = await media.analyze(p.path, p.durationMs as number)
      const samples = sampleFrames(analysis)
      const points = [...new Set(samples.map((sample) => sample.pts))].sort(
        (a, b) => a - b,
      )
      const frames = await media.extract(
        p.path,
        points,
        paths.frames(p.mediaId),
      )
      const vectors = new Map<number, Float32Array>()
      for (const [pts, frame] of frames) {
        const { data, info } = await media.image(frame.path)
        vectors.set(pts, await encode(data, info.width, info.height))
      }
      return {
        generation: GENERATION.visual,
        scenes: analysis.scenes,
        samples: samples.map((sample) => {
          const frame = frames.get(sample.pts)
          const embedding = vectors.get(sample.pts)
          if (!frame || !embedding)
            throw new Error('video changed between decode passes')
          return { scene: sample.scene, tMs: frame.ms, embedding }
        }),
      }
    },
    async speech(p) {
      localPath(p.path)
      if (!Number.isSafeInteger(p.mediaId) || p.mediaId < 1)
        throw new Error('invalid media id')
      const segments: SpeechResult['segments'] = []
      const metadata = await media.probe(p.path)
      if (!metadata.hasAudio) return { generation: GENERATION.speech, segments }
      const spans = await media.audio(p.path, metadata.durationMs as number)
      if (!spans.length) return { generation: GENERATION.speech, segments }
      speechEncoder ??= loadSpeechEncoder(init.modelsDir)
      sentenceEncoder ??= loadSentenceEncoder(init.modelsDir)
      const transcribe = await speechEncoder
      const sentence = await sentenceEncoder
      for (const span of spans) {
        for (const segment of await transcribe(span.samples)) {
          segments.push({
            ...segment,
            startMs: span.startMs + segment.startMs,
            endMs: span.startMs + segment.endMs,
            embedding: await sentence(segment.text),
          })
        }
      }
      return { generation: GENERATION.speech, segments }
    },
  }
}
