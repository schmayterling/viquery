// biome-ignore-all lint/style/noNonNullAssertion: indices are bounded by count; live rows have a per-media slot list.
import { type Matrix, scan } from './scan.ts'

export type VectorRow = {
  id: number
  media_id: number
  scene_id: number | null
  start_ms: number | null
  end_ms: number
  text: string | null
  embedding: Uint8Array
}

export class Vectors implements Matrix {
  data: Float32Array = new Float32Array(0)
  ids = new Float64Array(0)
  mediaIds = new Float64Array(0)
  sceneIds = new Float64Array(0)
  startMs = new Float64Array(0)
  endMs = new Float64Array(0)
  text: (string | null)[] = []
  count = 0
  dimensions: number
  private dead = 0
  private slots = new Map<number, number[]>()

  constructor(dimensions: number) {
    this.dimensions = dimensions
  }

  reserve(capacity: number) {
    if (capacity <= this.ids.length) return
    for (const key of [
      'ids',
      'mediaIds',
      'sceneIds',
      'startMs',
      'endMs',
    ] as const) {
      const next = new Float64Array(capacity)
      next.set(this[key])
      this[key] = next
    }
    const data = new Float32Array(
      new SharedArrayBuffer(capacity * this.dimensions * 4),
    )
    data.set(this.data)
    this.data = data
  }

  append(row: VectorRow) {
    const { embedding } = row
    if (
      !(embedding instanceof Uint8Array) ||
      embedding.byteLength !== this.dimensions * 4
    ) {
      throw new Error(
        `invalid embedding for row ${row.id}: expected ${this.dimensions} float32 values`,
      )
    }
    const bytes = embedding.byteOffset % 4 === 0 ? embedding : embedding.slice()
    const vector = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      this.dimensions,
    )
    if (!vector.every(Number.isFinite))
      throw new Error(`nonfinite embedding for row ${row.id}`)
    if (this.count === this.ids.length)
      this.reserve(Math.max(16, Math.ceil(this.count * 1.25)))
    const i = this.count++
    this.data.set(vector, i * this.dimensions)
    this.ids[i] = row.id
    this.mediaIds[i] = row.media_id
    this.sceneIds[i] = row.scene_id ?? 0
    this.startMs[i] = row.start_ms ?? 0
    this.endMs[i] = row.end_ms
    this.text[i] = row.text
    const slots = this.slots.get(row.media_id) ?? []
    slots.push(i)
    this.slots.set(row.media_id, slots)
  }

  remove(mediaIds: Set<number>) {
    for (const id of mediaIds) {
      for (const i of this.slots.get(id) ?? []) {
        this.mediaIds[i] = 0
        this.text[i] = null
        this.dead++
      }
      this.slots.delete(id)
    }
    // Amortize compaction during indexing; queries skip tombstones immediately.
    if (this.dead && this.dead >= this.count / 4) this.compact()
  }

  private compact() {
    let live = 0
    this.slots.clear()
    for (let i = 0; i < this.count; i++) {
      const mediaId = this.mediaIds[i]!
      if (!mediaId) continue
      this.data.copyWithin(
        live * this.dimensions,
        i * this.dimensions,
        (i + 1) * this.dimensions,
      )
      for (const key of [
        'ids',
        'mediaIds',
        'sceneIds',
        'startMs',
        'endMs',
      ] as const)
        this[key][live] = this[key][i]!
      this.text[live] = this.text[i]!
      const slots = this.slots.get(mediaId) ?? []
      slots.push(live++)
      this.slots.set(mediaId, slots)
    }
    this.count = live
    this.text.length = live
    this.dead = 0
  }

  mask(media: Set<number>): Uint8Array {
    const mask = new Uint8Array(this.count)
    for (let i = 0; i < this.count; i++)
      mask[i] = Number(media.has(this.mediaIds[i]!))
    return mask
  }

  ranked(mediaId: number, query: Float32Array) {
    const slots = this.slots.get(mediaId) ?? []
    return scan(this, query, undefined, slots.length, slots)
  }

  queries(mediaId: number): Float32Array[] {
    return (this.slots.get(mediaId) ?? []).map((i) =>
      this.data.slice(i * this.dimensions, (i + 1) * this.dimensions),
    )
  }
}
