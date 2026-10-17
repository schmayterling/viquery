import {
  Clock,
  Folder as FolderIcon,
  HardDrive,
  Image,
  Images,
  Pause,
  Play,
  Plus,
  Trash2,
  Video,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type {
  Folder,
  FolderId,
  IndexPhase,
  MediaKind,
  Scope,
  ServiceState,
} from '../../shared/api'
import { count, minutes, num } from './format'

export type Place = { scope: Scope; media: 'all' | MediaKind }
export type Counts = {
  all: number
  image: number
  video: number
  recent: number
}

type Props = {
  place: Place
  counts: Counts | null
  folders: Folder[]
  onPlace: (place: Place) => void
  onAddFolder: () => void
  onRemoveFolder: (id: FolderId) => void
  onResize: (width: number, done: boolean) => void
}

const same = (a: Place, b: Place) =>
  a.media === b.media &&
  a.scope.kind === b.scope.kind &&
  (a.scope.kind !== 'folder' ||
    (b.scope.kind === 'folder' && a.scope.folderId === b.scope.folderId))

export function Sidebar(props: Props) {
  const { place, counts, folders } = props
  const [menu, setMenu] = useState<{
    folder: Folder
    x: number
    y: number
  } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const nav = (
    target: Place,
    icon: ReactNode,
    label: string,
    n: number | undefined,
  ) => (
    <button
      type="button"
      className="nav"
      aria-current={same(place, target) ? 'page' : undefined}
      onClick={() => props.onPlace(target)}
    >
      {icon}
      <span className="label">{label}</span>
      <span className="count">{n === undefined ? '' : num(n)}</span>
    </button>
  )
  const all = { kind: 'all' } as const
  return (
    <nav className="sidebar" id="sidebar" aria-label="Library">
      <div className="side-scroll">
        <div className="side-group">
          {nav(
            { scope: all, media: 'all' },
            <Images aria-hidden="true" />,
            'All media',
            counts?.all,
          )}
          {nav(
            { scope: all, media: 'image' },
            <Image aria-hidden="true" />,
            'Images',
            counts?.image,
          )}
          {nav(
            { scope: all, media: 'video' },
            <Video aria-hidden="true" />,
            'Videos',
            counts?.video,
          )}
          {nav(
            { scope: { kind: 'recent' }, media: 'all' },
            <Clock aria-hidden="true" />,
            'Recently added',
            counts?.recent,
          )}
        </div>
        <div className="side-group">
          <div className="side-heading">
            <span>Folders</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Add folder"
              onClick={props.onAddFolder}
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
          {folders.length === 0 && <p className="side-empty">No folders yet</p>}
          {folders.map((f) => {
            const target: Place = {
              scope: { kind: 'folder', folderId: f.id },
              media: 'all',
            }
            const offline = f.state === 'offline'
            return (
              <button
                key={f.id}
                type="button"
                className="nav"
                data-offline={offline || undefined}
                title={
                  offline
                    ? 'Drive not connected. Its items stay searchable.'
                    : f.path
                }
                aria-current={same(place, target) ? 'page' : undefined}
                onClick={() => props.onPlace(target)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ folder: f, x: e.clientX, y: e.clientY })
                }}
              >
                {offline ? (
                  <HardDrive aria-hidden="true" />
                ) : (
                  <FolderIcon aria-hidden="true" />
                )}
                <span className="label">{f.name}</span>
                <span className="count">
                  {offline ? 'Offline' : num(f.count)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <IndexStatus />
      <Resizer onResize={props.onResize} />
      {menu && (
        <FolderMenu
          {...menu}
          onClose={closeMenu}
          onRemove={() => props.onRemoveFolder(menu.folder.id)}
        />
      )}
    </nav>
  )
}

function FolderMenu(props: {
  folder: Folder
  x: number
  y: number
  onClose: () => void
  onRemove: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState(false)
  const { onClose } = props
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.inset = `${props.y + 2}px auto auto ${props.x + 2}px`
    el.showPopover()
    el.querySelector<HTMLElement>('button')?.focus()
    const closed = (e: Event) =>
      (e as ToggleEvent).newState === 'closed' && onClose()
    el.addEventListener('toggle', closed)
    return () => el.removeEventListener('toggle', closed)
  }, [props.x, props.y, onClose])
  return (
    <div
      ref={ref}
      className="menu"
      popover="auto"
      role="dialog"
      aria-label={props.folder.name}
    >
      {confirm ? (
        <div className="confirm">
          Remove <strong>{props.folder.name}</strong> from the library? Files on
          disk aren't touched.
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => ref.current?.hidePopover()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                props.onRemove()
                ref.current?.hidePopover()
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="menu-label">{props.folder.path}</div>
          <button
            type="button"
            className="menu-item"
            onClick={() => setConfirm(true)}
          >
            <Trash2 aria-hidden="true" />
            Remove from library…
          </button>
        </>
      )}
    </div>
  )
}

function Resizer(props: { onResize: (width: number, done: boolean) => void }) {
  const [dragging, setDragging] = useState(false)
  return (
    // biome-ignore lint/a11y/useSemanticElements: a pointer-only drag strip; ⌘\ toggles the sidebar from the keyboard
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => dragging && props.onResize(e.clientX, false)}
      onPointerUp={(e) => {
        if (!dragging) return
        setDragging(false)
        props.onResize(e.clientX, true)
      }}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => props.onResize(248, true)}
    />
  )
}

const PHASE = {
  thumbnails: 'Making thumbnails',
  images: 'Indexing images',
  videos: 'Indexing videos',
  speech: 'Indexing speech',
  text: 'Indexing text',
} as const

// design §6.6. events are coalesced to at most 4 renders a second; the live region speaks every 10%.
function IndexStatus() {
  const [state, setState] = useState<IndexPhase | null>(null)
  useEffect(() => {
    let latest: IndexPhase | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.viquery.onIndex((s) => {
      latest = s
      timer ??= setTimeout(() => {
        timer = undefined
        setState(latest)
      }, 250)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [])

  const [services, setServices] = useState<ServiceState>('ready')
  useEffect(() => window.viquery.onServices(setServices), [])
  const announce = useAnnouncement(state)
  if (services !== 'ready')
    return (
      <div className="side-footer" role="status">
        {services === 'recovering'
          ? 'Restarting search and indexing…'
          : 'Search and indexing stopped. Restart viquery to continue.'}
      </div>
    )
  if (!state) return <div className="side-footer" />

  const failed =
    state.phase !== 'scanning' && state.failed > 0 ? (
      <p className="index-failed">
        {count(state.failed, 'item')} couldn't be indexed
      </p>
    ) : null

  let body: ReactNode
  if (state.phase === 'idle') {
    body = (
      <div className="index-line">{num(state.items)} items · up to date</div>
    )
  } else if (state.phase === 'scanning') {
    body = (
      <>
        <div className="index-line">
          <span className="what">Finding files</span>
          <span>{num(state.found)}</span>
        </div>
        <div className="meter" aria-hidden="true" />
      </>
    )
  } else {
    const p = state.total ? state.done / state.total : 0
    const pause = () => window.viquery.pauseIndexing(!state.paused)
    body = (
      <>
        <div className="index-line">
          <span className="what">
            {state.paused ? 'Paused' : PHASE[state.phase]}
          </span>
          {state.paused ? (
            <button type="button" className="link" onClick={pause}>
              Resume
            </button>
          ) : (
            <span>
              {num(state.done)} of {num(state.total)}
            </span>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={state.paused ? 'Resume indexing' : 'Pause indexing'}
            onClick={pause}
          >
            {state.paused ? (
              <Play aria-hidden="true" />
            ) : (
              <Pause aria-hidden="true" />
            )}
          </button>
        </div>
        <div
          className="meter"
          data-paused={state.paused || undefined}
          role="progressbar"
          aria-label={PHASE[state.phase]}
          aria-valuemin={0}
          aria-valuemax={state.total}
          aria-valuenow={state.done}
        >
          <span style={{ transform: `scaleX(${p})` }} />
        </div>
        <div className="index-sub">
          <span>
            {state.phase === 'thumbnails'
              ? 'Browsing works now'
              : "Search works on what's done"}
          </span>
          {!state.paused && state.etaMs !== null && (
            <span>~{minutes(state.etaMs)}</span>
          )}
        </div>
      </>
    )
  }
  // "up to date" fades after 4s; failures stay (design §6.6)
  const done = state.phase === 'idle' && !failed
  return (
    <div
      className={done ? 'side-footer index-done' : 'side-footer'}
      key={done ? state.items : undefined}
    >
      {body}
      {failed}
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  )
}

function useAnnouncement(state: IndexPhase | null) {
  const [text, setText] = useState('')
  const step = !state
    ? ''
    : state.phase === 'idle'
      ? 'idle'
      : state.phase === 'scanning'
        ? 'scanning'
        : `${state.phase}:${state.paused}:${Math.floor((state.done / Math.max(1, state.total)) * 10)}`
  // speak on step changes only; state is read at the step boundary
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed on step
  useEffect(() => {
    if (!state) return
    if (state.phase === 'idle') setText(`${num(state.items)} items, up to date`)
    else if (state.phase === 'scanning') setText('Finding files')
    else
      setText(
        state.paused
          ? 'Indexing paused'
          : `${PHASE[state.phase]}, ${Math.round((state.done / Math.max(1, state.total)) * 100)}%`,
      )
  }, [step])
  return text
}
