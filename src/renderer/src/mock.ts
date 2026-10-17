// dev-only in-memory ViqueryApi (VITE_MOCK=1). generated library, fake search and index progress,
// placeholder media as svg data urls plus one webcodecs-encoded clip, so the ui runs without a backend.
// url params: ?n=100000 item count, ?empty first-run state.
import {
  type Folder,
  type IndexPhase,
  type LibraryIndex,
  type MediaId,
  type MediaItem,
  mediaUrl,
  type Scene,
  type SearchResult,
  type ViqueryApi,
} from '../../shared/api'

const params = new URLSearchParams(location.search)
const N = Number(params.get('n') ?? 20_000)
let empty = params.has('empty')

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s: string) =>
  [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)

const FOLDERS: (Folder & { share: number })[] = [
  {
    id: 1,
    name: 'Camera Roll',
    path: '/Users/you/Pictures/Camera Roll',
    count: 0,
    state: 'online',
    share: 0.6,
  },
  {
    id: 2,
    name: 'Lisbon 2026',
    path: '/Users/you/Pictures/Lisbon 2026',
    count: 0,
    state: 'online',
    share: 0.06,
  },
  {
    id: 3,
    name: 'Lake house',
    path: '/Users/you/Movies/Lake house',
    count: 0,
    state: 'online',
    share: 0.12,
  },
  {
    id: 4,
    name: 'Drone footage',
    path: '/Volumes/Media/Drone footage',
    count: 0,
    state: 'online',
    share: 0.05,
  },
  {
    id: 5,
    name: 'Archive (T7)',
    path: '/Volumes/T7/Archive',
    count: 0,
    state: 'offline',
    share: 0.17,
  },
]
let folders = FOLDERS.map(({ share: _, ...f }) => f)

// columns for the whole library, newest first
const lib = {
  aspect: new Float32Array(N),
  kind: new Uint8Array(N),
  takenAt: new Float64Array(N),
  durationMs: new Uint32Array(N),
  folder: new Uint8Array(N),
}
{
  const r = rng(42)
  const IMAGE = [4 / 3, 4 / 3, 3 / 4, 3 / 2, 2 / 3, 16 / 9, 1, 9 / 19.5]
  const VIDEO = [16 / 9, 16 / 9, 16 / 9, 9 / 16, 4 / 3]
  let t = Date.now() - 3 * 3_600_000
  for (let i = 0; i < N; i++) {
    t -= r() < 0.85 ? r() * 4 * 3_600_000 : r() * 6 * 86_400_000
    const video = r() < 0.18
    lib.kind[i] = video ? 1 : 0
    lib.aspect[i] = (video ? VIDEO : IMAGE)[
      Math.floor(r() * (video ? VIDEO : IMAGE).length)
    ]!
    lib.takenAt[i] = t
    lib.durationMs[i] = video
      ? Math.round(r() < 0.7 ? 5_000 + r() * 175_000 : 180_000 + r() * 690_000)
      : 0
    let pick = r()
    for (const f of FOLDERS) {
      lib.folder[i] = f.id
      pick -= f.share
      if (pick < 0) break
    }
  }
  for (const f of folders) f.count = lib.folder.filter((x) => x === f.id).length
}
const idx = (id: MediaId) => id - 1
const recent = (i: number) => (i * 7919) % N < 214

function select(filter: Parameters<ViqueryApi['library']>[0]) {
  const live = new Set(folders.map((f) => f.id))
  const out: number[] = []
  if (empty) return out
  for (let i = 0; i < N; i++) {
    if (!live.has(lib.folder[i]!)) continue
    if (
      filter.scope.kind === 'folder' &&
      lib.folder[i]! !== filter.scope.folderId
    )
      continue
    if (filter.scope.kind === 'recent' && !recent(i)) continue
    if (
      filter.media !== 'all' &&
      lib.kind[i]! !== (filter.media === 'video' ? 1 : 0)
    )
      continue
    if (filter.takenFrom !== undefined && lib.takenAt[i]! < filter.takenFrom)
      continue
    if (filter.takenTo !== undefined && lib.takenAt[i]! >= filter.takenTo)
      continue
    out.push(i)
  }
  return out
}

function item(id: MediaId): MediaItem {
  const i = idx(id)
  const video = lib.kind[i]! === 1
  const folder = FOLDERS[lib.folder[i]! - 1]!
  const long = video ? 1920 : 4032
  const a = lib.aspect[i]!
  const n = String(1000 + (id % 9000)).padStart(4, '0')
  const name = video
    ? folder.id === 4
      ? `DJI_${n}.MP4`
      : `IMG_${n}.MOV`
    : a < 0.6
      ? `Screenshot ${n}.png`
      : `IMG_${n}.HEIC`
  return {
    id,
    kind: video ? 'video' : 'image',
    folderId: folder.id,
    name,
    path: `${folder.path}/${name}`,
    width: Math.round(a >= 1 ? long : long * a),
    height: Math.round(a >= 1 ? long / a : long),
    takenAt: lib.takenAt[i]!,
    durationMs: video ? lib.durationMs[i]! : null,
    bytes: Math.round(
      (video ? lib.durationMs[i]! * 1200 : 2_400_000) * (0.6 + (id % 7) / 10),
    ),
    sprite: video ? { columns: 10, rows: 5, frames: 50 } : null,
  }
}

function scenes(id: MediaId): Scene[] {
  const r = rng(id)
  const duration = lib.durationMs[idx(id)]!
  const out: Scene[] = []
  for (let s = 0; s < duration; ) {
    const e = Math.min(duration, s + 3_000 + Math.round(r() * 22_000))
    out.push({
      id: id * 1000 + out.length,
      startMs: s,
      endMs: e,
      frameMs: Math.round((s + e) / 2),
    })
    s = e
  }
  return out
}

// ---- index progress ----
const index = { done: 1284, total: 2538, paused: false, failed: 3 }
const indexListeners = new Set<(s: IndexPhase) => void>()
const changeListeners = new Set<() => void>()
const phase = (): IndexPhase =>
  index.done >= index.total
    ? { phase: 'idle', items: N, failed: index.failed }
    : {
        phase: 'videos',
        done: index.done,
        total: index.total,
        etaMs: (index.total - index.done) * 850,
        paused: index.paused,
        failed: index.failed,
      }
setInterval(() => {
  if (index.paused || index.done >= index.total) return
  index.done = Math.min(
    index.total,
    index.done + 1 + Math.floor(Math.random() * 3),
  )
  for (const l of indexListeners) l(phase())
}, 400)
const changed = () => {
  for (const l of changeListeners) l()
}

// ---- fake search ----
const later = <T>(v: T, ms = 40 + Math.random() * 60) =>
  new Promise<T>((r) => setTimeout(() => r(v), ms))

function search(
  query: string,
  filter: Parameters<ViqueryApi['search']>[1],
): SearchResult {
  const pending = { images: 0, videos: index.total - index.done }
  if (/giraffe|zz/i.test(query))
    return { query, images: [], videos: [], pending, tookMs: 31 }
  const r = rng(hash(query.toLowerCase()))
  const pool = select(filter)
  const pick = (kind: number, n: number) => {
    const out = new Set<number>()
    const candidates = pool.filter((i) => lib.kind[i]! === kind)
    for (
      let tries = 0;
      out.size < Math.min(n, candidates.length) && tries < n * 20;
      tries++
    )
      out.add(candidates[Math.floor(r() * candidates.length)]! + 1)
    return [...out]
  }
  const videos = pick(1, 2 + Math.floor(r() * 4)).map((mediaId) => {
    const all = scenes(mediaId)
    const want = 1 + Math.floor(r() * Math.min(3, all.length))
    const chosen = new Set<number>()
    while (chosen.size < want) chosen.add(Math.floor(r() * all.length))
    return {
      mediaId,
      moments: [...chosen].map((k) => {
        const s = all[k]!
        const speech = r() < 0.3
        return {
          sceneId: s.id,
          startMs: s.startMs,
          endMs: s.endMs,
          seekMs: s.frameMs,
          sources: speech
            ? (['visual', 'speech'] as const).slice()
            : (['visual'] as const).slice(),
          snippet: speech ? `…${query}…` : null,
        }
      }),
    }
  })
  const images = pick(0, 6 + Math.floor(r() * 14)).map((mediaId) => ({
    mediaId,
  }))
  return { query, images, videos, pending, tookMs: Math.round(30 + r() * 50) }
}

// ---- placeholder media: generated scenes, palettes after research/mockup.html ----
type Paint = (w: number, h: number, t: number, r: () => number) => string
const lin = (id: string, stops: string[], x2 = 0, y2 = 1) =>
  `<linearGradient id='${id}' x1='0' y1='0' x2='${x2}' y2='${y2}'>${stops.map((c, i) => `<stop offset='${i / (stops.length - 1)}' stop-color='${c}'/>`).join('')}</linearGradient>`
const glow = (id: string, c: string, o = 1) =>
  `<radialGradient id='${id}'><stop offset='0' stop-color='${c}' stop-opacity='${o}'/><stop offset='1' stop-color='${c}' stop-opacity='0'/></radialGradient>`
const rect =
  (fill: string, y = 0, h = 1, w = 1) =>
  (W: number, H: number) =>
    `<rect x='0' y='${y * H}' width='${w * W}' height='${h * H}' fill='${fill}'/>`
const disc =
  (fill: string, x: number, y: number, rr: number) => (W: number, H: number) =>
    `<ellipse cx='${x * W}' cy='${y * H}' rx='${rr * Math.min(W, H)}' ry='${rr * Math.min(W, H)}' fill='${fill}'/>`

const SCENES: Paint[] = [
  // sunset over water
  (W, H, t, r) => {
    const y = 0.48 + r() * 0.1
    return `<defs>${lin('s', ['#f3c58f', '#ec9b72', '#b7778a', '#6e7aa0'])}${lin('w', ['#3e6688', '#2a4c6b', '#1b3550'])}${glow('g', '#ffe2b0', 0.9)}</defs>${rect('url(#s)', 0, y)(W, H)}${disc('url(#g)', 0.3 + t * 0.4, y - 0.02, 0.2)(W, H)}${rect('url(#w)', y, 1 - y)(W, H)}`
  },
  // lake with dock
  (W, H, t, r) => {
    const y = 0.38 + r() * 0.08
    return `<defs>${lin('s', ['#bfe0ea', '#e4f0e6'])}${lin('w', ['#6aa3a8', '#2f6d76'])}</defs>${rect('url(#s)', 0, y)(W, H)}${rect('url(#w)', y, 1 - y)(W, H)}${rect('#6b4b34', y + 0.2 + t * 0.02, 0.035)(W, H)}`
  },
  // meadow with flowers
  (W, H, t, r) => {
    const y = 0.4 + r() * 0.1
    const flowers = ['#f6d1e3', '#fff1a8', '#f7b6c8', '#ffffff']
      .map((c, k) =>
        disc(
          c,
          0.15 + k * 0.2 + t * 0.03,
          y + 0.2 + ((k * 37) % 20) / 100,
          0.025,
        )(W, H),
      )
      .join('')
    return `<defs>${lin('s', ['#cfe3f2', '#e8f0e4'])}${lin('g', ['#8db06a', '#5f8a45'])}</defs>${rect('url(#s)', 0, y)(W, H)}${rect('url(#g)', y, 1 - y)(W, H)}${flowers}`
  },
  // night lights
  (W, H, t) =>
    `<defs>${lin('s', ['#121a33', '#25264a', '#3a2c48'])}${glow('a', '#ffd58a')}${glow('b', '#ff9a7a')}${glow('c', '#9fc4ff')}</defs>${rect('url(#s)')(W, H)}${disc('url(#a)', 0.22 + t * 0.1, 0.62, 0.1)(W, H)}${disc('url(#b)', 0.64, 0.55 - t * 0.05, 0.09)(W, H)}${disc('url(#c)', 0.8, 0.7, 0.12)(W, H)}${disc('url(#a)', 0.42, 0.48, 0.06)(W, H)}`,
  // dunes
  (W, H, t) =>
    `<defs>${lin('s', ['#9cc4de', '#e9d6b7'])}${lin('d', ['#e1b07b', '#cf9561'])}${lin('e', ['#c58b5a', '#a96c41'])}</defs>${rect('url(#s)')(W, H)}<polygon points='0,${0.5 * H} ${W},${(0.42 + t * 0.03) * H} ${W},${H} 0,${H}' fill='url(#d)'/><polygon points='0,${0.72 * H} ${W},${0.6 * H} ${W},${H} 0,${H}' fill='url(#e)'/>`,
  // fog
  (W, H) =>
    `<defs>${lin('s', ['#d6dadc', '#c4cacd', '#9aa6a8', '#7e8b8a'])}</defs>${rect('url(#s)')(W, H)}`,
  // warm interior
  (W, H, t) =>
    `<defs>${lin('s', ['#e9dccb', '#d8c5ae'], 1, 0)}${lin('f', ['#b98d63', '#8f6744'])}${glow('l', '#fff6e8')}</defs>${rect('url(#s)')(W, H)}${disc('url(#l)', 0.75 - t * 0.05, 0.3, 0.35)(W, H)}${rect('url(#f)', 0.64, 0.36)(W, H)}`,
  // teal sea
  (W, H, t) =>
    `<defs>${lin('s', ['#2f8f93', '#1b6b7a', '#134a5c'], 1, 1)}${glow('a', '#8fd1c8')}${glow('b', '#d9c79b')}</defs>${rect('url(#s)')(W, H)}${disc('url(#a)', 0.3 + t * 0.1, 0.4, 0.32)(W, H)}${disc('url(#b)', 0.7, 0.7 - t * 0.1, 0.24)(W, H)}`,
  // snow peaks
  (W, H) =>
    `<defs>${lin('s', ['#9fbfdc', '#d5e3ee', '#c3d0db'])}</defs>${rect('url(#s)')(W, H)}<polygon points='${0.05 * W},${H} ${0.35 * W},${0.42 * H} ${0.62 * W},${H}' fill='#eef2f5'/><polygon points='${0.35 * W},${0.42 * H} ${0.62 * W},${H} ${0.35 * W},${H}' fill='#b9c6d2'/><polygon points='${0.48 * W},${H} ${0.74 * W},${0.56 * H} ${W},${H}' fill='#dfe6ec'/>`,
  // candle
  (W, H, t) =>
    `<defs>${lin('s', ['#1c1410', '#2c1d15'])}${glow('f', '#ffcf86')}${glow('o', '#f59a4a', 0.8)}</defs>${rect('url(#s)')(W, H)}${disc('url(#o)', 0.5, 0.6, 0.45 + t * 0.03)(W, H)}${disc('url(#f)', 0.5, 0.58, 0.18)(W, H)}`,
  // swimmer
  (W, H, t, r) => {
    const y = 0.36 + r() * 0.06
    return `<defs>${lin('s', ['#a8d6f0', '#d7eef7'])}${lin('w', ['#3f9ab1', '#1f6c86'])}</defs>${rect('url(#s)', 0, y)(W, H)}${rect('url(#w)', y, 1 - y)(W, H)}${disc('#e9b993', 0.3 + t * 0.4, y + 0.2, 0.045)(W, H)}`
  },
  // forest
  (W, H, t) =>
    `<defs>${lin('s', ['#6f8f5a', '#3d5c3a', '#22382a'], 0.3, 1)}${glow('l', '#dbe8c9', 0.9)}</defs>${rect('url(#s)')(W, H)}${disc('url(#l)', 0.3 + t * 0.2, 0, 0.6)(W, H)}`,
]

function svg(id: MediaId, t: number, aspect: number) {
  const W = 400
  const H = Math.round(W / aspect)
  const r = rng(id * 31)
  const body = SCENES[id % SCENES.length]!(W, H, t, r)
  return { W, H, body }
}
const dataUrl = (s: string) => `data:image/svg+xml,${encodeURIComponent(s)}`
// scale sets the intrinsic size: originals are 5x the thumbnail, like a real photo
const doc = (W: number, H: number, body: string, scale = 1) =>
  `<svg xmlns='http://www.w3.org/2000/svg' width='${W * scale}' height='${H * scale}' viewBox='0 0 ${W} ${H}'>${body}</svg>`

const thumbs = new Map<MediaId, string>()
function thumb(id: MediaId) {
  let url = thumbs.get(id)
  if (!url) {
    const { W, H, body } = svg(id, 0.3, lib.aspect[idx(id)]!)
    url = dataUrl(doc(W, H, body))
    thumbs.set(id, url)
  }
  return url
}
const sprites = new Map<MediaId, string>()
function sprite(id: MediaId) {
  let url = sprites.get(id)
  if (!url) {
    const a = lib.aspect[idx(id)]!
    let W = 0
    let H = 0
    let cells = ''
    for (let f = 0; f < 50; f++) {
      const s = svg(id, f / 49, a)
      W = s.W
      H = s.H
      cells += `<svg x='${(f % 10) * W}' y='${Math.floor(f / 10) * H}' width='${W}' height='${H}'>${s.body.replaceAll("id='", `id='f${f}`).replaceAll('url(#', `url(#f${f}`)}</svg>`
    }
    url = dataUrl(doc(W * 10, H * 5, cells))
    sprites.set(id, url)
  }
  return url
}

// one seekable 15-minute clip (1 fps vp8 in a hand-built webm) shared by every mock video
async function clip(): Promise<string> {
  if (!('VideoEncoder' in window)) return ''
  const [w, h, seconds] = [320, 180, 900]
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  const chunks: { data: Uint8Array; ms: number; key: boolean }[] = []
  const encoder = new VideoEncoder({
    output: (c) => {
      const data = new Uint8Array(c.byteLength)
      c.copyTo(data)
      chunks.push({
        data,
        ms: Math.round(c.timestamp / 1000),
        key: c.type === 'key',
      })
    },
    error: (e) => console.warn('mock clip', e),
  })
  encoder.configure({
    codec: 'vp8',
    width: w,
    height: h,
    bitrate: 40_000,
    framerate: 1,
  })
  for (let s = 0; s < seconds; s++) {
    const p = s / seconds
    const sky = g.createLinearGradient(0, 0, 0, h * 0.42)
    sky.addColorStop(0, `hsl(${200 - p * 170} 55% ${80 - p * 10}%)`)
    sky.addColorStop(1, `hsl(${40 - p * 20} 70% 80%)`)
    g.fillStyle = sky
    g.fillRect(0, 0, w, h * 0.42)
    const sea = g.createLinearGradient(0, h * 0.42, 0, h)
    sea.addColorStop(0, '#3f9ab1')
    sea.addColorStop(1, '#1f6c86')
    g.fillStyle = sea
    g.fillRect(0, h * 0.42, w, h)
    g.fillStyle = '#e9b993'
    g.beginPath()
    g.arc(
      ((s * 7) % (w + 40)) - 20,
      h * 0.6 + Math.sin(s / 3) * 6,
      8,
      0,
      Math.PI * 2,
    )
    g.fill()
    const frame = new VideoFrame(canvas, {
      timestamp: s * 1_000_000,
      duration: 1_000_000,
    })
    encoder.encode(frame, { keyFrame: s % 10 === 0 })
    frame.close()
  }
  await encoder.flush()
  return URL.createObjectURL(
    new Blob([webm(chunks, w, h, seconds * 1000)], { type: 'video/webm' }),
  )
}

// minimal matroska: header, info, tracks, cues (before clusters, so no seek head is needed), one cluster per keyframe
function webm(
  chunks: { data: Uint8Array; ms: number; key: boolean }[],
  w: number,
  h: number,
  durationMs: number,
) {
  const cat = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }
  const be = (n: number, len: number) => {
    const b = new Uint8Array(len)
    for (let i = len - 1; i >= 0; i--, n = Math.floor(n / 256)) b[i] = n & 0xff
    return b
  }
  const id = (n: number) => be(n, Math.ceil(Math.log2(n + 1) / 8))
  const el = (n: number, ...parts: Uint8Array[]) => {
    const body = cat(parts)
    const size = be(body.length, 8)
    size[0] = size[0]! | 0x01
    return cat([id(n), size, body])
  }
  const u = (n: number, v: number) => el(n, be(v, 8))
  const str = (n: number, s: string) => el(n, new TextEncoder().encode(s))
  const f64 = (n: number, v: number) => {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v)
    return el(n, b)
  }
  const header = el(
    0x1a45dfa3,
    u(0x4286, 1),
    u(0x42f7, 1),
    u(0x42f2, 4),
    u(0x42f3, 8),
    str(0x4282, 'webm'),
    u(0x4287, 2),
    u(0x4285, 2),
  )
  const info = el(
    0x1549a966,
    u(0x2ad7b1, 1_000_000),
    f64(0x4489, durationMs),
    str(0x4d80, 'viquery-mock'),
    str(0x5741, 'viquery-mock'),
  )
  const tracks = el(
    0x1654ae6b,
    el(
      0xae,
      u(0xd7, 1),
      u(0x73c5, 1),
      u(0x83, 1),
      str(0x86, 'V_VP8'),
      el(0xe0, u(0xb0, w), u(0xba, h)),
    ),
  )
  const clusters: { ms: number; bytes: Uint8Array }[] = []
  let group: typeof chunks = []
  const flush = () => {
    if (!group.length) return
    const base = group[0]!.ms
    const blocks = group.map((c) =>
      el(
        0xa3,
        cat([
          Uint8Array.of(0x81),
          be(c.ms - base, 2),
          Uint8Array.of(c.key ? 0x80 : 0),
          c.data,
        ]),
      ),
    )
    clusters.push({ ms: base, bytes: el(0x1f43b675, u(0xe7, base), ...blocks) })
    group = []
  }
  for (const c of chunks) {
    if (c.key) flush()
    group.push(c)
  }
  flush()
  const cues = (positions: number[]) =>
    el(
      0x1c53bb6b,
      ...clusters.map((c, i) =>
        el(0xbb, u(0xb3, c.ms), el(0xb7, u(0xf7, 1), u(0xf1, positions[i]!))),
      ),
    )
  // cue sizes are fixed-width, so positions can be computed from a zero-filled draft
  let at = info.length + tracks.length + cues(clusters.map(() => 0)).length
  const positions = clusters.map((c) => {
    const p = at
    at += c.bytes.length
    return p
  })
  return cat([
    header,
    el(
      0x18538067,
      info,
      tracks,
      cues(positions),
      ...clusters.map((c) => c.bytes),
    ),
  ])
}

export async function install() {
  const video = await clip()
  mediaUrl.thumb = thumb
  mediaUrl.sprite = sprite
  mediaUrl.frame = (id, ms) => {
    const i = idx(id)
    const { W, H, body } = svg(
      id,
      lib.durationMs[i]! ? ms / lib.durationMs[i]! : 0,
      lib.aspect[i]!,
    )
    return dataUrl(doc(W, H, body))
  }
  mediaUrl.original = (id) => {
    if (lib.kind[idx(id)]) return video
    const { W, H, body } = svg(id, 0.3, lib.aspect[idx(id)]!)
    return dataUrl(doc(W, H, body, 5))
  }

  // what the macOS traffic lights occupy in the real window
  if (document.documentElement.dataset.platform === 'darwin')
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div aria-hidden="true" style="position:fixed;z-index:50;left:13px;top:14px;display:flex;gap:8px">${['#ff5f57', '#febc2e', '#28c840'].map((c) => `<i style="width:12px;height:12px;border-radius:50%;background:${c};box-shadow:inset 0 0 0 .5px rgb(0 0 0/12%)"></i>`).join('')}</div>`,
    )

  const api: ViqueryApi = {
    appInfo: () =>
      later({
        version: '0.1.0-mock',
        platform: document.documentElement.dataset.platform ?? 'darwin',
      }),
    folders: () => later(empty ? [] : folders.map((f) => ({ ...f }))),
    addFolder: async () => {
      if (!empty) return null
      empty = false
      changed()
      return later(folders[0] ?? null, 300)
    },
    removeFolder: async (id) => {
      folders = folders.filter((f) => f.id !== id)
      changed()
    },
    reveal: async (id) => console.info('mock reveal', item(id).path),
    library: (filter) => {
      const rows = select(filter)
      const out: LibraryIndex = {
        ids: Uint32Array.from(rows, (i) => i + 1),
        ready: new Uint8Array(rows.length).fill(1),
        aspect: Float32Array.from(rows, (i) => lib.aspect[i]!),
        kind: Uint8Array.from(rows, (i) => lib.kind[i]!),
        takenAt: Float64Array.from(rows, (i) => lib.takenAt[i]!),
        durationMs: Uint32Array.from(rows, (i) => lib.durationMs[i]!),
      }
      return later(out, 20)
    },
    items: (ids) => later(ids.map(item), 15),
    scenes: (id) => later(scenes(id)),
    transcript: () => later([]),
    search: (query, filter) => later(search(query, filter)),
    similar: (id, filter) => later(search(String(id), filter)),
    pauseIndexing: async (paused) => {
      index.paused = paused
      for (const l of indexListeners) l(phase())
    },
    onIndex: (listener) => {
      indexListeners.add(listener)
      listener(phase())
      return () => indexListeners.delete(listener)
    },
    onLibraryChanged: (listener) => {
      changeListeners.add(listener)
      return () => changeListeners.delete(listener)
    },
  }
  window.viquery = api
}
