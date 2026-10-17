// internal contract between utility processes. catalog is the only db writer:
// it schedules jobs, calls compute over rpc, and writes the returned results.
import type { MediaId, MediaKind } from './api'

// bump a generation when its model, preprocessing, or segmentation changes.
// rows from older generations are ignored by search and re-enqueued by catalog.
export const GENERATION = { visual: 1, speech: 1 } as const

export type Probe = {
  kind: MediaKind
  width: number // after orientation
  height: number
  durationMs: number | null
  hasAudio: boolean // false for images
  takenAt: number | null // exif / container creation time, epoch ms
  codec: string | null
}

export type Sprite = { columns: number; rows: number; frames: number }

export type VisualResult = {
  generation: number
  // videos: scene windows in time order; images: empty
  scenes: { startMs: number; endMs: number }[]
  // l2-normalized clip image embeddings. images: one sample, scene -1, tMs null.
  samples: { scene: number; tMs: number | null; embedding: Float32Array }[]
}

export type SpeechResult = {
  generation: number
  // l2-normalized sentence embeddings of each segment's text
  segments: {
    startMs: number
    endMs: number
    language: string
    text: string
    embedding: Float32Array
  }[]
}

// compute utility rpc methods. compute writes thumbnail/sprite/frame files itself
// (paths from dataPaths in ./paths), returns everything else to catalog.
export type ComputeApi = {
  probe(p: { path: string }): Promise<Probe>
  thumb(p: {
    mediaId: MediaId
    path: string
    kind: MediaKind
    durationMs: number | null
  }): Promise<{ sprite: Sprite | null }>
  visual(p: {
    mediaId: MediaId
    path: string
    kind: MediaKind
    durationMs: number | null
  }): Promise<VisualResult>
  speech(p: { mediaId: MediaId; path: string }): Promise<SpeechResult>
}

// catalog -> search notification after each committed write batch.
export type CatalogChange = { removedMedia: MediaId[] }

// main -> utility handshake over process.parentPort: one 'init', then one 'port'
// message per peer with the MessagePortMain in event.ports[0].
export type Peer = 'main' | 'renderer' | 'catalog' | 'compute' | 'search'
export type UtilityMessage =
  | {
      type: 'init'
      dataDir: string // <userData>/library, layout in ./paths
      modelsDir: string
      ffmpeg: string
      ffprobe: string
    }
  | { type: 'port'; peer: Peer }

// query-time encoders, implemented in src/ml, used by the search utility.
export type TextEncoders = {
  clip(text: string): Promise<Float32Array> // same space as VisualResult samples
  sentence(text: string): Promise<Float32Array> // same space as SpeechResult segments
}
