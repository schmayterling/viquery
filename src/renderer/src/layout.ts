import justifiedLayout from 'justified-layout'
import type { LibraryIndex } from '../../shared/api'
import { month } from './format'

export const HEAD = 44
export const GAP = 4

export type Group = { label: string; start: number; end: number }
export type Row =
  | { kind: 'head'; top: number; height: number; group: number }
  | {
      kind: 'tiles'
      top: number
      height: number
      group: number
      start: number
      end: number
    }

// per-item geometry lives in typed arrays so 100k items cost no per-item objects after layout
export type Geometry = {
  rows: Row[]
  left: Float32Array
  width: Float32Array
  row: Uint32Array
  heads: number[] // row index of each group's head
  height: number
}

// month groups over takenAt; works for either sort direction
export function monthGroups(index: LibraryIndex): Group[] {
  const t = index.takenAt
  const groups: Group[] = []
  let start = 0
  let from = 0
  let to = -1
  for (let i = 0; i < t.length; i++) {
    const ti = t[i]!
    if (ti >= from && ti < to) continue
    if (i > 0) groups.push({ label: month(t[start]!), start, end: i })
    const d = new Date(ti)
    from = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    start = i
  }
  if (t.length) groups.push({ label: month(t[start]!), start, end: t.length })
  return groups
}

export function justify(
  aspect: ArrayLike<number>,
  groups: Group[],
  width: number,
  rowHeight: number,
  square: boolean,
): Geometry {
  const n = aspect.length
  const geo: Geometry = {
    rows: [],
    left: new Float32Array(n),
    width: new Float32Array(n),
    row: new Uint32Array(n),
    heads: [],
    height: 0,
  }
  let y = 0
  groups.forEach((g, group) => {
    geo.heads.push(geo.rows.length)
    geo.rows.push({ kind: 'head', top: y, height: HEAD, group })
    y += HEAD
    const { boxes, containerHeight } = justifiedLayout(
      Array.prototype.slice.call(aspect, g.start, g.end),
      {
        containerWidth: width,
        containerPadding: 0,
        boxSpacing: GAP,
        targetRowHeight: rowHeight,
        forceAspectRatio: square ? 1 : false,
      },
    )
    let current: Extract<Row, { kind: 'tiles' }> | undefined
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k]!
      const i = g.start + k
      if (!current || y + b.top !== current.top) {
        current = {
          kind: 'tiles',
          top: y + b.top,
          height: b.height,
          group,
          start: i,
          end: i,
        }
        geo.rows.push(current)
      }
      current.end = i + 1
      geo.left[i] = b.left
      geo.width[i] = b.width
      geo.row[i] = geo.rows.length - 1
    }
    y += containerHeight
  })
  geo.height = y
  return geo
}

// last row whose top is at or above y
export function rowAt(geo: Geometry, y: number) {
  let lo = 0
  let hi = geo.rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (geo.rows[mid]!.top <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

const center = (geo: Geometry, i: number) => geo.left[i]! + geo.width[i]! / 2

function nearestInRow(geo: Geometry, r: number, x: number) {
  const row = geo.rows[r]
  if (row?.kind !== 'tiles') return -1
  let best = row.start
  for (let i = row.start; i < row.end; i++) {
    if (Math.abs(center(geo, i) - x) < Math.abs(center(geo, best) - x)) best = i
  }
  return best
}

function tilesRow(geo: Geometry, r: number, step: 1 | -1) {
  for (; r >= 0 && r < geo.rows.length; r += step)
    if (geo.rows[r]!.kind === 'tiles') return r
  return -1
}

// design §7: arrows by row geometry (nearest x-center), not index ±n
export function move(
  geo: Geometry,
  i: number,
  key: string,
  viewport: number,
): number {
  const n = geo.left.length
  const x = center(geo, i)
  const r = geo.row[i]!
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, i - 1)
    case 'ArrowRight':
      return Math.min(n - 1, i + 1)
    case 'Home':
      return 0
    case 'End':
      return n - 1
    case 'ArrowUp':
    case 'ArrowDown': {
      const step = key === 'ArrowUp' ? -1 : 1
      const target = tilesRow(geo, r + step, step)
      return target < 0 ? i : nearestInRow(geo, target, x)
    }
    case 'PageUp':
    case 'PageDown': {
      const step = key === 'PageUp' ? -1 : 1
      const y = geo.rows[r]!.top + step * viewport
      const target = tilesRow(geo, rowAt(geo, Math.max(0, y)), step)
      return target < 0 ? (step < 0 ? 0 : n - 1) : nearestInRow(geo, target, x)
    }
  }
  return i
}
