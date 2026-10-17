import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Info,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type Folder,
  type MediaId,
  type MediaItem,
  type Moment,
  mediaUrl,
} from '../../shared/api'
import { at, bytes, longDay, num, timecode } from './format'
import type { Open } from './Grid'
import { ensureItems, getItem, useItemsVersion } from './items'
import { OriginalImage, QuickVideo } from './Media'
import { Player } from './Player'

export type ViewerState = {
  mode: Open
  ids: ArrayLike<MediaId>
  index: number
  moments?: Map<MediaId, Moment[]> | undefined
  query?: string | undefined
  selected?: Moment | undefined
}

type Props = ViewerState & {
  folders: Folder[]
  onChange: (next: ViewerState) => void
  onClose: (id: MediaId) => void
}

const revealLabel = () =>
  ({ darwin: 'Show in Finder', win32: 'Show in Explorer' })[
    document.documentElement.dataset.platform ?? ''
  ] ?? 'Show in folder'

export function Viewer(props: Props) {
  const id = at(props.ids, props.index)
  const version = useItemsVersion()
  // biome-ignore lint/correctness/useExhaustiveDependencies: version refetches items a library change marked stale
  useEffect(() => {
    // neighbours too, so arrowing is instant
    ensureItems(
      [props.ids[props.index - 1], id, props.ids[props.index + 1]].filter(
        (x) => x !== undefined,
      ),
    )
  }, [props.ids, props.index, id, version])
  const item = getItem(id)
  const ref = useRef<HTMLDivElement>(null)
  // the video player takes keyboard focus itself (its shortcuts need it); otherwise the viewer
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the mode or item changes
  useEffect(() => {
    const target =
      ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current
    target?.focus({ preventScroll: true })
  }, [props.mode, id, item !== undefined])

  const go = (step: number) => {
    const index = props.index + step
    if (index >= 0 && index < props.ids.length)
      props.onChange({ ...props, index, selected: undefined })
  }
  const moments = props.query ? props.moments?.get(id) : undefined
  const selected = props.selected ?? moments?.[0]
  const folder = props.folders.find((f) => f.id === item?.folderId)
  const [info, setInfo] = useInfo()

  useEffect(() => {
    if (props.mode !== 'quicklook') return
    const close = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input,select,textarea')) return
      if (e.key !== 'Escape' && e.key !== ' ') return
      e.preventDefault()
      e.stopPropagation()
      props.onClose(id)
    }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [props.mode, props.onClose, id])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).matches('input, select')) return
    const mode = props.mode
    if (e.key === 'Escape' || (mode === 'quicklook' && e.key === ' '))
      props.onClose(id)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      go(e.key === 'ArrowLeft' ? -1 : 1)
    else if (mode === 'quicklook' && e.key === 'Enter')
      props.onChange({ ...props, mode: 'viewer' })
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  if (props.mode === 'quicklook')
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes quick look
      <div
        ref={ref}
        className="quicklook"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.target === e.currentTarget && props.onClose(id)}
      >
        <figure role="dialog" aria-label={`Quick look: ${item?.name ?? ''}`}>
          <div className="media">
            {item?.kind === 'video' ? (
              <QuickVideo
                key={id}
                item={item}
                folder={folder}
                start={selected?.startMs ?? 0}
              />
            ) : (
              item && <OriginalImage key={id} item={item} folder={folder} />
            )}
          </div>
          <figcaption>
            <span>{item?.name}</span>
            <span>
              <kbd className="kbd">esc</kbd>
            </span>
          </figcaption>
        </figure>
      </div>
    )

  return (
    <div
      ref={ref}
      className="viewer"
      role="dialog"
      aria-label={item?.name ?? 'Viewer'}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (
          e.key === 'i' &&
          !(e.target as HTMLElement).matches('input, select')
        ) {
          setInfo(!info)
          return
        }
        onKeyDown(e)
      }}
    >
      <div className="viewer-top">
        <button
          type="button"
          className="icon-btn"
          aria-label="Back (Esc)"
          title="Back (Esc)"
          onClick={() => props.onClose(id)}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <span className="title">{item?.name}</span>
        {props.ids.length > 1 && (
          <span className="pos">
            {num(props.index + 1)} of {num(props.ids.length)}
          </span>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={revealLabel()}
          title={revealLabel()}
          onClick={() => window.viquery.reveal(id)}
        >
          <FolderOpen aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Info (I)"
          title="Info (I)"
          aria-pressed={info}
          onClick={() => setInfo(!info)}
        >
          <Info aria-hidden="true" />
        </button>
      </div>
      <div className="viewer-body">
        {item &&
          (item.kind === 'video' ? (
            <Player
              key={id}
              item={item}
              folder={folder}
              query={props.query ?? ''}
              start={selected ? Math.max(0, selected.startMs - 1000) : 0}
              poster={
                selected
                  ? mediaUrl.frame(id, selected.frameMs)
                  : mediaUrl.thumb(id)
              }
            />
          ) : (
            <ImageView
              key={id}
              item={item}
              folder={folder}
              index={props.index}
              total={props.ids.length}
              go={go}
            />
          ))}
        {info && item && <InfoPanel item={item} folder={folder} />}
      </div>
    </div>
  )
}

// info panel state survives moving between items
let infoOpen = false
function useInfo() {
  const [open, setOpen] = useState(infoOpen)
  const set = (v: boolean) => {
    infoOpen = v
    setOpen(v)
  }
  return [open, set] as const
}

function ImageView(props: {
  item: MediaItem
  folder: Folder | undefined
  index: number
  total: number
  go: (step: number) => void
}) {
  const { item } = props
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const zoom = useCallback(
    (f: number) =>
      setZ((z) =>
        z.s * f <= 1 ? { s: 1, x: 0, y: 0 } : { ...z, s: Math.min(8, z.s * f) },
      ),
    [],
  )

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === '=' || e.key === '+') zoom(1.25)
      else if (e.key === '-') zoom(0.8)
      else if (e.key === '0') setZ({ s: 1, x: 0, y: 0 })
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // capture: these beat the app-wide tile-size shortcuts while the viewer is open
    window.addEventListener('keydown', keys, true)
    return () => window.removeEventListener('keydown', keys, true)
  }, [zoom])

  return (
    <div className="player">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer zoom and pan; keyboard zoom is ⌘+ / ⌘- */}
      <div
        className="stage"
        data-zoomed={z.s > 1 || undefined}
        onWheel={(e) => {
          // trackpad pinch arrives as ctrl+wheel
          if (e.ctrlKey) zoom(Math.exp(-e.deltaY * 0.01))
          else if (z.s > 1) setZ({ ...z, x: z.x - e.deltaX, y: z.y - e.deltaY })
        }}
        onDoubleClick={() => (z.s > 1 ? setZ({ s: 1, x: 0, y: 0 }) : zoom(2))}
        onPointerDown={(e) => {
          if (z.s <= 1 || e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX - z.x, y: e.clientY - z.y }
        }}
        onPointerMove={(e) =>
          drag.current &&
          setZ({
            ...z,
            x: e.clientX - drag.current.x,
            y: e.clientY - drag.current.y,
          })
        }
        onPointerUp={() => {
          drag.current = null
        }}
      >
        <OriginalImage
          item={item}
          folder={props.folder}
          style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }}
        />
        <button
          type="button"
          className="nav-zone prev"
          aria-label="Previous"
          disabled={props.index === 0}
          onClick={() => props.go(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className="nav-zone next"
          aria-label="Next"
          disabled={props.index >= props.total - 1}
          onClick={() => props.go(1)}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="viewer-bar">
        <span>{longDay(item.takenAt)}</span>
        <span>
          {num(item.width)} × {num(item.height)}
        </span>
        {props.folder && <span>{props.folder.name}</span>}
        <span className="spacer" />
        {z.s > 1 && <span>{Math.round(z.s * 100)}%</span>}
      </div>
    </div>
  )
}

function InfoPanel({
  item,
  folder,
}: {
  item: MediaItem
  folder: Folder | undefined
}) {
  return (
    <aside className="info" aria-label="Info">
      <h2>Info</h2>
      <dl>
        <dt>Name</dt>
        <dd>{item.name}</dd>
        <dt>Kind</dt>
        <dd>{item.kind === 'video' ? 'Video' : 'Image'}</dd>
        {item.durationMs !== null && (
          <>
            <dt>Duration</dt>
            <dd>{timecode(item.durationMs)}</dd>
          </>
        )}
        <dt>Dimensions</dt>
        <dd>
          {num(item.width)} × {num(item.height)}
        </dd>
        <dt>Size</dt>
        <dd>{bytes(item.bytes)}</dd>
        <dt>Taken</dt>
        <dd>{longDay(item.takenAt)}</dd>
        {folder && (
          <>
            <dt>Folder</dt>
            <dd>{folder.name}</dd>
          </>
        )}
        <dt>Path</dt>
        <dd>{item.path}</dd>
      </dl>
    </aside>
  )
}
