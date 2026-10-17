import { useVirtualizer } from '@tanstack/react-virtual'
import { Check } from 'lucide-react'
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type LibraryIndex,
  type MediaId,
  type MediaItem,
  mediaUrl,
} from '../../shared/api'
import { at, longDay, num, timecode } from './format'
import { ensureItems, getItem, useItemsVersion } from './items'
import { type Geometry, type Group, HEAD, justify, move, rowAt } from './layout'

export type Open = 'viewer' | 'quicklook'

type Props = {
  list: LibraryIndex
  groups: Group[]
  rowHeight: number
  square: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  label: string
  sticky?: boolean
  selection: Set<MediaId>
  onSelect: (next: Set<MediaId>) => void
  onOpen: (index: number, mode: Open) => void
  focusRequest: { id: MediaId } | null
}

type Sprite = NonNullable<MediaItem['sprite']>

const NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

export function Grid(props: Props) {
  const {
    list,
    groups,
    rowHeight,
    square,
    scrollRef,
    selection,
    onSelect,
    onOpen,
  } = props
  const gridRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [margin, setMargin] = useState(0)
  const [active, setActive] = useState(0)
  const anchor = useRef(0)
  const focusToken = useRef(0)
  useItemsVersion()

  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    // relayout of 100k items costs ~30ms, so width changes settle first (sidebar
    // animation, window drag) instead of re-justifying every frame
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setWidth(el.clientWidth), 120)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => {
      ro.disconnect()
      clearTimeout(timer)
    }
  }, [])
  // offset of the grid inside a shared scroller (search puts moments above it)
  useLayoutEffect(() => {
    const top = gridRef.current?.offsetTop ?? 0
    if (top !== margin) setMargin(top)
  })

  const geo = useMemo(
    () => justify(list.aspect, groups, Math.max(width, 1), rowHeight, square),
    [list, groups, width, rowHeight, square],
  )
  const size = useCallback(
    (r: number) => (geo.rows[r + 1]?.top ?? geo.height) - at(geo.rows, r).top,
    [geo],
  )
  // a new key fn identity makes the virtualizer drop cached sizes when geometry changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity must follow geo
  const key = useCallback((r: number) => r, [geo])
  const v = useVirtualizer({
    count: width ? geo.rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: size,
    getItemKey: key,
    overscan: 3,
    scrollMargin: margin,
  })
  const rows = v.getVirtualItems()

  // hover effects pause while scrolling (design §9.5)
  useEffect(() => {
    scrollRef.current?.toggleAttribute('data-scrolling', v.isScrolling)
  }, [v.isScrolling, scrollRef])

  // names for aria labels and sprites for scrub: only for what is on screen
  const first = rows[0]?.index ?? 0
  const last = rows[rows.length - 1]?.index ?? -1
  useEffect(() => {
    if (v.isScrolling || last < 0) return
    const ids: MediaId[] = []
    for (let r = first; r <= last; r++) {
      const row = at(geo.rows, r)
      if (row.kind === 'tiles')
        for (let i = row.start; i < row.end; i++) ids.push(at(list.ids, i))
    }
    ensureItems(ids)
  }, [first, last, geo, list, v.isScrolling])

  const n = list.ids.length
  const current = Math.min(active, Math.max(0, n - 1))

  const reveal = useCallback(
    (i: number) => {
      const scroller = scrollRef.current
      if (!scroller) return
      const row = at(geo.rows, at(geo.row, i))
      const top = margin + row.top
      const pad = props.sticky ? HEAD : 0
      if (top - pad < scroller.scrollTop) scroller.scrollTop = top - pad
      else if (top + row.height > scroller.scrollTop + scroller.clientHeight)
        scroller.scrollTop = top + row.height - scroller.clientHeight + 16
    },
    [geo, margin, scrollRef, props.sticky],
  )

  // focus lands once the target row is mounted; a far jump needs a scroll-driven render first
  const focusTile = useCallback(
    (i: number) => {
      setActive(i)
      reveal(i)
      const token = ++focusToken.current
      let frames = 0
      const attempt = () => {
        if (token !== focusToken.current) return
        const el = gridRef.current?.querySelector<HTMLElement>(
          `[data-index="${i}"]`,
        )
        if (el) el.focus({ preventScroll: true })
        else if (frames++ < 30) requestAnimationFrame(attempt)
      }
      attempt()
    },
    [reveal],
  )

  const { focusRequest } = props
  useEffect(() => {
    if (!focusRequest) return
    const i = list.ids.indexOf(focusRequest.id)
    if (i < 0) return
    anchor.current = i
    focusTile(i)
  }, [focusRequest, list, focusTile])

  const selectRange = (from: number, to: number, add: boolean) => {
    const next = new Set(add ? selection : [])
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++)
      next.add(at(list.ids, i))
    onSelect(next)
  }

  const onPointerDown = (e: PointerEvent, i: number) => {
    if (e.button !== 0) return
    const id = at(list.ids, i)
    setActive(i)
    if (e.shiftKey)
      return selectRange(anchor.current, i, e.metaKey || e.ctrlKey)
    anchor.current = i
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selection)
      if (!next.delete(id)) next.add(id)
      onSelect(next)
    } else if (!selection.has(id) || selection.size > 1) onSelect(new Set([id]))
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!n) return
    const mod = e.metaKey || e.ctrlKey
    if (NAV_KEYS.has(e.key) && !(mod && e.key === 'ArrowDown')) {
      e.preventDefault()
      const next = move(
        geo,
        current,
        e.key,
        scrollRef.current?.clientHeight ?? 600,
      )
      if (e.shiftKey) selectRange(anchor.current, next, false)
      else anchor.current = next
      focusTile(next)
    } else if (e.key === 'Enter' || (mod && e.key === 'ArrowDown')) {
      e.preventDefault()
      onOpen(current, 'viewer')
    } else if (e.key === ' ') {
      e.preventDefault()
      onOpen(current, 'quicklook')
    } else if (mod && e.key === 'a') {
      e.preventDefault()
      onSelect(new Set(list.ids))
    } else if (e.key === 'Escape' && selection.size) {
      e.stopPropagation()
      onSelect(new Set())
    }
  }

  const activeMounted = rows.some((r) => {
    const row = at(geo.rows, r.index)
    return row.kind === 'tiles' && current >= row.start && current < row.end
  })

  // the group the viewport is in, pushed up by the next head (design §6.1)
  let stuck = null
  if (props.sticky && geo.rows.length && width) {
    const y = Math.max(0, (v.scrollOffset ?? 0) - margin)
    const row = at(geo.rows, rowAt(geo, y))
    const next = geo.heads[row.group + 1]
    const push =
      next === undefined ? 0 : Math.min(0, at(geo.rows, next).top - y - HEAD)
    stuck = (
      <div className="sticky" aria-hidden="true">
        <GroupHead
          group={at(groups, row.group)}
          style={{ translate: `0 ${push}px` }}
        />
      </div>
    )
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a virtualized justified grid has no native element
    <div
      ref={gridRef}
      className="grid"
      role="grid"
      aria-label={props.label}
      aria-rowcount={geo.rows.length}
      aria-multiselectable="true"
      tabIndex={activeMounted ? -1 : 0}
      style={{ height: width ? geo.height : undefined }}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target !== e.currentTarget || !rows.length) return
        const row = geo.rows.find(
          (r, k) => k >= at(rows, 0).index && r.kind === 'tiles',
        )
        if (row?.kind === 'tiles')
          focusTile(activeMounted ? current : row.start)
      }}
    >
      {stuck}
      {rows.map((vr) => {
        const row = at(geo.rows, vr.index)
        return (
          // biome-ignore lint/a11y/useFocusableInteractive: rows hold the focusable cells
          // biome-ignore lint/a11y/useSemanticElements: absolutely positioned virtual rows, not a table
          <div
            key={vr.key}
            role="row"
            aria-rowindex={vr.index + 1}
            className="grid-row"
            style={{
              transform: `translateY(${row.top}px)`,
              height: row.height,
            }}
          >
            {row.kind === 'head' ? (
              <GroupHead group={at(groups, row.group)} role="rowheader" />
            ) : (
              tiles(row.start, row.end, (i) => (
                <Tile
                  key={at(list.ids, i)}
                  list={list}
                  geo={geo}
                  index={i}
                  eager={vr.index < 6}
                  active={i === current}
                  selected={selection.has(at(list.ids, i))}
                  onPointerDown={(e) => onPointerDown(e, i)}
                  onDoubleClick={() => onOpen(i, 'viewer')}
                />
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}

const tiles = <T,>(start: number, end: number, f: (i: number) => T) => {
  const out: T[] = []
  for (let i = start; i < end; i++) out.push(f(i))
  return out
}

function GroupHead(props: {
  group: Group
  role?: string
  style?: React.CSSProperties
}) {
  const { group } = props
  return (
    <div className="group-head" role={props.role} style={props.style}>
      <h2>{group.label}</h2>
      <span className="meta">{num(group.end - group.start)}</span>
    </div>
  )
}

// shows sprite frame at `at` (0..1 of the video) inside el's .sprite, playhead at `bar`
export function showSprite(
  el: HTMLElement,
  id: MediaId,
  sprite: Sprite,
  at: number,
  bar: number,
) {
  const sheet = el.querySelector<HTMLElement>('.sprite')
  const head = el.querySelector<HTMLElement>('.scrub > span')
  if (!sheet || !head) return
  const f = Math.min(
    sprite.frames - 1,
    Math.max(0, Math.floor(at * sprite.frames)),
  )
  const col = f % sprite.columns
  const row = Math.floor(f / sprite.columns)
  const pos = (k: number, n: number) => (n > 1 ? (k / (n - 1)) * 100 : 0)
  sheet.style.backgroundImage = `url("${mediaUrl.sprite(id)}")`
  sheet.style.backgroundSize = `${sprite.columns * 100}% ${sprite.rows * 100}%`
  sheet.style.backgroundPosition = `${pos(col, sprite.columns)}% ${pos(row, sprite.rows)}%`
  head.style.transform = `scaleX(${bar})`
  el.setAttribute('data-scrub', '')
}

// broken thumbnails and frames fall back to the --tile fill, never the broken-image glyph
export const hideBroken = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.visibility = 'hidden'
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

type TileProps = {
  list: LibraryIndex
  geo: Geometry
  index: number
  eager: boolean
  active: boolean
  selected: boolean
  onPointerDown: (e: PointerEvent) => void
  onDoubleClick: () => void
}

function Tile({
  list,
  geo,
  index: i,
  eager,
  active,
  selected,
  ...handlers
}: TileProps) {
  const id = at(list.ids, i)
  const video = list.kind[i] === 1
  const duration = at(list.durationMs, i)
  const item = getItem(id)
  // no thumbnail until the catalog marks it ready; a failed load keeps the tile fill and
  // retries with the next index (refetched after every thumb job)
  const [failed, setFailed] = useState<LibraryIndex | null>(null)
  const ready = list.ready[i] === 1 && failed !== list
  const mounted = useRef(performance.now())
  const label = [
    item?.name,
    video ? (duration ? `video, ${timecode(duration)}` : 'video') : 'image',
    longDay(at(list.takenAt, i)),
  ]
    .filter(Boolean)
    .join(', ')

  // hover scrub: pointer x picks a sprite frame. styles are written directly, no re-render per move.
  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    if (!item?.sprite) return
    const el = e.currentTarget
    const t = Math.min(
      1,
      Math.max(
        0,
        (e.clientX - el.getBoundingClientRect().left) / el.clientWidth,
      ),
    )
    showSprite(el, id, item.sprite, t, t)
    const time = el.querySelector<HTMLElement>('.scrub-time')
    if (time) time.textContent = timecode(t * duration)
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: absolutely positioned justified cells, not a table
    <div
      role="gridcell"
      className="tile"
      data-index={i}
      data-kind={video ? 'video' : 'image'}
      tabIndex={active ? 0 : -1}
      aria-selected={selected}
      aria-label={label}
      style={{ left: at(geo.left, i), width: at(geo.width, i) }}
      onPointerDown={handlers.onPointerDown}
      onDoubleClick={handlers.onDoubleClick}
      onPointerEnter={video ? () => ensureItems([id]) : undefined}
      onPointerMove={video ? scrub : undefined}
      onPointerLeave={
        video ? (e) => e.currentTarget.removeAttribute('data-scrub') : undefined
      }
    >
      {ready && (
        <img
          src={mediaUrl.thumb(id)}
          alt=""
          decoding="async"
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          draggable={false}
          onLoad={(e) => {
            // fade only late arrivals; instant ones would flicker while scrolling fast (design §9.3)
            if (e.timeStamp - mounted.current > 100 && !reducedMotion.matches)
              e.currentTarget.animate(
                { opacity: [0, 1] },
                { duration: 160, easing: 'ease-out' },
              )
          }}
          onError={() => setFailed(list)}
        />
      )}
      {video && (
        <>
          <div className="sprite" />
          <div className="scrub">
            <span />
          </div>
          <span className="scrub-time" />
          {duration > 0 && <span className="dur">{timecode(duration)}</span>}
        </>
      )}
      {selected && (
        <span className="check">
          <Check aria-hidden="true" />
        </span>
      )}
    </div>
  )
}
