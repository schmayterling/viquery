import { Play } from 'lucide-react'
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type Filter,
  type Folder,
  type LibraryIndex,
  type MediaId,
  type MediaItem,
  type Moment,
  mediaUrl,
  type SearchResult,
  type VideoHit,
} from '../../shared/api'
import { at, count, day, num, span, timecode } from './format'
import { Grid, hideBroken, type Open, showSprite } from './Grid'
import { ensureItems, getItem, useItemsVersion } from './items'

export type OpenHit = (
  ids: MediaId[],
  index: number,
  mode: Open,
  moments?: Map<MediaId, Moment[]>,
) => void

type State =
  | { key: string; result: SearchResult }
  | { key: string; error: string }

// debounced as-you-type search; stale responses are dropped by sequence (design §9.7)
export function useSearch(query: string, filter: Filter, version: number) {
  const [state, setState] = useState<State | null>(null)
  const seq = useRef(0)
  const q = query.trim()
  // media is filtered locally so the segmented control can show counts for both kinds
  const key = JSON.stringify([
    q,
    filter.scope,
    filter.takenFrom,
    filter.takenTo,
  ])
  // biome-ignore lint/correctness/useExhaustiveDependencies: key captures q and the filter fields that matter; version re-runs after library changes
  useEffect(() => {
    if (!q) {
      setState(null)
      return
    }
    const n = ++seq.current
    const timer = setTimeout(async () => {
      try {
        const result = await window.viquery.search(q, {
          ...filter,
          media: 'all',
        })
        await ensureItems([
          ...result.images.map((h) => h.mediaId),
          ...result.videos.map((h) => h.mediaId),
        ])
        if (n === seq.current) setState({ key, result })
      } catch (e) {
        if (n === seq.current)
          setState({ key, error: e instanceof Error ? e.message : String(e) })
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [key, version])
  return { state, stale: state !== null && state.key !== key }
}

export function summary(r: SearchResult, media: Filter['media']) {
  const moments = r.videos.reduce((n, v) => n + v.moments.length, 0)
  const parts = []
  if (media !== 'image' && r.videos.length)
    parts.push(
      `${count(moments, 'moment')} in ${count(r.videos.length, 'video')}`,
    )
  if (media !== 'video' && r.images.length)
    parts.push(count(r.images.length, 'image'))
  return parts.join(' · ')
}

export function Results(props: {
  result: SearchResult
  stale: boolean
  media: Filter['media']
  scrollRef: RefObject<HTMLDivElement | null>
  folders: Folder[]
  rowHeight: number
  square: boolean
  selection: Set<MediaId>
  onSelect: (s: Set<MediaId>) => void
  onOpen: OpenHit
  focusRequest: { id: MediaId } | null
}) {
  const { result, media } = props
  useItemsVersion()
  const videos = media === 'image' ? [] : result.videos
  const images = media === 'video' ? [] : result.images

  // rank-ordered images as a columnar list for the justified grid
  const list = useMemo<LibraryIndex>(() => {
    const items = images
      .map((h) => getItem(h.mediaId))
      .filter((i): i is MediaItem => !!i)
    return {
      ids: Uint32Array.from(items, (i) => i.id),
      ready: new Uint8Array(items.length).fill(1), // search hits are indexed, so thumbs exist
      aspect: Float32Array.from(items, (i) => i.width / i.height),
      kind: new Uint8Array(items.length),
      takenAt: Float64Array.from(items, (i) => i.takenAt),
      durationMs: new Uint32Array(items.length),
    }
  }, [images])
  const groups = useMemo(
    () => [{ label: 'Images', start: 0, end: list.ids.length }],
    [list],
  )
  const moments = useMemo(
    () => new Map(result.videos.map((v) => [v.mediaId, v.moments])),
    [result],
  )
  const videoIds = videos.map((v) => v.mediaId)

  return (
    <div className="results" data-stale={props.stale || undefined}>
      {videos.length > 0 && (
        <MomentList
          videos={videos}
          folders={props.folders}
          focusRequest={props.focusRequest}
          onOpen={(i, mode) => props.onOpen(videoIds, i, mode, moments)}
        />
      )}
      {list.ids.length > 0 && (
        <Grid
          list={list}
          groups={groups}
          rowHeight={Math.round(props.rowHeight * 0.88)}
          square={props.square}
          scrollRef={props.scrollRef}
          label="Matching images"
          selection={props.selection}
          onSelect={props.onSelect}
          onOpen={(i, mode) => props.onOpen([...list.ids], i, mode)}
          focusRequest={props.focusRequest}
        />
      )}
    </div>
  )
}

function MomentList(props: {
  videos: VideoHit[]
  folders: Folder[]
  focusRequest: { id: MediaId } | null
  onOpen: (index: number, mode: Open) => void
}) {
  const { videos, focusRequest } = props
  const [active, setActive] = useState(0)
  const [said, say] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const current = Math.min(active, videos.length - 1)
  const focus = (i: number) => {
    setActive(i)
    ref.current?.querySelectorAll<HTMLElement>('.moment')[i]?.focus()
  }
  useEffect(() => {
    const i = focusRequest
      ? videos.findIndex((v) => v.mediaId === focusRequest.id)
      : -1
    if (i < 0) return
    setActive(i)
    ref.current?.querySelectorAll<HTMLElement>('.moment')[i]?.focus()
  }, [focusRequest, videos])
  return (
    <section aria-label="Moments">
      <div className="section-head">
        <h2>Moments</h2>
        <span className="meta">{count(videos.length, 'video')}</span>
      </div>
      <div ref={ref} className="moments">
        {videos.map((v, i) => (
          <MomentCard
            key={v.mediaId}
            hit={v}
            folders={props.folders}
            tabIndex={i === current ? 0 : -1}
            onFocus={() => setActive(i)}
            onMove={(step) =>
              focus(Math.max(0, Math.min(videos.length - 1, i + step)))
            }
            onOpen={(mode) => props.onOpen(i, mode)}
            say={say}
          />
        ))}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </section>
  )
}

function MomentCard(props: {
  hit: VideoHit
  folders: Folder[]
  tabIndex: number
  onFocus: () => void
  onMove: (step: number) => void
  onOpen: (mode: Open) => void
  say: (s: string) => void
}) {
  const { hit } = props
  const item = getItem(hit.mediaId)
  const [cur, setCur] = useState(0)
  const m = at(hit.moments, Math.min(cur, hit.moments.length - 1))
  const duration = item?.durationMs ?? m.endMs
  const folder = props.folders.find((f) => f.id === item?.folderId)

  const show = (k: number, announce: boolean) => {
    setCur(k)
    const s = at(hit.moments, k)
    if (announce)
      props.say(
        `Scene ${k + 1} of ${hit.moments.length}, ${timecode(s.startMs)} to ${timecode(s.endMs)}`,
      )
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    const n = hit.moments.length
    if (e.key === ']' || e.key === '[')
      show((cur + (e.key === ']' ? 1 : n - 1)) % n, true)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
      props.onMove(e.key === 'ArrowRight' ? 1 : -1)
    else if (e.key === 'Enter') props.onOpen('viewer')
    else if (e.key === ' ') props.onOpen('quicklook')
    else return
    e.preventDefault()
  }
  // scrubbing the frame previews only the shown scene
  const scrub = (e: PointerEvent<HTMLElement>) => {
    if (!item?.sprite || !duration) return
    const el = e.currentTarget
    const t = (e.clientX - el.getBoundingClientRect().left) / el.clientWidth
    showSprite(
      el,
      hit.mediaId,
      item.sprite,
      (m.startMs + t * (m.endMs - m.startMs)) / duration,
      t,
    )
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: listitem with roving focus; the frame and markers are its controls
    <article
      className="moment"
      role="listitem"
      data-id={hit.mediaId}
      tabIndex={props.tabIndex}
      aria-label={`${item?.name ?? 'Video'}, ${count(hit.moments.length, 'matching scene')}, showing ${timecode(m.startMs)} to ${timecode(m.endMs)}`}
      onFocus={props.onFocus}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="frame"
        tabIndex={-1}
        aria-label={`Play from ${timecode(m.startMs)}`}
        onClick={() => props.onOpen('viewer')}
        onPointerEnter={() => ensureItems([hit.mediaId])}
        onPointerMove={scrub}
        onPointerLeave={(e) => e.currentTarget.removeAttribute('data-scrub')}
      >
        <img
          key={m.seekMs}
          src={mediaUrl.frame(hit.mediaId, m.frameMs)}
          alt=""
          decoding="async"
          draggable={false}
          onError={hideBroken}
        />
        <div className="sprite" />
        <div className="scrub">
          <span />
        </div>
        <span className="range">
          <Play aria-hidden="true" />
          {span(m.startMs, m.endMs)}
        </span>
      </button>
      {/* biome-ignore lint/a11y/useSemanticElements: markers on a time axis, not a fieldset */}
      <div
        className="timeline"
        role="group"
        aria-label={count(hit.moments.length, 'matching scene')}
      >
        {hit.moments.map((s, k) => (
          <button
            key={s.sceneId}
            type="button"
            tabIndex={-1}
            aria-label={`Play ${span(s.startMs, s.endMs)}`}
            aria-current={k === cur}
            style={{
              left: `${(s.startMs / duration) * 100}%`,
              width: `calc(${((s.endMs - s.startMs) / duration) * 100}% + 6px)`,
            }}
            onPointerEnter={() => show(k, false)}
            onClick={() => {
              show(k, false)
              props.onOpen('viewer')
            }}
          />
        ))}
      </div>
      <div className="title">
        <span className="name">{item?.name}</span>
        <span className="hits">{count(hit.moments.length, 'scene')}</span>
      </div>
      <div className="sub">
        {[
          folder?.name,
          item && day(item.takenAt),
          item && timecode(item.durationMs ?? 0),
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </article>
  )
}

export function NoResults(props: {
  query: string
  scoped: boolean
  dated: boolean
  hiddenByMedia: number
  pending: SearchResult['pending']
  onAllMedia: () => void
  onClearDates: () => void
  onShowAll: () => void
}) {
  const pending = props.pending.images + props.pending.videos
  return (
    <div className="empty">
      <div className="empty-body">
        <h2>No matches for “{props.query}”</h2>
        {pending > 0 && (
          <p>
            {[
              props.pending.images > 0 && count(props.pending.images, 'image'),
              props.pending.videos > 0 && count(props.pending.videos, 'video'),
            ]
              .filter(Boolean)
              .join(' and ')}{' '}
            {pending === 1 ? 'is' : 'are'} still being indexed. Matches from{' '}
            {pending === 1 ? 'it' : 'them'} will appear here as indexing
            finishes.
          </p>
        )}
        <div className="actions">
          {props.hiddenByMedia > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={props.onShowAll}
            >
              Show {num(props.hiddenByMedia)} other{' '}
              {props.hiddenByMedia === 1 ? 'result' : 'results'}
            </button>
          )}
          {props.scoped && (
            <button type="button" className="btn" onClick={props.onAllMedia}>
              Search all media
            </button>
          )}
          {props.dated && (
            <button type="button" className="btn" onClick={props.onClearDates}>
              Clear date filter
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
