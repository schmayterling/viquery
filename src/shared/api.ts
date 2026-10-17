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
  | { kind: 'recent' } // media first added (media.added_at) within the last 30 days
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
  ready: Uint8Array // 1 once thumb (and video sprite) exist; render a placeholder until then
  aspect: Float32Array // width / height after orientation; 1 until ready
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
  seekMs: number // playback position: best visual frame, speech segment start, or ocr frame pts
  frameMs: number // preview frame saved on disk (visual sample or ocr keyframe), via mediaUrl.frame
  sources: MatchSource[]
  snippet: string | null // matched speech or visible text
}

export type VideoHit = { mediaId: MediaId; moments: Moment[] } // moments in rank order

// one scene of a single video scored against a query, for the player timeline.
export type SceneMatch = Moment & {
  score: number // 0..1 relative to the other scenes of this video, for a heat strip
  match: boolean // clears the match bar: draw a marker, list it, include in [ / ] jumps
}
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
  | { phase: 'idle'; items: number; failed: number } // failed: jobs out of retries
  | { phase: 'scanning'; found: number }
  | {
      phase: 'thumbnails' | 'images' | 'videos' | 'speech' | 'text'
      done: number
      total: number
      etaMs: number | null
      paused: boolean
      failed: number
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
  searchVideo(id: MediaId, query: string): Promise<SceneMatch[]> // every scene, time order

  pauseIndexing(paused: boolean): Promise<void>
  onIndex(listener: (state: IndexPhase) => void): () => void
  onLibraryChanged(listener: () => void): () => void
}

// vq:// urls served by the main process protocol handler.
export const mediaUrl = {
  thumb: (id: MediaId) => `vq://thumb/${id}`,
  preview: (id: MediaId) => `vq://preview/${id}`,
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
