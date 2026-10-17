import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import {
  type OrtInferenceSession,
  type OrtModule,
  PaddleOcrService,
} from 'paddleocr'
import { THREADS } from './runtime.ts'

const MODEL = 'snowfluke/ppu-paddle-ocr-models'

export async function loadOcrEncoder(modelsDir: string) {
  const buffer = async (file: string) => {
    const bytes = await readFile(join(modelsDir, MODEL, file))
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
  }
  // paddleocr 1.2 accepts the app's runtime; keep sessions on the shared CPU budget.
  // https://github.com/X3ZvaWQ/paddleocr.js#quick-ocr-example
  // ORT 1.30 metadata is a union; paddleocr types accept tensor metadata only.
  const ort: OrtModule = {
    Tensor: Tensor as OrtModule['Tensor'],
    InferenceSession: {
      create: async (model) =>
        (await InferenceSession.create(new Uint8Array(model), {
          executionProviders: ['cpu'],
          intraOpNumThreads: THREADS.compute,
          interOpNumThreads: 1,
          executionMode: 'sequential',
          graphOptimizationLevel: 'all',
          logSeverityLevel: 3,
        })) as unknown as OrtInferenceSession,
    },
  }
  const dictionary = (
    await readFile(join(modelsDir, MODEL, 'ppocrv5_dict.txt'), 'utf8')
  )
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
  dictionary.push(' ')
  const ocr = await PaddleOcrService.createInstance({
    ort,
    modelPreset: 'PP-OCRv5_mobile',
    detection: {
      modelBuffer: await buffer('PP-OCRv5_mobile_det_infer.onnx'),
      limitType: 'max',
      maxSideLength: 1600,
    },
    recognition: {
      modelBuffer: await buffer('PP-OCRv5_mobile_rec_infer.onnx'),
      charactersDictionary: dictionary,
    },
  })
  return async (data: Uint8Array, width: number, height: number) =>
    // recognize skips recognition inference when the detector finds no boxes.
    (await ocr.recognize({ data, width, height }))
      .filter((line) => line.confidence >= 0.5)
      .map((line) => line.text.trim())
      .filter(Boolean)
}
