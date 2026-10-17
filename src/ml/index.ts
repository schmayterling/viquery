import { join, resolve, sep } from 'node:path'
import {
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  env,
  mean_pooling,
  pipeline,
  RawImage,
} from '@huggingface/transformers'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import type { TextEncoders } from '../shared/protocol.ts'
import { THREADS } from './runtime.ts'

const CLIP = 'Xenova/clip-vit-base-patch32'
const WHISPER = 'onnx-community/whisper-base.en'
const SENTENCE = 'Xenova/all-MiniLM-L6-v2'
const sessionOptions = (threads: number): InferenceSession.SessionOptions => ({
  executionProviders: ['cpu'],
  intraOpNumThreads: threads,
  interOpNumThreads: 1,
  executionMode: 'sequential',
  graphOptimizationLevel: 'all',
  logSeverityLevel: 3,
})

function localModels(modelsDir: string) {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = resolve(modelsDir) + sep
  env.useFSCache = false
  env.useBrowserCache = false
}

function unitVector(data: unknown, dimensions: number): Float32Array {
  if (!(data instanceof Float32Array) || data.length !== dimensions)
    throw new Error('unexpected embedding dimensions')
  const vector = Float32Array.from(data)
  let squared = 0
  for (const value of vector) squared += value * value
  if (!(squared > 0) || !Number.isFinite(squared))
    throw new Error('invalid model embedding')
  const norm = Math.sqrt(squared)
  return vector.map((value) => value / norm)
}

export async function loadClipTextEncoder(
  modelsDir: string,
  threads: number = THREADS.search,
) {
  localModels(modelsDir)
  const tokenizer = await AutoTokenizer.from_pretrained(CLIP, {
    local_files_only: true,
  })
  const session = await InferenceSession.create(
    join(modelsDir, CLIP, 'onnx/text_model_int8.onnx'),
    sessionOptions(threads),
  )
  return async (text: string) => {
    const tokens = tokenizer(text, {
      padding: 'max_length',
      truncation: true,
      max_length: 77,
    })
    const feeds: Record<string, Tensor> = {}
    for (const name of session.inputNames) {
      const token = tokens[name as keyof typeof tokens]
      if (!token) throw new Error(`missing model input ${name}`)
      feeds[name] = new Tensor('int64', token.data as BigInt64Array, token.dims)
    }
    const result = await session.run(feeds)
    return unitVector(result.text_embeds?.data, 512)
  }
}

export async function loadSentenceEncoder(
  modelsDir: string,
  threads: number = THREADS.compute,
) {
  localModels(modelsDir)
  const tokenizer = await AutoTokenizer.from_pretrained(SENTENCE, {
    local_files_only: true,
  })
  const model = await AutoModel.from_pretrained(SENTENCE, {
    device: 'cpu',
    dtype: 'q8',
    local_files_only: true,
    session_options: sessionOptions(threads),
  })
  return async (text: string) => {
    const tokens = tokenizer(text, {
      padding: true,
      truncation: true,
      max_length: 256,
    })
    const output = await model(tokens)
    const pooled = mean_pooling(output.last_hidden_state, tokens.attention_mask)
    return unitVector(pooled.data as Float32Array, 384)
  }
}

export async function loadTextEncoders(
  modelsDir: string,
): Promise<TextEncoders> {
  localModels(modelsDir)
  const clip = await loadClipTextEncoder(modelsDir)
  const sentence = await loadSentenceEncoder(modelsDir, THREADS.search)
  return { clip, sentence }
}

export async function loadImageEncoder(modelsDir: string) {
  localModels(modelsDir)
  const processor = await AutoProcessor.from_pretrained(CLIP, {
    local_files_only: true,
  })
  const session = await InferenceSession.create(
    join(modelsDir, CLIP, 'onnx/vision_model_int8.onnx'),
    sessionOptions(THREADS.compute),
  )
  return async (data: Uint8Array, width: number, height: number) => {
    const { pixel_values: pixels } = await processor(
      new RawImage(data, width, height, 3),
    )
    const result = await session.run({
      pixel_values: new Tensor(
        'float32',
        pixels.data as Float32Array,
        pixels.dims,
      ),
    })
    return unitVector(result.image_embeds?.data, 512)
  }
}

export async function loadSpeechEncoder(modelsDir: string) {
  localModels(modelsDir)
  const transcribe = await pipeline('automatic-speech-recognition', WHISPER, {
    device: 'cpu',
    dtype: 'q8',
    local_files_only: true,
    session_options: sessionOptions(THREADS.compute),
  })
  return async (audio: Float32Array) => {
    const output = await transcribe(audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      num_beams: 1,
      do_sample: false,
    })
    if (Array.isArray(output))
      throw new Error('unexpected batched transcription')
    const durationMs = Math.round(audio.length / 16)
    return (output.chunks ?? []).flatMap((chunk) => {
      const text = chunk.text.trim()
      const startMs = Math.max(0, Math.round(chunk.timestamp[0] * 1000))
      const endMs = Math.min(
        durationMs,
        Math.round((chunk.timestamp[1] ?? durationMs / 1000) * 1000),
      )
      if (
        !text ||
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs
      )
        return []
      return [{ startMs, endMs, text, language: 'en' }]
    })
  }
}
