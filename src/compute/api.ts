import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import sharp from 'sharp'
import {
  loadImageEncoder,
  loadSentenceEncoder,
  loadSpeechEncoder,
} from '../ml/index.ts'
import { loadOcrEncoder } from '../ml/ocr.ts'
import { dataPaths } from '../shared/paths.ts'
import {
  type ComputeApi,
  GENERATION,
  type OcrResult,
  type SpeechResult,
  type UtilityMessage,
  type VisualResult,
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
  let ocrEncoder: ReturnType<typeof loadOcrEncoder> | undefined

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
      const results: VisualResult['samples'] = []
      for (const sample of samples) {
        const frame = frames.get(sample.pts)
        const embedding = vectors.get(sample.pts)
        if (!frame || !embedding)
          throw new Error('video changed between decode passes')
        // a held frame also gets a frame file at the window start it represents
        if (sample.heldAt !== undefined)
          await copyFile(frame.path, paths.frame(p.mediaId, sample.heldAt))
        results.push({
          scene: sample.scene,
          tMs: sample.heldAt ?? frame.ms,
          embedding,
        })
      }
      return {
        generation: GENERATION.visual,
        scenes: analysis.scenes,
        samples: results,
      }
    },
    async ocr(p) {
      localPath(p.path)
      if (!Number.isSafeInteger(p.mediaId) || p.mediaId < 1)
        throw new Error('invalid media id')
      if (p.kind !== 'image' && p.kind !== 'video')
        throw new Error('invalid media kind')
      if (
        p.kind === 'video' &&
        (!Array.isArray(p.frameMs) ||
          !p.frameMs.every((ms) => Number.isSafeInteger(ms) && ms >= 0))
      )
        throw new Error('invalid OCR sample times')
      ocrEncoder ??= loadOcrEncoder(init.modelsDir)
      const recognize = await ocrEncoder
      const spans: OcrResult['spans'] = []
      const embeddings = new Map<string, Float32Array>()
      const scan = async (
        image: Awaited<ReturnType<typeof media.image>>,
        tMs: number | null,
      ) => {
        const texts = await recognize(
          image.data,
          image.info.width,
          image.info.height,
        )
        if (!texts.length) return
        sentenceEncoder ??= loadSentenceEncoder(init.modelsDir)
        const sentence = await sentenceEncoder
        for (const text of texts) {
          let embedding = embeddings.get(text)
          if (!embedding) {
            embedding = await sentence(text)
            embeddings.set(text, embedding)
          }
          spans.push({ tMs, text, embedding })
        }
      }
      if (p.kind === 'image') {
        const image = await media.image(p.path)
        await scan(
          await sharp(image.data, { raw: image.info })
            .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
            .raw()
            .toBuffer({ resolveWithObject: true }),
          null,
        )
      } else {
        const seen = new Set<number>()
        for (const ms of [...new Set(p.frameMs)].sort((a, b) => a - b)) {
          const frame = await media.ocrFrame(p.path, ms)
          if (seen.has(frame.ms)) continue
          seen.add(frame.ms)
          const spanCount = spans.length
          await scan(frame, frame.ms)
          if (spans.length === spanCount) continue
          // OCR moments may seek to a keyframe absent from the visual sample set.
          await mkdir(paths.frames(p.mediaId), { recursive: true })
          await sharp(frame.data, { raw: frame.info })
            .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
            .webp()
            .toFile(paths.frame(p.mediaId, frame.ms))
        }
      }
      return { generation: GENERATION.ocr, spans }
    },
    async speech(p) {
      localPath(p.path)
      if (!Number.isSafeInteger(p.mediaId) || p.mediaId < 1)
        throw new Error('invalid media id')
      const segments: SpeechResult['segments'] = []
      const metadata = await media.probe(p.path)
      if (!metadata.hasAudio) return { generation: GENERATION.speech, segments }
      for await (const span of media.audio(
        p.path,
        metadata.durationMs as number,
      )) {
        speechEncoder ??= loadSpeechEncoder(init.modelsDir)
        sentenceEncoder ??= loadSentenceEncoder(init.modelsDir)
        const transcribe = await speechEncoder
        const sentence = await sentenceEncoder
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
