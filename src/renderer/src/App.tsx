import { ArrowUpDown, HardDrive, Package, Pause } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Filter,
  Folder,
  FolderId,
  LibraryIndex,
  MediaId,
} from '../../shared/api'
import { count, num } from './format'
import { Grid } from './Grid'
import { type Dates, Header, yearDates } from './Header'
import { clearItems } from './items'
import { monthGroups } from './layout'
import { NoResults, type OpenHit, Results, summary, useSearch } from './Search'
import { type Counts, type Place, Sidebar } from './Sidebar'
import { ROW_HEIGHTS, rememberQuery, Topbar } from './Topbar'
import { Viewer, type ViewerState } from './Viewer'

function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(
    () => JSON.parse(localStorage.getItem(key) ?? 'null') ?? initial,
  )
  const set = useCallback(
    (v: T) => {
      localStorage.setItem(key, JSON.stringify(v))
      setValue(v)
    },
    [key],
  )
  return [value, set] as const
}

const narrow = matchMedia('(max-width: 700px)')

function reversed(i: LibraryIndex): LibraryIndex {
  return {
    ids: i.ids.slice().reverse(),
    aspect: i.aspect.slice().reverse(),
    kind: i.kind.slice().reverse(),
    takenAt: i.takenAt.slice().reverse(),
    durationMs: i.durationMs.slice().reverse(),
  }
}

function years(i: LibraryIndex) {
  const out: number[] = []
  let from = Infinity
  for (const t of i.takenAt) {
    if (t >= from) continue
    const y = new Date(t).getFullYear()
    if (!out.includes(y)) out.push(y)
    from = new Date(y, 0, 1).getTime()
  }
  return out.sort((a, b) => b - a)
}

export function App() {
  const [folders, setFolders] = useState<Folder[] | null>(null)
  const [all, setAll] = useState<LibraryIndex | null>(null)
  const [recent, setRecent] = useState(0)
  const [version, setVersion] = useState(0)
  const [place, setPlace] = useState<Place>({
    scope: { kind: 'all' },
    media: 'all',
  })
  const [dates, setDates] = useState<Dates | null>(null)
  const [query, setQuery] = useState('')
  const [oldest, setOldest] = useState(false)
  const [rowHeight, setRowHeight] = usePersisted<number>(
    'viquery.rowHeight',
    196,
  )
  const [square, setSquare] = usePersisted('viquery.square', false)
  const [sidebarWidth, setSidebarWidth] = usePersisted(
    'viquery.sidebarWidth',
    248,
  )
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const [sidebar, setSidebar] = useState(!narrow.matches)
  const [selection, setSelection] = useState(new Set<MediaId>())
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: MediaId } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // library changes arrive in bursts while indexing: refetch at most every 2s
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let again = false
    const bump = () => {
      clearItems()
      setVersion((v) => v + 1)
      timer = setTimeout(() => {
        timer = undefined
        if (again) {
          again = false
          bump()
        }
      }, 2000)
    }
    const off = window.viquery.onLibraryChanged(() => {
      if (timer) again = true
      else bump()
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch whenever the library changes
  useEffect(() => {
    window.viquery.folders().then(setFolders)
    window.viquery
      .library({ scope: { kind: 'all' }, media: 'all' })
      .then(setAll)
    window.viquery
      .library({ scope: { kind: 'recent' }, media: 'all' })
      .then((i) => setRecent(i.ids.length))
  }, [version])

  const filter = useMemo<Filter>(
    () => ({
      scope: place.scope,
      media: place.media,
      ...(dates && { takenFrom: dates.from, takenTo: dates.to }),
    }),
    [place, dates],
  )
  const searching = query.trim() !== ''

  const [index, setIndex] = useState<LibraryIndex | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch whenever the library changes
  useEffect(() => {
    if (searching) return
    let live = true
    window.viquery.library(filter).then((i) => live && setIndex(i))
    return () => {
      live = false
    }
  }, [filter, version, searching])
  const list = useMemo(
    () => (index && oldest ? reversed(index) : index),
    [index, oldest],
  )
  const groups = useMemo(() => (list ? monthGroups(list) : []), [list])

  // a new view starts at the top with nothing selected
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on view identity only
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setSelection(new Set())
  }, [filter, searching, oldest])

  const counts = useMemo<Counts | null>(() => {
    if (!all) return null
    let video = 0
    for (const k of all.kind) video += k
    return { all: all.ids.length, image: all.ids.length - video, video, recent }
  }, [all, recent])
  const yearList = useMemo(() => (all ? years(all) : []), [all])

  const { state: search, stale } = useSearch(query, filter, version)

  const addFolder = useCallback(async () => {
    const f = await window.viquery.addFolder()
    if (!f) return
    setVersion((v) => v + 1)
    setPlace({ scope: { kind: 'folder', folderId: f.id }, media: 'all' })
  }, [])
  const removeFolder = async (id: FolderId) => {
    await window.viquery.removeFolder(id)
    if (place.scope.kind === 'folder' && place.scope.folderId === id)
      setPlace({ scope: { kind: 'all' }, media: 'all' })
    setVersion((v) => v + 1)
  }

  const onQuery = (q: string) => {
    // typed tokens become chips on space (design §6.2): "video", "photos", "2024"
    if (q.endsWith(' ')) {
      const head = q.trimEnd()
      const k = head.lastIndexOf(' ')
      const word = head.slice(k + 1).toLowerCase()
      const rest = head.slice(0, k + 1)
      if (/^(videos?|clips?)$/.test(word)) {
        setPlace({ ...place, media: 'video' })
        q = rest
      } else if (/^(images?|photos?|pictures?)$/.test(word)) {
        setPlace({ ...place, media: 'image' })
        q = rest
      } else if (/^(19|20)\d\d$/.test(word)) {
        setDates(yearDates(Number(word)))
        q = rest
      }
    }
    setQuery(q)
  }

  const focusResults = () => {
    if (searching) rememberQuery(query.trim())
    scrollRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const typing = (e.target as HTMLElement).matches(
        'input, textarea, select',
      )
      if (
        (mod && (e.key === 'k' || e.key === 'f')) ||
        (!typing && !mod && e.key === '/')
      ) {
        inputRef.current?.focus()
        inputRef.current?.select()
      } else if (mod && e.key === '\\') setSidebar((s) => !s)
      else if (mod && (e.key === '=' || e.key === '+' || e.key === '-')) {
        const i = ROW_HEIGHTS.indexOf(rowHeight as (typeof ROW_HEIGHTS)[number])
        setRowHeight(
          ROW_HEIGHTS[
            Math.max(
              0,
              Math.min(
                ROW_HEIGHTS.length - 1,
                (i < 0 ? 2 : i) + (e.key === '-' ? -1 : 1),
              ),
            )
          ]!,
        )
      } else if (mod && e.key === 'o') addFolder()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rowHeight, setRowHeight, addFolder])

  // crossing the narrow breakpoint turns the sidebar into a closed drawer and back
  useEffect(() => {
    const change = () => setSidebar(!narrow.matches)
    narrow.addEventListener('change', change)
    return () => narrow.removeEventListener('change', change)
  }, [])

  const choosePlace = (p: Place) => {
    setPlace(p)
    if (narrow.matches) setSidebar(false)
  }

  const openHit: OpenHit = (ids, index, mode, moments) => {
    rememberQuery(query.trim())
    setViewer(
      moments
        ? { mode, ids, index, moments, query: query.trim() }
        : { mode, ids, index },
    )
  }

  const folderId = place.scope.kind === 'folder' ? place.scope.folderId : null
  const folder = folders?.find((f) => f.id === folderId)
  const placeName =
    folder?.name ??
    (place.scope.kind === 'recent'
      ? 'Recently added'
      : { all: 'All media', image: 'Images', video: 'Videos' }[place.media])

  const header = (props: Partial<Parameters<typeof Header>[0]>) => (
    <Header
      title={placeName}
      media={place.media}
      onMedia={(media) => setPlace({ ...place, media })}
      dates={dates}
      onDates={setDates}
      years={yearList}
      {...props}
    >
      {selection.size > 0 ? (
        <span className="selection-bar">
          {selection.size === 1 && (
            <button
              type="button"
              className="btn"
              onClick={() => window.viquery.reveal([...selection][0]!)}
            >
              {document.documentElement.dataset.platform === 'darwin'
                ? 'Show in Finder'
                : 'Show in folder'}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => setSelection(new Set())}
          >
            Deselect
          </button>
        </span>
      ) : (
        props.children
      )}
    </Header>
  )
  const selected = selection.size > 0 ? `${num(selection.size)} selected` : null

  let content: React.ReactNode = null
  if (folders && folders.length === 0) content = <FirstRun onAdd={addFolder} />
  else if (searching) {
    const result = search && 'result' in search ? search.result : null
    const pending = result ? result.pending.images + result.pending.videos : 0
    const shown = result
      ? (place.media === 'image' ? 0 : result.videos.length) +
        (place.media === 'video' ? 0 : result.images.length)
      : 0
    content = (
      <>
        {header({
          title:
            selected ??
            (folder || place.scope.kind === 'recent'
              ? `Results in ${placeName}`
              : 'Results'),
          meta: result && !selected ? summary(result, place.media) : undefined,
          counts: result
            ? { image: result.images.length, video: result.videos.length }
            : undefined,
        })}
        <div ref={scrollRef} className="scroll">
          {pending > 0 && shown > 0 && (
            <p className="status-line">
              Still indexing{' '}
              {[
                result?.pending.images && count(result.pending.images, 'image'),
                result?.pending.videos && count(result.pending.videos, 'video'),
              ]
                .filter(Boolean)
                .join(' and ')}
              . Results may grow.
            </p>
          )}
          {search && 'error' in search && (
            <p className="error-line">Search failed: {search.error}</p>
          )}
          {result && shown > 0 && (
            <Results
              result={result}
              stale={stale}
              media={place.media}
              scrollRef={scrollRef}
              folders={folders ?? []}
              rowHeight={rowHeight}
              square={square}
              selection={selection}
              onSelect={setSelection}
              onOpen={openHit}
              focusRequest={focusRequest}
            />
          )}
          {result && shown === 0 && !stale && (
            <NoResults
              query={query.trim()}
              scoped={place.scope.kind !== 'all'}
              dated={dates !== null}
              hiddenByMedia={result.images.length + result.videos.length}
              pendingVideos={result.pending.videos}
              onAllMedia={() =>
                setPlace({ scope: { kind: 'all' }, media: place.media })
              }
              onClearDates={() => setDates(null)}
              onShowAll={() => setPlace({ ...place, media: 'all' })}
            />
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {result && !stale
              ? summary(result, place.media) || 'No matches'
              : ''}
          </span>
        </div>
      </>
    )
  } else if (list) {
    content = (
      <>
        {header({
          title: selected ?? placeName,
          meta: selected
            ? undefined
            : count(
                list.ids.length,
                place.media === 'all' ? 'item' : place.media,
              ),
          children: (
            <button
              type="button"
              className="icon-btn"
              aria-label={oldest ? 'Sort: oldest first' : 'Sort: newest first'}
              title={oldest ? 'Oldest first' : 'Newest first'}
              aria-pressed={oldest}
              onClick={() => setOldest(!oldest)}
            >
              <ArrowUpDown aria-hidden="true" />
            </button>
          ),
        })}
        <div ref={scrollRef} className="scroll">
          {list.ids.length > 0 ? (
            <Grid
              list={list}
              groups={groups}
              rowHeight={rowHeight}
              square={square}
              scrollRef={scrollRef}
              label={placeName}
              sticky
              selection={selection}
              onSelect={setSelection}
              onOpen={(i, mode) => setViewer({ mode, ids: list.ids, index: i })}
              focusRequest={focusRequest}
            />
          ) : (
            <EmptyView
              dates={dates}
              folder={folder}
              onClearDates={() => setDates(null)}
            />
          )}
        </div>
      </>
    )
  }

  const width = liveWidth ?? sidebarWidth
  return (
    <div
      className="app"
      data-sidebar={sidebar ? 'open' : 'closed'}
      data-resizing={liveWidth !== null || undefined}
      style={{ '--sidebar-width': `${width}px` } as React.CSSProperties}
    >
      <Topbar
        inputRef={inputRef}
        query={query}
        onQuery={onQuery}
        onSubmit={focusResults}
        sidebarOpen={sidebar}
        onToggleSidebar={() => setSidebar(!sidebar)}
        rowHeight={rowHeight}
        onRowHeight={setRowHeight}
        square={square}
        onSquare={setSquare}
        onAddFolder={addFolder}
      />
      <Sidebar
        place={place}
        counts={counts}
        folders={folders ?? []}
        onPlace={choosePlace}
        onAddFolder={addFolder}
        onRemoveFolder={removeFolder}
        onResize={(x, done) => {
          const w = Math.max(200, Math.min(360, Math.round(x)))
          if (done) {
            setLiveWidth(null)
            setSidebarWidth(w)
          } else setLiveWidth(w)
        }}
      />
      <main className="main" aria-label={placeName}>
        {content}
        {viewer && (
          <Viewer
            {...viewer}
            folders={folders ?? []}
            onChange={setViewer}
            onClose={(id) => {
              setViewer(null)
              setFocusRequest({ id })
            }}
          />
        )}
      </main>
    </div>
  )
}

function FirstRun(props: { onAdd: () => void }) {
  return (
    <div className="empty">
      <div className="empty-body">
        <h2>Search your photos and videos by what’s in them</h2>
        <p>
          viquery reads your photos and videos where they are and builds a
          private search index on this device. Your files aren’t moved or
          changed.
        </p>
        <ul className="facts">
          <li>
            <HardDrive aria-hidden="true" />
            Everything runs on this computer. Your media and your searches never
            leave it.
          </li>
          <li>
            <Package aria-hidden="true" />
            The search model comes with the app, so nothing downloads.
          </li>
          <li>
            <Pause aria-hidden="true" />
            Indexing runs in the background at low priority. Browse while it
            works, and pause it anytime.
          </li>
        </ul>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={props.onAdd}
          >
            Add folder…
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyView(props: {
  dates: Dates | null
  folder: Folder | undefined
  onClearDates: () => void
}) {
  return (
    <div className="empty">
      <div className="empty-body">
        <h2>
          {props.dates
            ? `Nothing from ${props.dates.label}`
            : 'Nothing here yet'}
        </h2>
        {!props.dates && (
          <p>
            {props.folder
              ? 'Items appear here as viquery finds them in this folder.'
              : 'Items appear here as viquery finds them.'}
          </p>
        )}
        {props.dates && (
          <div className="actions">
            <button type="button" className="btn" onClick={props.onClearDates}>
              Clear date filter
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
