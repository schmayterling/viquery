import {
  Maximize,
  PanelRight,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type Folder,
  type MediaItem,
  mediaUrl,
  type Scene,
  type SceneMatch,
  type TranscriptSegment,
} from '../../shared/api'
import { count, span, timecode } from './format'
import { hideBroken } from './Grid'
import { useIndexPhase } from './items'

type Tab = 'matches' | 'transcript'
const SPEEDS = [0.5, 1, 1.25, 1.5, 2]
const BAR = 'oklch(0.185 0 0)' // .vbar background, cut into the track as scene gaps
const percent = (ms: number, duration: number) =>
  `${duration ? (ms / duration) * 100 : 0}%`
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

// panel open/tab carry over from one video to the next within a session
let remembered: { open: boolean; tab: Tab } | null = null

// words too common to be worth highlighting in a transcript
const STOP = new Set([
  'the',
  'and',
  'off',
  'into',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'you',
  'your',
  'out',
  'over',
  'onto',
  'some',
  'what',
])

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function highlight(text: string, words: RegExp | null): ReactNode {
  if (!words) return text
  // split with a capture group: odd entries are the matched words
  return text.split(words).map((part, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: fragments of one immutable string
    i % 2 ? <mark key={i}>{part}</mark> : part,
  )
}

export function Player(props: {
  item: MediaItem
  folder: Folder | undefined
  query: string
  start: number
  poster: string
  missing: ReactNode
}) {
  const { item } = props
  const id = item.id
  const duration = item.durationMs ?? 0
  const video = useRef<HTMLVideoElement>(null)
  const played = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const lines = useRef<HTMLOListElement>(null)
  const reading = useRef(false)

  const [t, setT] = useState(props.start)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [rate, setRate] = useState(1)
  const [missing, setMissing] = useState(false)
  const [hover, setHover] = useState<{
    ms: number
    pin: SceneMatch | null
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState(remembered?.open ?? props.query !== '')
  const [tab, setTab] = useState<Tab>(remembered?.tab ?? 'matches')
  const [find, setFind] = useState(props.query)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [transcript, setTranscript] = useState<TranscriptSegment[] | null>(null)
  const [found, setFound] = useState<{
    q: string
    scenes: SceneMatch[]
    error: string | null
  } | null>(null)
  const phase = useIndexPhase()
  const q = find.trim()

  useEffect(() => {
    remembered = { open, tab }
  }, [open, tab])

  useEffect(() => {
    window.viquery.scenes(id).then(setScenes)
    window.viquery.transcript(id).then(setTranscript)
  }, [id])

  // in-video search, debounced as you type; a stale answer never replaces a newer one
  useEffect(() => {
    if (!q) {
      setFound(null)
      return
    }
    let live = true
    const timer = setTimeout(async () => {
      // translate a failed search into an inline message instead of an unhandled rejection
      try {
        const scenes = await window.viquery.searchVideo(id, q)
        if (live) setFound({ q, scenes, error: null })
      } catch (e) {
        if (live)
          setFound({
            q,
            scenes: [],
            error: e instanceof Error ? e.message : String(e),
          })
      }
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [id, q])

  // playhead follows every frame while playing; text updates ride timeupdate
  useEffect(() => {
    if (!playing || !duration) return
    let raf = 0
    const tick = () => {
      const v = video.current
      if (v) {
        const p = Math.min(1, (v.currentTime * 1000) / duration)
        played.current?.style.setProperty('transform', `scaleX(${p})`)
        knob.current?.style.setProperty('left', `${p * 100}%`)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, duration])

  const results = q ? found : null
  const stale = results !== null && results.q !== q
  const pins = useMemo(
    () => results?.scenes.filter((s) => s.match) ?? [],
    [results],
  )
  const pinAt = pins.findIndex((m) => t >= m.startMs && t < m.endMs)
  const words = useMemo(() => {
    const w = q
      .toLowerCase()
      .split(/\s+/)
      .filter((x) => x.length >= 3 && !STOP.has(x))
    return w.length
      ? new RegExp(`(${w.map(escapeRegex).join('|')})`, 'gi')
      : null
  }, [q])
  const said = (s: TranscriptSegment) =>
    (words !== null && new RegExp(words.source, 'i').test(s.text)) ||
    pins.some(
      (m) =>
        m.sources.includes('speech') &&
        m.startMs < s.endMs &&
        s.startMs < m.endMs,
    )
  const line = transcript?.findIndex((s) => t >= s.startMs && t < s.endMs) ?? -1

  // keep the spoken line in view unless the reader is scrolling the list themselves
  useEffect(() => {
    if (line < 0 || reading.current || !open || tab !== 'transcript') return
    lines.current?.children[line]?.scrollIntoView({
      block: 'nearest',
      behavior: reducedMotion.matches ? 'instant' : 'smooth',
    })
  }, [line, open, tab])

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
  const jump = (step: 1 | -1) => {
    const target =
      step > 0
        ? pins.find((m) => m.startMs > t + 500)
        : pins.findLast((m) => m.startMs < t - 1500)
    if (target) seek(target.startMs)
  }
  const showFind = () => {
    const focus = () => {
      findRef.current?.focus()
      findRef.current?.select()
    }
    // the field exists while the panel is open; otherwise it mounts on the next frame
    if (open) focus()
    else {
      setOpen(true)
      requestAnimationFrame(focus)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).matches('input, select')) return
    const k = e.key
    if (k === ' ' || k === 'k') toggle()
    else if (k === 'ArrowLeft' || k === 'ArrowRight')
      seek(t + (k === 'ArrowLeft' ? -5000 : 5000))
    else if (k === 'j' || k === 'l') seek(t + (k === 'j' ? -10_000 : 10_000))
    else if (k === ']' || k === 'n') jump(1)
    else if (k === '[' || k === 'N') jump(-1)
    else if (k === 'm') setMuted(!muted)
    else if (k === 'f') showFind()
    else if (k === 't') {
      if (open && tab === 'transcript') setOpen(false)
      else {
        setOpen(true)
        setTab('transcript')
      }
    } else if (k === 'Escape' && open) setOpen(false)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const fromPointer = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration
  }
  const pct = (ms: number) => percent(ms, duration)

  // heat: every scene tinted by its score; quiet at the low end so peaks read
  const heat = useMemo(() => {
    if (!results?.scenes.length || !duration) return undefined
    const stops = results.scenes.map(
      (s) =>
        `color-mix(in srgb, var(--accent) ${Math.round(s.score ** 2 * 85)}%, transparent) ${percent(s.startMs, duration)} ${percent(s.endMs, duration)}`,
    )
    return `linear-gradient(to right, ${stops.join(', ')})`
  }, [results, duration])
  // chapter-like gaps at scene starts, skipped when scenes are too dense to read
  const ticks = useMemo(() => {
    if (!duration || scenes.length < 2 || scenes.length > 120) return undefined
    const stops = scenes
      .slice(1)
      .map(
        (s) =>
          `transparent calc(${percent(s.startMs, duration)} - 1px), ${BAR} calc(${percent(s.startMs, duration)} - 1px) calc(${percent(s.startMs, duration)} + 1px), transparent calc(${percent(s.startMs, duration)} + 1px)`,
      )
    return `linear-gradient(to right, transparent 0, ${stops.join(', ')})`
  }, [scenes, duration])

  const sprite = item.sprite
  const frameStyle = (() => {
    if (!hover) return undefined
    if (hover.pin)
      return {
        backgroundImage: `url("${mediaUrl.frame(id, hover.pin.seekMs)}")`,
      }
    if (!sprite) return undefined
    const f = Math.min(
      sprite.frames - 1,
      Math.floor((hover.ms / duration) * sprite.frames),
    )
    const pos = (k: number, n: number) => (n > 1 ? (k / (n - 1)) * 100 : 0)
    return {
      backgroundImage: `url("${mediaUrl.sprite(id)}")`,
      backgroundSize: `${sprite.columns * 100}% ${sprite.rows * 100}%`,
      backgroundPosition: `${pos(f % sprite.columns, sprite.columns)}% ${pos(Math.floor(f / sprite.columns), sprite.rows)}%`,
    }
  })()
  const p = duration ? Math.min(1, t / duration) : 0
  const pending = phase !== null && phase.phase !== 'idle'
  const matchedLines = transcript && words ? transcript.filter(said).length : 0

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: player shortcuts (design §7); focus target for the viewer
    <div
      ref={root}
      className="vplayer"
      tabIndex={-1}
      data-autofocus
      onKeyDown={onKeyDown}
    >
      <div className="vplayer-main">
        <div className="vstage">
          {missing ? (
            props.missing
          ) : (
            <video
              ref={video}
              src={mediaUrl.original(id)}
              poster={props.poster}
              muted={muted}
              style={
                { '--ar': item.width / item.height } as React.CSSProperties
              }
              onClick={toggle}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = props.start / 1000
                if (!reducedMotion.matches)
                  e.currentTarget.play().catch(() => {})
              }}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime * 1000)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setMissing(true)}
            />
          )}
        </div>
        <div className="vbar">
          <div
            className="seek"
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration / 1000)}
            aria-valuenow={Math.round(t / 1000)}
            aria-valuetext={`${timecode(t)} of ${timecode(duration)}`}
            data-dragging={dragging || undefined}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDragging(true)
              seek(fromPointer(e))
            }}
            onPointerUp={() => setDragging(false)}
            onPointerMove={(e) => {
              const ms = fromPointer(e)
              const slack = duration * 0.006
              setHover({
                ms,
                pin:
                  pins.find(
                    (m) => ms >= m.startMs - slack && ms <= m.endMs + slack,
                  ) ?? null,
              })
              if (dragging) seek(ms)
            }}
            onPointerLeave={() => setHover(null)}
          >
            <div className="track">
              <div style={{ backgroundImage: heat }} />
              <div
                ref={played}
                className="played"
                style={{ transform: `scaleX(${p})` }}
              />
              <div style={{ backgroundImage: ticks }} />
            </div>
            {pins.map((m, k) => (
              <i
                key={m.sceneId}
                className="pin"
                data-current={k === pinAt || undefined}
                style={{
                  left: pct(m.startMs),
                  width: pct(m.endMs - m.startMs),
                }}
              />
            ))}
            <div ref={knob} className="knob" style={{ left: `${p * 100}%` }} />
            {hover && (
              <div className="preview" style={{ left: pct(hover.ms) }}>
                {frameStyle && <div className="frame" style={frameStyle} />}
                <span>
                  {hover.pin
                    ? span(hover.pin.startMs, hover.pin.endMs)
                    : timecode(hover.ms)}
                </span>
              </div>
            )}
          </div>
          <div className="vbar-row">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous match ([)"
              title="Previous match ([)"
              disabled={!pins.length}
              onClick={() => jump(-1)}
            >
              <SkipBack aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
              onClick={toggle}
            >
              {playing ? (
                <Pause aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next match (])"
              title="Next match (])"
              disabled={!pins.length}
              onClick={() => jump(1)}
            >
              <SkipForward aria-hidden="true" />
            </button>
            <span className="time">
              {timecode(t)} / {timecode(duration)}
            </span>
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
              aria-label="Full screen"
              title="Full screen"
              onClick={() => video.current?.parentElement?.requestFullscreen()}
            >
              <Maximize aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Matches and transcript (T)"
              title="Matches and transcript (T)"
              aria-pressed={open}
              aria-controls="vpanel"
              onClick={() => setOpen(!open)}
            >
              <PanelRight aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      {open && (
        <aside
          id="vpanel"
          className="vpanel"
          aria-label="Matches and transcript"
        >
          <div className="vpanel-head">
            <label className="find">
              <Search aria-hidden="true" />
              <input
                ref={findRef}
                type="search"
                aria-label="Find in this video"
                placeholder="Find in this video"
                spellCheck={false}
                value={find}
                onChange={(e) => setFind(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    if (find) setFind('')
                    else root.current?.focus()
                  } else if (e.key === 'Enter' && pins[0]) {
                    e.preventDefault()
                    seek(pins[0].startMs)
                    root.current?.focus()
                  }
                }}
              />
              {find && (
                <button
                  type="button"
                  aria-label="Clear"
                  onClick={() => setFind('')}
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </label>
            <div className="segmented" role="tablist" aria-label="Panel">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'matches'}
                aria-controls="vpanel-list"
                onClick={() => setTab('matches')}
              >
                Matches
                {results && <span className="n">{pins.length}</span>}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'transcript'}
                aria-controls="vpanel-list"
                onClick={() => setTab('transcript')}
              >
                Transcript
                {matchedLines > 0 && <span className="n">{matchedLines}</span>}
              </button>
            </div>
          </div>
          {tab === 'matches' ? (
            <Matches
              id={id}
              q={q}
              results={results}
              stale={stale}
              pins={pins}
              pinAt={pinAt}
              words={words}
              seek={seek}
            />
          ) : !transcript ? null : transcript.length === 0 ? (
            <p className="vpanel-empty">
              {pending ? (
                <>
                  <strong>Still transcribing…</strong>
                  Speech in this video becomes searchable when indexing reaches
                  it.
                </>
              ) : (
                <strong>No speech in this video</strong>
              )}
            </p>
          ) : (
            <ol
              ref={lines}
              id="vpanel-list"
              className="vpanel-list"
              onPointerEnter={() => {
                reading.current = true
              }}
              onPointerLeave={() => {
                reading.current = false
              }}
            >
              {transcript.map((s, k) => (
                <li key={s.startMs}>
                  <button
                    type="button"
                    className="line"
                    aria-current={k === line}
                    data-match={(q && said(s)) || undefined}
                    onClick={() => seek(s.startMs)}
                  >
                    <span className="ts">{timecode(s.startMs)}</span>
                    <span>{highlight(s.text, words)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {results && !stale
              ? pins.length
                ? count(pins.length, 'match', 'matches')
                : 'No moments match'
              : ''}
          </span>
        </aside>
      )}
    </div>
  )
}

function Matches(props: {
  id: number
  q: string
  results: { q: string; scenes: SceneMatch[]; error: string | null } | null
  stale: boolean
  pins: SceneMatch[]
  pinAt: number
  words: RegExp | null
  seek: (ms: number) => void
}) {
  const { results, pins } = props
  if (!props.q)
    return (
      <p className="vpanel-empty">
        Type to find moments in this video, by what’s shown or what’s said.
      </p>
    )
  if (!results) return null
  if (results.error)
    return (
      <p className="vpanel-empty" role="alert">
        <strong>Couldn’t search this video</strong>
        {results.error}
      </p>
    )
  if (!results.scenes.length)
    return (
      <p className="vpanel-empty">
        <strong>Still indexing this video</strong>
        Its scenes become searchable when indexing reaches it.
      </p>
    )
  if (!pins.length)
    return (
      <p className="vpanel-empty" data-stale={props.stale || undefined}>
        <strong>No moments match</strong>
        Nothing in this video matches “{results.q}”. The strip on the timeline
        shows the closest scenes.
      </p>
    )
  return (
    <ol
      id="vpanel-list"
      className="vpanel-list"
      data-stale={props.stale || undefined}
    >
      {pins.map((m, k) => (
        <li key={m.sceneId}>
          <button
            type="button"
            className="hit"
            aria-current={k === props.pinAt}
            onClick={() => props.seek(m.startMs)}
          >
            <img
              src={mediaUrl.frame(props.id, m.seekMs)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={hideBroken}
            />
            <span>
              <span className="when">{span(m.startMs, m.endMs)}</span>
              {m.snippet && (
                <span className="said">
                  “{highlight(m.snippet, props.words)}”
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}
