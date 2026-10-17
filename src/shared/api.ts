// renderer-facing contract. preload exposes exactly ViqueryApi as window.viquery.
// media bytes never cross ipc: the renderer loads them through vq:// urls (see mediaUrl).

export type MediaKind = 'image' | 'video'
export type MediaId = number
export type FolderId = number
export type SceneId = number

export type AppInfo = { version: string; platform: string }

export type Folder = {
  id: FolderId
  path: string
  name: string
  count: number
  state: 'online' | 'offline'
}

export type Scope =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'folder'; folderId: FolderId }

export type Filter = {
  scope: Scope
  media: 'all' | MediaKind
  // epoch ms, inclusive start / exclusive end
  takenFrom?: number
  takenTo?: number
}

// columnar so 100k items lay out (justified rows) without per-item objects.
// index i describes one item across all arrays. sorted newest first.
export type LibraryIndex = {
  ids: Uint32Array
  aspect: Float32Array // width / height after orientation
  kind: Uint8Array // 0 image, 1 video
  takenAt: Float64Array // epoch ms
  durationMs: Uint32Array // 0 for images
}

export type MediaItem = {
  id: MediaId
  kind: MediaKind
  folderId: FolderId
  name: string
  path: string
  width: number
  height: number
  takenAt: number
  durationMs: number | null
  bytes: number
  // videos only: sprite sheet for hover scrub, null until generated
  sprite: { columns: number; rows: number; frames: number } | null
}

export type Scene = {
  id: SceneId
  startMs: number
  endMs: number
  frameMs: number // representative frame, see mediaUrl.frame
}

export type TranscriptSegment = {
  startMs: number
  endMs: number
  text: string
  language: string
}

// why a moment matched. a moment can match on more than one signal.
export type MatchSource = 'visual' | 'speech' | 'text'

export type Moment = {
  sceneId: SceneId
  startMs: number
  endMs: number
  seekMs: number // best matching frame time; also its thumbnail via mediaUrl.frame
  sources: MatchSource[]
  snippet: string | null // matched transcript text, if speech matched
}

export type VideoHit = { mediaId: MediaId; moments: Moment[] } // moments in rank order
export type ImageHit = { mediaId: MediaId }

export type SearchResult = {
  query: string
  images: ImageHit[] // rank order
  videos: VideoHit[] // rank order
  // indexing incomplete: results may grow
  pending: { images: number; videos: number }
  tookMs: number
}

export type IndexPhase =
  | { phase: 'idle'; items: number }
  | { phase: 'scanning'; found: number }
  | {
      phase: 'thumbnails' | 'images' | 'videos' | 'speech'
      done: number
      total: number
      etaMs: number | null
      paused: boolean
    }

export type ViqueryApi = {
  appInfo(): Promise<AppInfo>

  folders(): Promise<Folder[]>
  addFolder(): Promise<Folder | null> // opens native picker; null when cancelled
  removeFolder(id: FolderId): Promise<void>
  reveal(id: MediaId): Promise<void>

  library(filter: Filter): Promise<LibraryIndex>
  items(ids: MediaId[]): Promise<MediaItem[]>
  scenes(id: MediaId): Promise<Scene[]>
  transcript(id: MediaId): Promise<TranscriptSegment[]>

  search(query: string, filter: Filter): Promise<SearchResult>
  similar(id: MediaId, filter: Filter): Promise<SearchResult>

  pauseIndexing(paused: boolean): Promise<void>
  onIndex(listener: (state: IndexPhase) => void): () => void
  onLibraryChanged(listener: () => void): () => void
}

// vq:// urls served by the main process protocol handler.
export const mediaUrl = {
  thumb: (id: MediaId) => `vq://thumb/${id}`,
  sprite: (id: MediaId) => `vq://sprite/${id}`,
  frame: (id: MediaId, ms: number) => `vq://frame/${id}/${ms}`,
  original: (id: MediaId) => `vq://media/${id}`,
}

export const CHANNELS = {
  appInfo: 'app:info',
  addFolder: 'app:add-folder',
  reveal: 'app:reveal',
  ports: 'app:ports',
} as const
