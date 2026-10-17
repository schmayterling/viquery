import { join, resolve, sep } from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  env,
  mean_pooling,
  pipeline,
  RawImage,
  Tensor as TransformersTensor,
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
  // whisper's own non-speech evidence, which transformers.js 4.3.1 does not expose: the
  // <|nocaptions|> probability right after <|startoftranscript|> (openai/whisper decoding.py
  // no_speech_prob; token ids are base.en's). launch.mp4 speech .017; sine tones .52-.56; pulsed beeps .17-.38.
  const noSpeech = async (audio: Float32Array) => {
    const { input_features } = await transcribe.processor(
      audio.subarray(0, 30 * 16000),
    )
    const { logits } = await transcribe.model({
      input_features,
      decoder_input_ids: new TransformersTensor(
        'int64',
        BigInt64Array.from([50257n]),
        [1, 1],
      ),
    })
    const scores = (logits.data as Float32Array).subarray(-logits.dims.at(-1))
    const max = Math.max(...scores)
    let total = 0
    for (const score of scores) total += Math.exp(score - max)
    return Math.exp((scores[50361] as number) - max) / total
  }
  return async (audio: Float32Array) => {
    // ponytail: one check per span (its first 30s); speech after 30s of non-speech without a
    // silence gap is dropped with it. upgrade: check each 30s chunk.
    if ((await noSpeech(audio)) > 0.5) return []
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
        // repetition loops ("BEEEE…"): openai/whisper compression_ratio_threshold 2.4
        Buffer.byteLength(text) / deflateSync(text).length > 2.4 ||
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs
      )
        return []
      return [{ startMs, endMs, text, language: 'en' }]
    })
  }
}
