import { Calendar, Check, ChevronDown, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { MediaKind } from '../../shared/api'
import { day, num } from './format'

// takenFrom inclusive, takenTo exclusive (Filter contract)
export type Dates = { from: number; to: number; label: string }
type Media = 'all' | MediaKind

export function yearDates(year: number): Dates {
  return {
    from: new Date(year, 0, 1).getTime(),
    to: new Date(year + 1, 0, 1).getTime(),
    label: String(year),
  }
}

function presets(): Dates[] {
  const now = new Date()
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  ).getTime()
  return [
    { from: today - 30 * 86_400_000, to: today, label: 'Last 30 days' },
    {
      from: new Date(
        now.getFullYear() - 1,
        now.getMonth(),
        now.getDate(),
      ).getTime(),
      to: today,
      label: 'Last 12 months',
    },
  ]
}

type Props = {
  title: ReactNode
  meta?: ReactNode | undefined
  media: Media
  onMedia: (m: Media) => void
  counts?: { image: number; video: number } | undefined
  dates: Dates | null
  onDates: (d: Dates | null) => void
  years: number[]
  children?: ReactNode
}

export function Header(props: Props) {
  const seg = (m: Media, label: string, n?: number) => (
    <button
      type="button"
      aria-pressed={props.media === m}
      onClick={() => props.onMedia(m)}
    >
      {label}
      {n !== undefined && <span className="n">{num(n)}</span>}
    </button>
  )
  return (
    <div className="head">
      <h1>{props.title}</h1>
      {props.meta && <span className="meta">{props.meta}</span>}
      <span className="spacer" />
      <div className="tools">
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control is a group of toggle buttons */}
        <div className="segmented" role="group" aria-label="Media type">
          {seg('all', 'All')}
          {seg('image', 'Images', props.counts?.image)}
          {seg('video', 'Videos', props.counts?.video)}
        </div>
        <DateChip {...props} />
        {props.children}
      </div>
    </div>
  )
}

function DateChip({ dates, onDates, years }: Props) {
  const close = () => document.getElementById('date-menu')?.hidePopover()
  const set = (d: Dates | null) => {
    onDates(d)
    close()
  }
  const input = (ms: number | undefined) =>
    ms === undefined
      ? ''
      : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 10)
  const parse = (v: string) =>
    v ? new Date(`${v}T00:00`).getTime() : undefined
  const custom = (from: number | undefined, to: number | undefined) => {
    const f = from ?? dates?.from ?? to ?? Date.now()
    const t = to ?? (dates ? dates.to : f + 86_400_000)
    if (t > f)
      onDates({ from: f, to: t, label: `${day(f)} – ${day(t - 86_400_000)}` })
  }
  const item = (d: Dates | null, label: string) => (
    <button
      key={label}
      type="button"
      aria-pressed={(dates?.label ?? null) === (d?.label ?? null)}
      className="menu-item"
      onClick={() => set(d)}
    >
      {label}
      <Check className="check-mark" aria-hidden="true" />
    </button>
  )
  const chip = (
    <button
      type="button"
      id="date-chip"
      className="chip"
      popoverTarget="date-menu"
      aria-haspopup="dialog"
    >
      <Calendar aria-hidden="true" />
      {dates ? dates.label : 'Any date'}
      {!dates && <ChevronDown aria-hidden="true" />}
    </button>
  )
  return (
    <>
      {dates ? (
        <span className="chip-set">
          {chip}
          <button
            type="button"
            className="x"
            aria-label="Clear date filter"
            onClick={() => onDates(null)}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      ) : (
        chip
      )}
      <div
        id="date-menu"
        className="menu"
        popover="auto"
        role="dialog"
        aria-label="Date"
      >
        {item(null, 'Any date')}
        {presets().map((p) => item(p, p.label))}
        {years.length > 0 && <hr />}
        {years.slice(0, 8).map((y) => item(yearDates(y), String(y)))}
        <hr />
        <div className="menu-label">Range</div>
        <div className="date-range">
          <label>
            From
            <input
              type="date"
              value={input(dates?.from)}
              onChange={(e) => custom(parse(e.target.value), undefined)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={input(dates ? dates.to - 86_400_000 : undefined)}
              onChange={(e) => {
                const t = parse(e.target.value)
                custom(undefined, t === undefined ? undefined : t + 86_400_000)
              }}
            />
          </label>
        </div>
      </div>
    </>
  )
}
