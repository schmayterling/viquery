import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Info,
  Maximize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import {
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type Folder,
  type MediaId,
  type MediaItem,
  type Moment,
  mediaUrl,
  type Scene,
} from '../../shared/api'
import { at, bytes, count, longDay, num, span, timecode } from './format'
import { hideBroken, type Open } from './Grid'
import { ensureItems, getItem, useItemsVersion } from './items'

export type ViewerState = {
  mode: Open
  ids: ArrayLike<MediaId>
  index: number
  moments?: Map<MediaId, Moment[]> | undefined
  query?: string | undefined
}

type Props = ViewerState & {
  folders: Folder[]
  onChange: (next: ViewerState) => void
  onClose: (id: MediaId) => void
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const revealLabel = () =>
  ({ darwin: 'Show in Finder', win32: 'Show in Explorer' })[
    document.documentElement.dataset.platform ?? ''
  ] ?? 'Show in folder'

export function Viewer(props: Props) {
  const id = at(props.ids, props.index)
  useItemsVersion()
  useEffect(() => {
    // neighbours too, so arrowing is instant
    ensureItems(
      [props.ids[props.index - 1], id, props.ids[props.index + 1]].filter(
        (x) => x !== undefined,
      ),
    )
  }, [props.ids, props.index, id])
  const item = getItem(id)
  const ref = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the mode changes
  useEffect(() => ref.current?.focus({ preventScroll: true }), [props.mode])

  const go = (step: number) => {
    const index = props.index + step
    if (index >= 0 && index < props.ids.length)
      props.onChange({ ...props, index })
  }
  const moments = props.query ? props.moments?.get(id) : undefined
  const folder = props.folders.find((f) => f.id === item?.folderId)
  const [info, setInfo] = useInfo()

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
              <video
                key={id}
                src={mediaUrl.original(id)}
                poster={mediaUrl.thumb(id)}
                muted
                autoPlay={!reducedMotion.matches}
                loop
                onLoadedMetadata={(e) => {
                  if (moments?.[0])
                    e.currentTarget.currentTime = moments[0].startMs / 1000
                }}
              />
            ) : (
              <img
                key={id}
                src={mediaUrl.original(id)}
                alt={item?.name ?? ''}
                decoding="async"
                onError={hideBroken}
              />
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
              moments={moments}
              query={props.query}
              onClearQuery={() =>
                props.onChange({ ...props, query: undefined })
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

function Missing({
  item,
  folder,
}: {
  item: MediaItem
  folder: Folder | undefined
}) {
  return (
    <div className="missing" role="alert">
      <img src={mediaUrl.thumb(item.id)} alt="" onError={hideBroken} />
      <p>
        {folder?.state === 'offline'
          ? `${folder.name} isn't connected. Connect the drive to open the original.`
          : 'The original moved or was deleted.'}
      </p>
    </div>
  )
}

function ImageView(props: {
  item: MediaItem
  folder: Folder | undefined
  index: number
  total: number
  go: (step: number) => void
}) {
  const { item } = props
  const [missing, setMissing] = useState(false)
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
        {missing ? (
          <Missing item={item} folder={props.folder} />
        ) : (
          <img
            src={mediaUrl.original(item.id)}
            alt={item.name}
            decoding="async"
            draggable={false}
            onError={() => setMissing(true)}
            style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }}
          />
        )}
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

const SPEEDS = [0.5, 1, 1.25, 1.5, 2]

function Player(props: {
  item: MediaItem
  folder: Folder | undefined
  moments: Moment[] | undefined
  query: string | undefined
  onClearQuery: () => void
}) {
  const { item, moments } = props
  const video = useRef<HTMLVideoElement>(null)
  const played = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLElement>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [rate, setRate] = useState(1)
  const [missing, setMissing] = useState(false)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [hover, setHover] = useState<number | null>(null)
  const duration = item.durationMs ?? 0
  const start = moments?.[0] ? Math.max(0, moments[0].startMs - 1000) : 0

  useEffect(() => {
    window.viquery.scenes(item.id).then(setScenes)
  }, [item.id])

  // playhead follows every frame while playing; text updates ride timeupdate
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = video.current
      if (v && duration) {
        const p = Math.min(1, (v.currentTime * 1000) / duration)
        played.current?.style.setProperty('transform', `scaleX(${p})`)
        knob.current?.style.setProperty('left', `${p * 100}%`)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  const seek = (ms: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(duration, ms)) / 1000
    setT(v.currentTime * 1000)
  }
  const toggle = () => {
    const v = video.current
    if (v) v.paused ? v.play() : v.pause()
  }
  const matchAt = moments
    ? moments.findIndex((m) => t >= m.startMs - 1000 && t < m.endMs)
    : -1
  const jump = (step: 1 | -1) => {
    if (!moments?.length) return
    const sorted = [...moments].sort((a, b) => a.startMs - b.startMs)
    const target =
      step > 0
        ? sorted.find((m) => m.startMs - 1000 > t + 500)
        : [...sorted].reverse().find((m) => m.startMs - 1000 < t - 1500)
    if (target) seek(target.startMs - 1000)
  }

  const currentScene = scenes.findIndex((s) => t >= s.startMs && t < s.endMs)
  const matching = useMemo(
    () => new Set(moments?.map((m) => m.sceneId)),
    [moments],
  )
  // keep the playing scene in view
  useEffect(() => {
    if (currentScene < 0) return
    strip.current?.children[currentScene]?.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
      behavior: reducedMotion.matches ? 'instant' : 'smooth',
    })
  }, [currentScene])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).matches('input, select')) return
    const k = e.key
    if (k === ' ' || k === 'k') toggle()
    else if (k === 'j' || k === 'l') seek(t + (k === 'j' ? -10_000 : 10_000))
    else if (k === ']' || k === 'n') jump(1)
    else if (k === '[' || k === 'N') jump(-1)
    else if (k === 'm') setMuted(!muted)
    else if (k === 'f') video.current?.parentElement?.requestFullscreen()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const fromPointer = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration
  }
  const sprite = item.sprite
  const previewFrame =
    hover !== null && sprite
      ? Math.min(
          sprite.frames - 1,
          Math.floor((hover / duration) * sprite.frames),
        )
      : 0
  const p = duration ? Math.min(1, t / duration) : 0

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: player shortcuts (design §7)
    <div className="player" onKeyDown={onKeyDown}>
      <div className="stage">
        {missing ? (
          <Missing item={item} folder={props.folder} />
        ) : (
          <video
            ref={video}
            src={mediaUrl.original(item.id)}
            poster={
              moments?.[0]
                ? mediaUrl.frame(item.id, moments[0].seekMs)
                : mediaUrl.thumb(item.id)
            }
            muted={muted}
            onClick={toggle}
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = start / 1000
              setT(start)
              if (!reducedMotion.matches) e.currentTarget.play().catch(() => {})
            }}
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime * 1000)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setMissing(true)}
          />
        )}
      </div>
      <div className="controls">
        <div
          className="seek"
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration / 1000)}
          aria-valuenow={Math.round(t / 1000)}
          aria-valuetext={`${timecode(t)} of ${timecode(duration)}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault()
              e.stopPropagation()
              seek(t + (e.key === 'ArrowLeft' ? -5000 : 5000))
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            seek(fromPointer(e))
          }}
          onPointerMove={(e) => {
            setHover(fromPointer(e))
            if (e.buttons === 1) seek(fromPointer(e))
          }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="track">
            <div
              ref={played}
              className="played"
              style={{ transform: `scaleX(${p})` }}
            />
            {moments?.map((m, k) => (
              <i
                key={m.sceneId}
                className="mark"
                data-current={k === matchAt || undefined}
                style={{
                  left: `${(m.startMs / duration) * 100}%`,
                  width: `${((m.endMs - m.startMs) / duration) * 100}%`,
                }}
              />
            ))}
          </div>
          <div ref={knob} className="head" style={{ left: `${p * 100}%` }} />
          {hover !== null && (
            <div
              className="preview"
              style={{ left: `${(hover / duration) * 100}%` }}
            >
              {sprite && (
                <div
                  className="frame"
                  style={{
                    backgroundImage: `url("${mediaUrl.sprite(item.id)}")`,
                    backgroundSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
                    backgroundPosition: `${sprite.columns > 1 ? ((previewFrame % sprite.columns) / (sprite.columns - 1)) * 100 : 0}% ${sprite.rows > 1 ? (Math.floor(previewFrame / sprite.columns) / (sprite.rows - 1)) * 100 : 0}%`,
                  }}
                />
              )}
              <span>{timecode(hover)}</span>
            </div>
          )}
        </div>
        <div className="controls-row">
          {moments && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous match ([)"
              title="Previous match ([)"
              onClick={() => jump(-1)}
            >
              <SkipBack aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={playing ? 'Pause (K)' : 'Play (K)'}
            onClick={toggle}
          >
            {playing ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
          </button>
          {moments && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Next match (])"
              title="Next match (])"
              onClick={() => jump(1)}
            >
              <SkipForward aria-hidden="true" />
            </button>
          )}
          <span className="time">
            {timecode(t)} / {timecode(duration)}
          </span>
          {moments && props.query && (
            <span className="query-chip">
              <span>
                {count(moments.length, 'match', 'matches')} for “{props.query}”
              </span>
              <button
                type="button"
                aria-label="Clear matches"
                onClick={props.onClearQuery}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="icon-btn"
            aria-label={muted ? 'Unmute (M)' : 'Mute (M)'}
            onClick={() => setMuted(!muted)}
          >
            {muted || volume === 0 ? (
              <VolumeX aria-hidden="true" />
            ) : (
              <Volume2 aria-hidden="true" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolume(v)
              setMuted(v === 0)
              if (video.current) video.current.volume = v
            }}
          />
          <select
            aria-label="Playback speed"
            value={rate}
            onChange={(e) => {
              const r = Number(e.target.value)
              setRate(r)
              if (video.current) video.current.playbackRate = r
            }}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn"
            aria-label="Full screen (F)"
            onClick={() => video.current?.parentElement?.requestFullscreen()}
          >
            <Maximize aria-hidden="true" />
          </button>
        </div>
      </div>
      {scenes.length > 0 && (
        <nav
          ref={strip}
          className="scenes"
          aria-label={count(scenes.length, 'scene')}
        >
          {scenes.map((s, k) => (
            <button
              key={s.id}
              type="button"
              className="scene"
              data-match={(props.query && matching.has(s.id)) || undefined}
              aria-current={k === currentScene}
              aria-label={`${props.query && matching.has(s.id) ? 'Match, ' : ''}${span(s.startMs, s.endMs)}`}
              onClick={() => seek(s.startMs)}
            >
              <img
                src={mediaUrl.frame(item.id, s.frameMs)}
                alt=""
                loading="lazy"
                decoding="async"
                onError={hideBroken}
              />
              {props.query && matching.has(s.id) && (
                <span className="range">{span(s.startMs, s.endMs)}</span>
              )}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
