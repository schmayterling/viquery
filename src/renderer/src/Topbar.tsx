import {
  Check,
  History,
  LayoutGrid,
  PanelLeft,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { at } from './format'

export const ROW_HEIGHTS = [120, 160, 196, 260] as const
const SIZE_NAMES = ['Small', 'Medium', 'Large', 'Extra large']
const RECENT_KEY = 'viquery.recentQueries'

export const recentQueries = (): string[] =>
  JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
export function rememberQuery(q: string) {
  const list = [q, ...recentQueries().filter((r) => r !== q)].slice(0, 6)
  localStorage.setItem(RECENT_KEY, JSON.stringify(list))
}

type Props = {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  onQuery: (q: string) => void
  onSubmit: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  rowHeight: number
  onRowHeight: (h: number) => void
  square: boolean
  onSquare: (square: boolean) => void
  onAddFolder: () => void
}

export function Topbar(props: Props) {
  const mac = document.documentElement.dataset.platform === 'darwin'
  return (
    <header className="topbar">
      <button
        type="button"
        id="sidebar-toggle"
        className="icon-btn"
        aria-label={props.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-controls="sidebar"
        aria-expanded={props.sidebarOpen}
        title={`${props.sidebarOpen ? 'Hide' : 'Show'} sidebar (${mac ? '⌘' : 'Ctrl+'}\\)`}
        onClick={props.onToggleSidebar}
      >
        <PanelLeft aria-hidden="true" />
      </button>
      <SearchField {...props} mac={mac} />
      <div className="topbar-end">
        <TileMenu {...props} />
        <button
          type="button"
          className="icon-btn"
          aria-label="Add folder"
          title={`Add folder (${mac ? '⌘' : 'Ctrl+'}O)`}
          onClick={props.onAddFolder}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}

function SearchField(props: Props & { mac: boolean }) {
  const { inputRef, query, onQuery } = props
  const recentsRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [pick, setPick] = useState(-1)
  const recents = focused && !query ? recentQueries() : []
  const open = recents.length > 0

  useEffect(() => {
    const el = recentsRef.current
    if (!el) return
    if (open && !el.matches(':popover-open')) el.showPopover()
    if (!open && el.matches(':popover-open')) el.hidePopover()
  }, [open])

  return (
    // biome-ignore lint/a11y/useSemanticElements: <search> is the landmark; the label makes the whole field clickable
    <label className="search" role="search">
      <Search aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        aria-label="Search library"
        aria-controls={open ? 'recent-queries' : undefined}
        aria-activedescendant={open && pick >= 0 ? `recent-${pick}` : undefined}
        placeholder={
          'Describe what you’re looking for, like “dog catching a frisbee at dusk”'
        }
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setPick(-1)
          onQuery(e.target.value)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            const step = e.key === 'ArrowDown' ? 1 : -1
            // -1 is the field itself
            setPick(
              (p) =>
                ((p + step + 1 + recents.length + 1) % (recents.length + 1)) -
                1,
            )
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (open && pick >= 0) {
              onQuery(at(recents, pick))
              setPick(-1)
            } else props.onSubmit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            if (query) onQuery('')
            else e.currentTarget.blur()
          }
        }}
      />
      {query ? (
        <button
          type="button"
          className="icon-btn clear"
          aria-label="Clear search"
          onClick={() => {
            onQuery('')
            inputRef.current?.focus()
          }}
        >
          <X aria-hidden="true" />
        </button>
      ) : (
        <span className="kbd" aria-hidden="true">
          {props.mac ? '⌘K' : 'Ctrl K'}
        </span>
      )}
      <div
        ref={recentsRef}
        id="recent-queries"
        className="recents"
        popover="manual"
        role="listbox"
        aria-label="Recent searches"
      >
        <p>Recent</p>
        {recents.map((r, i) => (
          <button
            key={r}
            id={`recent-${i}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={i === pick}
            // mousedown keeps focus in the field so the popover stays anchored to it
            onMouseDown={(e) => {
              e.preventDefault()
              onQuery(r)
            }}
          >
            <History aria-hidden="true" />
            {r}
          </button>
        ))}
      </div>
    </label>
  )
}

function TileMenu(props: Props) {
  const mac = document.documentElement.dataset.platform === 'darwin'
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="Tile size"
        title={`Tile size (${mac ? '⌘' : 'Ctrl'} + / −)`}
        popoverTarget="tile-menu"
        id="tile-button"
      >
        <LayoutGrid aria-hidden="true" />
      </button>
      <div
        id="tile-menu"
        className="menu"
        popover="auto"
        role="menu"
        aria-label="Tile size"
      >
        {ROW_HEIGHTS.map((h, i) => (
          <button
            key={h}
            type="button"
            role="menuitemradio"
            aria-checked={props.rowHeight === h}
            className="menu-item"
            onClick={() => props.onRowHeight(h)}
          >
            {SIZE_NAMES[i]}
            <Check className="check-mark" aria-hidden="true" />
          </button>
        ))}
        <hr />
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={!props.square}
          className="menu-item"
          onClick={() => props.onSquare(!props.square)}
        >
          Show whole photos
          <Check className="check-mark" aria-hidden="true" />
        </button>
      </div>
    </>
  )
}
