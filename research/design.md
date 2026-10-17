# viquery design system and screen specs

status: research draft, 2026-10-17. visual reference: `research/mockup.html` (open it with `?view=library` or `?view=search`) and `research/mockup-{library,search}-{light,dark}.png` (1440×900 @2x, rendered with playwright-core driving local chrome with `colorScheme` emulation).

## 0. product stance

- **register: product.** the design serves the library. the user's own photos and videos are the only colorful thing on screen. the chrome stays neutral and steps back.
- **scene:** someone at a laptop in the evening, sometimes on a bright office monitor, scrolling years of their own media to find one clip ("the bit where the kids jump off the dock"). theme follows the os, because both lighting cases are real. light and dark get equal care.
- **color strategy: restrained.** neutral greys with a faint teal tint on text, plus one teal accent used only for focus, selection, progress, and match markers. this is the accent mux and hibi already share, so it is preserved, not invented.
- **personality (from mux `PRODUCT.md`):** native, quiet, direct. content determines hierarchy. no ornamental cards, oversized controls, or wasted space.
- note: impeccable's `context.mjs` reported `NO_PRODUCT_MD`. this pass was limited to writing under `research/`, so no root `PRODUCT.md` was created. §0 stands in for it until the user runs `impeccable init`.

## 1. shared language of mux + hibi (extracted)

the two apps already agree on almost everything. viquery adopts the shared values exactly and only adds media-specific tokens.

| concern | mux | hibi | viquery takes |
|---|---|---|---|
| color tokens | hex `--background #fff / #181818`, `--surface #f5f5f5 / #202020`, `--ink #1b2021`, `--muted #596363`, `--accent #066166 / #81cdd1`, `--border #e3e3e3 / #313131`, `--hover`, `--active` (`mux/src/renderer/styles.css:23-97`) | same roles in oklch: `--accent oklch(0.45 0.075 200)` / `oklch(0.8 0.075 200)`, ink/muted tinted hue 200 (`hibi 2/src/ui/tokens.css:4-56`) | hibi's oklch form with mux's dark steps (bg 0.205, surface 0.235, elevated 0.25) |
| status | `#236032 #704600 #aa2233`, dark `#b4e6a4 #edcf8f #ffb0b0` (both files) | identical, plus `--status-info` | identical |
| font | Geist variable + Geist Mono, but `-apple-system` on darwin (`mux/src/renderer/styles.css:1-21,74`) | Geist / Geist Mono (`tokens.css:58-59`) | same: system font on macOS, Geist elsewhere |
| type scale | 11 / 12 / 13 (ui) / 15 (body) | 11 / 12 / 13 / 14 (heading) / 16 (editor) | 11 / 12 / 13 / 15 / 17 |
| spacing | 4 · 8 · 12 · 16 · 24 · 32 | identical | identical |
| radii | control 6, surface 16, popover 10 (`::picker(select)`), main card 12 top-left (`sidebar.css:22`) | control 6 everywhere, round 999 | tile 4, control 6, popover 10, frame 12 |
| control height | 28 | 28 | 28 (search field 30) |
| sidebar | 256 wide, 30px rows, 9px icon gap, `margin 0 8px`, radius 6, `--hover` / `--active` fills, 11px muted section headings (`styles.css:206-217`) | 256 wide, 28px rows, 15px icons, chevrons, footer with small buttons (`hibi 2/src/ui/sidebar.css:44-60,220-290`) | 248 wide, 28px rows, mux row geometry |
| titlebar | `hiddenInset` + `trafficLightPosition {x:12,y:13}` on mac; `titleBarOverlay` 36px with theme colors on win/linux; 40px topbar, `-webkit-app-region: drag`; 148px right inset on win/linux (`mux/src/main/main.ts:252-298`, `styles.css:190-198`) | `hiddenInset` + `{x:12,y:11}`, 36px titlebar, 132+8px right inset on win/linux (`hibi 2/src/main/index.ts:753-756`, `src/renderer/src/styles.css:155-215`) | mux's: 40px topbar, `{x:12,y:13}` |
| frame | sidebar + topbar share `--surface`; main column is a card on `--background` with a 1px top/left border and a 12px top-left radius (`mux/src/renderer/sidebar.css:8-22`) | sidebar on `--sidebar` (= surface) | same frame + card |
| focus | `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`; fields use offset -2 (`styles.css:117,137`) | 2px accent, offset -2 (`controls.css:47-52`) | 2px accent; offset 2 on controls, 1 on tiles, -1 on the search field |
| shadows | one token, `--shadow-raised`, for popovers and tooltips only | menus `0 6px 24px var(--overlay)` (`menus.css:14`) | `--shadow-raised`, popovers only |
| motion | 120 fast / 200 base / 240 pane, `cubic-bezier(0.22,1,0.36,1)`; global reduced-motion kill switch (`styles.css:64-66,219-221`) | 120 / 160 / 180 / 240, `cubic-bezier(0.2,0.8,0.2,1)` | mux's curve and steps |
| accent override | settings › accent: default / system / custom. `data-accent` remaps hover/active/selection onto the accent (`mux/src/renderer/accent.ts`, `styles.css:99-108`) | colorschemes swap semantic values in a layer (`colorschemes.ts`) | support system accent later; ship the default teal |
| icons | `lucide` 1.48, stroke 1.75, 16px (`mux/src/renderer/icons.ts:52`) | `lucide-react` 1.55, 15–16px | `lucide-react`, stroke 1.75, 16px (14px inside chips) |
| popovers | native `[popover]`, `@starting-style` fade, `appearance: base-select` | `.ui-menu` popover with translateY(-3px) fade | native popover |
| scrollbars | native | `scrollbar-width: thin` | native (product ban: no custom scrollbars) |

## 2. tokens

single source. `color-scheme: light dark` plus a `prefers-color-scheme` override block, matching both reference apps. all mixes are srgb: mixing the hue-200 accent with a hue-0 grey in oklch drifts toward purple, which the first mockup render showed.

```css
:root {
  color-scheme: light dark;
  accent-color: var(--accent);

  /* surfaces + ink */
  --background: oklch(1 0 0);            /* content card, viewer */
  --surface: oklch(0.97 0 0);            /* frame: sidebar, topbar, segmented track */
  --elevated: oklch(1 0 0);              /* popovers, pressed segment */
  --ink: oklch(0.24 0.008 200);
  --muted: oklch(0.49 0.012 200);        /* ≥4.5:1 on --surface and --background */
  --accent: oklch(0.45 0.075 200);
  --accent-ink: oklch(1 0 0);
  --border: oklch(0.9 0 0);
  --border-strong: oklch(0.83 0.005 200);
  --hover: oklch(0.94 0 0);
  --active: oklch(0.915 0 0);
  --field: oklch(1 0 0);
  --selection: color-mix(in srgb, var(--accent) 22%, var(--background));

  /* media-specific */
  --tile: oklch(0.94 0 0);               /* empty tile box before thumbhash/thumbnail */
  --track: oklch(0.9 0 0);               /* timeline + progress tracks */
  --match: var(--accent);                /* the matching scene this card/frame shows */
  --match-dim: color-mix(in srgb, var(--accent) 40%, var(--track)); /* other matching scenes */
  --on-media: oklch(1 0 0);              /* text/icons drawn over thumbnails */
  --media-scrim: linear-gradient(to top, oklch(0 0 0 / 0.55), oklch(0 0 0 / 0) 48%);
  --viewer-backdrop: oklch(0.13 0 0);    /* lightbox/player canvas in both themes */

  --status-success: #236032;
  --status-warning: #704600;
  --status-danger: #aa2233;
  --shadow-raised: 0 1px 2px rgb(0 0 0 / 4%), 0 8px 24px -12px rgb(0 0 0 / 12%); /* popovers only */

  /* type */
  --font-ui: "Geist", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --text-xs: 11px;      /* counts, durations, timecodes on media */
  --text-sm: 12px;      /* secondary meta, sidebar footer */
  --text-ui: 13px;      /* default: rows, buttons, fields, names */
  --text-title: 15px;   /* main header (600) */
  --text-heading: 17px; /* empty/first-run headline only */

  /* space + shape */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
  --radius-tile: 4px;
  --radius-control: 6px;
  --radius-popover: 10px;
  --radius-frame: 12px;
  --control-height: 28px;
  --topbar-height: 40px;
  --sidebar-width: 248px;   /* resizable 200–360 */
  --sidebar-row: 28px;
  --tile-gap: 4px;
  --row-height: 196px;      /* justified target; zoom steps 120 / 160 / 196 / 260 */

  /* motion */
  --motion-fast: 120ms;     /* hover, press, color */
  --motion-base: 200ms;     /* popovers, chips, view swaps */
  --motion-pane: 240ms;     /* sidebar, viewer open/close */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);

  /* layers */
  --z-sticky: 1; --z-topbar: 2; --z-popover: 10; --z-viewer: 20; --z-toast: 30; --z-tooltip: 40;
}
:root[data-platform="darwin"] { --font-ui: -apple-system, BlinkMacSystemFont, "Geist", system-ui, sans-serif; }

@media (prefers-color-scheme: dark) {
  :root {
    --background: oklch(0.205 0 0);
    --surface: oklch(0.235 0 0);
    --elevated: oklch(0.25 0 0);
    --ink: oklch(0.93 0.005 200);
    --muted: oklch(0.72 0.012 200);
    --accent: oklch(0.8 0.075 200);
    --accent-ink: oklch(0.205 0 0);
    --border: oklch(0.31 0 0);
    --border-strong: oklch(0.4 0.005 200);
    --hover: oklch(0.27 0 0);
    --active: oklch(0.3 0 0);
    --field: oklch(0.22 0 0);
    --tile: oklch(0.26 0 0);
    --track: oklch(0.33 0 0);
    --status-success: #b4e6a4;
    --status-warning: #edcf8f;
    --status-danger: #ffb0b0;
    --shadow-raised: 0 1px 2px rgb(0 0 0 / 30%), 0 8px 24px -12px rgb(0 0 0 / 50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 0s !important; }
}
@media (prefers-reduced-transparency: reduce) { :root { --media-scrim: linear-gradient(to top, oklch(0 0 0 / 0.7), oklch(0 0 0 / 0) 55%); } }
@media (prefers-contrast: more) { :root { --border: var(--border-strong); --muted: var(--ink); } }
```

state vocabulary, used the same way everywhere:

- hover: `--hover`
- pressed or current: `--active`
- keyboard focus: 2px `--accent` outline
- selected media: 2px `--accent` outline at offset 1, plus an accent check disc in the top-left
- disabled: opacity 0.5
- offline source: `--muted` text with an "Offline" count
- error: `--status-danger` text inline, never a modal
- loading: `--tile` box, then thumbhash, then thumbnail. no spinners in content.

## 3. typography

- one family, no display font. weight carries hierarchy: 400 body, 500 controls and names, 600 titles and group heads.
- fixed px scale, no clamp(). letter-spacing -0.01em only on `--text-title`.
- `font-variant-numeric: tabular-nums` on every count, duration, timecode, and progress number, so live-updating numbers don't jitter.
- timestamps are shown as `m:ss` or `h:mm:ss` with an en dash for ranges (`2:14 – 2:31`), never as raw seconds.
- names ellipsize on one line. meta lines are `--text-sm` muted, joined with ` · `.
- placeholder copy has to meet 4.5:1 too. it uses `--muted`, never a lighter grey.

## 4. iconography

`lucide-react`, stroke 1.75, round caps and joins. 16px in rows and the topbar, 14px in chips and small buttons, 11px filled for the play glyph inside a timestamp. icons are `aria-hidden`, and the button carries `aria-label`.

| use | lucide name |
|---|---|
| all media / images / videos | `images` / `image` / `video` |
| recently added | `clock` |
| folder / offline drive | `folder` / `hard-drive` |
| smart filter (built-in) | domain icon (`monitor` for screenshots, `film` for long videos) |
| saved search | `scan-search` |
| search, clear | `search`, `x` |
| date chip, sort | `calendar`, `arrow-up-down` |
| tile size | `layout-grid` |
| add folder | `plus` (`folder-plus` in menus) |
| pause / resume indexing | `pause` / `play` |
| prev / next match | `chevron-left` / `chevron-right`, or `skip-back` / `skip-forward` in the player |

no sparkles icon or "AI" glyph. semantic search is simply how the search box works, not a feature to advertise.

## 5. layout and window chrome

```
┌─ frame (--surface) ───────────────────────────────────────────────────────────┐
│ ● ● ●  [▣]        [⌕ Describe what you're looking for…            ⌘K]   [▦][+] │ 40px topbar, drag region
│ ┌ sidebar 248 ┐ ╭─ content card (--background, 1px border top/left, r12) ────╮ │
│ │ All media   │ │ All media  12,408 items        [All|Images|Videos] [📅] [⇅]│ │ 48px header
│ │ Images      │ │ October 2026 48                     (sticky group head)  │ │
│ │ Videos      │ │ ▭▭▭ ▭ ▭▭▭▭ ▭▭▭ ▭▭  justified rows, 4px gap                │ │
│ │ Recent      │ │ ...virtualized...                                        │ │
│ │ Folders  +  │ │                                                          │ │
│ │ Smart    +  │ │                                                          │ │
│ │─────────────│ │                                                          │ │
│ │ Indexing…   │ │                                                          │ │
│ └─────────────┘ ╰──────────────────────────────────────────────────────────╯ │
└───────────────────────────────────────────────────────────────────────────────┘
```

**window chrome** (docs: https://www.electronjs.org/docs/latest/tutorial/custom-title-bar, rendered for electron 44.7.2):

- macOS: `titleBarStyle: 'hiddenInset'` with `trafficLightPosition: { x: 12, y: 13 }`. the lights' centers then sit on the 40px topbar's midline, the same as mux. the sidebar toggle sits at `left: 80px`.
- windows/linux: `titleBarStyle: 'hidden'` and `titleBarOverlay: { color, symbolColor, height: 40 }`, with colors read from `nativeTheme` and updated on `nativeTheme` `updated` (the mux pattern, `main.ts:252-258,357`). the docs say DOM can't use the area under the overlay. reserve it with the window-controls-overlay env vars (`padding-right: calc(100vw - env(titlebar-area-x) - env(titlebar-area-width))`) rather than mux/hibi's hard-coded 132–148px. fall back to 140px if the env vars are unavailable.
- the topbar is `app-region: drag`. every interactive child is `no-drag`. the topbar never scrolls with content: the shell is `overflow: clip` and only the grid scrolls (mux `styles.css:186`).
- `BrowserWindow` `backgroundColor` matches `--background` per theme, so there is no white flash before first paint.
- no vibrancy or backdrop blur on the sidebar by default. mux allows an optional blurred backdrop, but a gallery needs every frame of scroll budget.

**sidebar** (248px, resizable 200–360 with a 6px hit strip that shows a 1px accent line on hover or drag, as in mux `sidebar.css:39-43`; collapses with ⌘\ or the toggle; below 700px window width it becomes an overlay drawer):

1. library: All media, Images, Videos, Recently added. tabular counts on the right, muted.
2. Folders: each added root folder, with a hover-revealed `+` in the section heading. a folder on a disconnected drive stays listed in muted text with "Offline", and its items stay searchable from the index; the original opens once the drive returns. right-click opens reveal in finder/explorer, rescan, remove from library (confirm inline; files are never touched).
3. Smart filters: built-ins (Screenshots, Videos over 10 min) followed by saved searches. a saved search is a query plus its chips, stored with a name and pinned from the results header ("Save search"). names are lowercase as the user typed them.
4. footer: indexing status (§6.6).

**topbar:** sidebar toggle at left. the search field is centered in the window (not aligned to the content column), `min(560px, …)` wide and 30px tall; it stays centered when the sidebar collapses and shrinks before it would overlap the toggle or right controls. at the right edge: tile size and add folder. (user decision 2026-10-17.)

**content header** (48px, inside the card): title (15/600) and a muted count on the left. on the right: segmented `All | Images | Videos` (with counts in search mode), the date chip, and sort. the same row and the same controls appear in library and search, so filters never jump.

## 6. screens

### 6.1 library grid

- **justified rows** (flickr style) in date groups, newest first. each row has a fixed height (`--row-height`) and widths come from the aspect ratio stored in the db, so geometry is known before any pixel loads. layout uses `justified-layout` from flickr (isc, https://github.com/flickr/justified-layout). not `@immich/justified-layout-wasm`: it is agpl-3, incompatible with an mit app.
- **uniform square grid** is the alternative toggle (tile-size menu: "Show whole photos" on or off). it suits screenshots and mixed-ratio folders.
- **group heads**: month and year (600) plus a muted count and dominant folder. they are sticky at `--z-sticky` on an opaque `--background`, with no blur. a day level appears only at the largest zoom.
- **tiles**: radius 4, `--tile` fill until loaded. no border, no shadow, no hover lift.
- **video tile**: a bottom gradient of 34% to 42% black, and duration at the bottom-right (11/500, `--on-media`, text-shadow).
- **hover scrub** (eagle-style, https://en.eagle.cool/support/article/hover-preview):
  - pointer x maps to a frame from a pre-rendered sprite sheet of 1 frame per ~2% of duration, generated at index time.
  - a 2px playhead line runs along the bottom, and the current timecode shows at the bottom-left.
  - no `<video>` element is created on hover. an optional muted playback of the real file starts only after the pointer rests for 600ms on a single tile.
  - with reduced motion: no autoplay, and the scrub still follows the pointer because it is user-driven.
- **selection**:
  - click selects, ⌘/ctrl-click toggles, and shift-click selects a range.
  - selected tiles get an accent outline and a check disc.
  - a selection count replaces the header title ("3 selected", with reveal, copy, and add to filter).
- **double-click / enter** opens the viewer. **space** opens quick look (§6.4).

### 6.2 search

- **one field.**
  - placeholder: `Describe what you're looking for, like "dog catching a frisbee at dusk"`.
  - it searches the current sidebar scope: the header reads "Results in Lake house" when scoped, and a scope chip can be removed.
  - search runs as you type (debounced ~120ms), with no submit button. enter moves focus to the first result.
  - esc clears; a second esc blurs.
  - recent queries appear in a popover under the empty, focused field. the popover is native `[popover]`, anchored, and up/down picks a query.
- **filter chips** stay in the header row:
  - media-type segmented control, with counts per type in search mode.
  - date chip: presets plus a range picker. a set chip shows a tinted fill and an `x`.
  - typed tokens become chips. `video`, `2024`, and `last summer` are parsed into chips on space, so there is still only one field.
- **results** split into two sections, ordered by which holds the top-scoring hit:
  - **Moments** (videos): one moment card per video (§6.3), in an auto-fill grid with `minmax(248px, 1fr)` columns and a 16:9 frame.
  - **Images**: justified rows at a smaller row height (172px), in rank order left to right.
  - the header summary is exact and plain: "7 moments in 4 videos · 11 images". no relevance percentages or confidence bars. rank order is the signal.
- **while the index is incomplete**: a muted line under the header reads "Still indexing 1,254 videos. Results may grow." and results stream in place without reflowing items already shown (append only).

### 6.3 moment card (video hit)

```
┌────────────────────────────┐
│     matching frame (16:9)  │  thumbnail = best-scoring frame of best scene
│ ▶ 2:14 – 2:31              │  range of the shown scene, on a scrim
└────────────────────────────┘
━━━━━▪━━━━━━━━▬▬━━━━━━━━▪━━━━  4px track = full video; one mark per matching scene
IMG_4412.MOV          3 scenes  (500) name · muted count
Lake house · Jul 19, 2026 · 4:06
```

- not a bordered card. it is media plus text, with focus and hover drawn on the frame.
- **mini timeline**:
  - the track spans the whole duration.
  - each matching scene is a `--match-dim` segment, at least 3px wide.
  - the scene the frame shows is `--match` and 2px taller.
  - this is the same idea as youtube's "most replayed" heat on the seek bar and frame.io's comment markers on the timeline: a compressed map of where things are in time.
- **hovering a marker** swaps the frame to that scene's best frame and updates the range label.
- **scrubbing the frame** previews frames inside the shown scene only.
- **click** opens the player seeked to the scene start minus 1s. clicking a marker opens at that scene.
- **keyboard**: ←/→ moves between cards. while a card is focused, `[`/`]` cycles its scenes, and the frame, label, and live region update ("scene 2 of 3, 2:14 to 2:31").
- **scenes**: adjacent matched windows merge when the gap is under ~2s, so one action reads as one range and not five slivers.

### 6.4 detail viewer

the viewer opens in place over the content card, not over the sidebar, so the library context stays visible.

- canvas is `--viewer-backdrop` in both themes, so media colors read true.
- the transition from the clicked tile is a 240ms scale and fade with `--ease-out`. with reduced motion it is a plain crossfade.
- esc returns to the grid, and focus goes back to the tile it came from.

**image lightbox:**

- the image is fit to the canvas at 1:1 max. pinch or ⌘+/- zooms, and drag pans.
- ←/→ moves to the previous or next image in the current list (library order or rank order).
- a thin bottom bar holds the name, date, dimensions, folder, and reveal in finder.
- `i` toggles an info panel on the right (320px): exif, path, and "similar" (nearest neighbours by embedding).

**video player:**

- native `<video>` with custom minimal controls: play, current time / duration, volume, speed, fullscreen.
- **scrubber with match markers**:
  - the seek track carries `--match-dim` ranges for every matching scene of the active query, and `--match` for the current one.
  - hovering the track shows a sprite-frame preview with its timecode.
  - prev/next match buttons sit beside the play button. keys `[`/`]` or `n`/`shift+n` jump between matches.
- **scene strip** under the player:
  - one horizontally scrolling strip of detected-scene thumbnails, 96px tall, at 16:9.
  - matching scenes get a 2px accent outline and their range label. the playing scene gets an `--active` underline.
  - clicking a scene seeks to it. the strip auto-scrolls to keep the current scene in view, smooth unless reduced motion is on.
- **after a search**: the player opens with the query as a removable chip ("matches for: kids jumping off a dock") so the markers' meaning is explicit. removing the chip clears the markers.

**quick look** (space): a centered preview popover at about 70% of the card, with no chrome except name and esc. space again or esc closes it, and arrows move to the next item while it stays open. video autoplays muted from the matched moment, or from 0 in the library.

### 6.5 empty, no results, errors

- **empty library** (no folders): centered in the card, left-aligned text, max 420px.
  - headline (17/600): "Add a folder to start"
  - body (13, muted): "viquery reads your photos and videos where they are and builds a private search index on this device. Nothing is uploaded, and your files aren't moved or changed."
  - a primary "Add folder…" button, plus a drop target: dragging a folder anywhere on the window highlights the card border in accent.
- **no results**: "No matches for "purple giraffe"" followed by concrete next steps as buttons that do the thing. each appears only if relevant:
  - "Search all media" (when scoped)
  - "Clear date filter"
  - "Search the 1,254 videos still indexing when they finish"
  - never "Try a different search."
- **folder unavailable**: inline in the sidebar row (muted, "Offline"), never a dialog.
- **file missing at open**: the viewer shows its thumbnail and the line "The original moved or was deleted," with a "Rescan folder" button.

### 6.6 indexing state

- this always lives in the sidebar footer and is never modal.
- **layout**:
  - line 1: "Indexing videos" with tabular "1,284 of 2,538" and a pause button.
  - line 2: a 3px accent meter.
  - line 3: muted "Search works on what's done" and "~18 min".
  - `role="status"`, `aria-live="polite"`, with announcements throttled to every 10%.
- **phases**, named by what the user gets:
  - "Finding files"
  - "Making thumbnails" (the grid is fully usable after this)
  - "Indexing images"
  - "Indexing videos"
- **when done**, the footer collapses to one muted line, "12,408 items · up to date", which fades after 4s. hovering the footer shows last scan time and index size.
- **paused** reads "Paused · resume", and the state survives restarts. on battery the footer reads "Waiting for power", which can be overridden.
- **items not yet indexed** show normally in the grid. no badge on every tile. a filter "Not indexed yet" exists in the date/type menu for the curious.

### 6.7 first run (model and privacy)

this is one screen in the content card, not a wizard and not a modal. the sidebar stays visible and empty.

1. headline "Search your photos and videos by what's in them".
2. three short facts, each with an icon, all plain sentences:
   - "Everything runs on this computer. Your media and your searches never leave it."
   - "The search model (~180 MB) is included / downloads once when you click below." the exact copy depends on the packaging decision.
   - "Indexing runs in the background and pauses when you're busy or on battery."
3. primary "Add folder…", secondary "Choose model…". the secondary button sits behind a disclosure for advanced users and shows the model name and size.
4. if the model needs downloading, the button reads "Download model (180 MB)". this is the only network action in the app. progress shows in the sidebar footer like indexing, cancellable and resumable.

## 7. keyboard model

| key | action |
|---|---|
| ⌘K / ctrl+K, `/` , ⌘F | focus search (select all) |
| esc | clear search, then blur; close quick look/viewer; clear selection |
| enter (in search) | move focus to first result |
| ← → ↑ ↓ | move focus in grid; ↑/↓ use row geometry (nearest tile by x-center), not index ±n |
| home / end, page up/down | first / last item, by viewport |
| space | quick look toggle |
| enter / ⌘↓ | open viewer |
| shift+arrows | extend selection; ⌘A select all in view |
| `[` / `]` | previous / next matching scene (moment card focused, or in player) |
| j / k / l | player: back 10s / play-pause / forward 10s (space also play-pause in player) |
| `i` | toggle info panel in viewer |
| ⌘\ / ctrl+\ | toggle sidebar |
| ⌘+ / ⌘- | tile size (row height steps) |
| ⌘O | add folder |
| ⌘⌫ | remove selected from library (confirm; never deletes files) |

the grid is a single tab stop with roving `tabindex` (`role="grid"`, items `role="gridcell"`). tab moves between regions: sidebar, search, header, grid, footer.

## 8. accessibility basics

- contrast, computed from the oklch tokens:
  - light: muted is 5.7:1 on `--surface` and 6.2:1 on `--background`; accent is 7.2:1 on `--background`.
  - dark: muted is 6.8:1 on `--surface`, 7.3:1 on `--background`, and 6.5:1 on `--elevated`; accent is 9.9:1 on `--background`.
  - text over media always sits on `--media-scrim` with a text-shadow.
- focus is always visible (2px accent). the focused tile scrolls into view with `block: nearest`.
- every image tile has an `aria-label` built from filename, date, and kind, for example "IMG_4412.MOV, video, 4 minutes, July 19 2026". the best caption from the index can be appended when available.
- the moment card's timeline has `aria-label="3 matching scenes"`, and each marker is a button with its range.
- live regions: indexing status (polite, throttled) and the result count after search settles ("7 moments in 4 videos, 11 images").
- reduced motion: no viewer zoom transition, no autoplay on hover, and scroll-into-view is instant. the global kill switch from mux covers stray transitions.
- reduced transparency or increased contrast: a heavier scrim, and stronger borders and muted text (see the token block).
- hit targets are at least 28px for controls and 24px for chip close buttons. drag regions never swallow clicks (`no-drag` on every control).
- copy is sentence case with plain verbs. no "magic," "AI-powered," or "smart" in body copy. "Smart filters" is the one product noun.

## 9. performance-minded ui rules

1. **virtualize everything.** only rows intersecting the viewport ±1 screen are mounted. row geometry comes from the justified layout over all items, computed in wasm in under 1ms for 100k items per immich's readme. scroll height is exact from the start, so the scrollbar never jumps.
2. **fixed boxes, no layout shift.** width and height derive from the stored aspect ratio before load. the image is `object-fit: cover` inside its box. a moment frame is always 16:9.
3. **placeholder ladder.**
   - `--tile` color first.
   - then a thumbhash decoded to a data url (https://github.com/evanw/thumbhash), stored in sqlite, about 25 bytes per item.
   - then the cached thumbnail.
   - no fade-in animation on images while scrolling fast. fade only when the image arrives after 100ms.
4. **thumbnails from cache only.** the renderer never decodes originals in the grid.
   - thumbnails are pre-generated at 2 sizes (~256 and ~512 on the long edge, webp or avif) by the worker.
   - they are served through a custom protocol (`viquery-thumb://id/size`) with immutable cache headers.
   - `decoding="async"`, `loading="lazy"` as a backstop, and `fetchpriority="high"` for the first screen.
5. **no heavy paint on scroll.**
   - no `backdrop-filter`, no blur, no box-shadows on tiles.
   - sticky group heads are opaque.
   - hover effects pause while scrolling: set `data-scrolling` on the scroller for 150ms after the last scroll event.
6. **sprites for scrub, not video.** hover scrub uses a sprite sheet image and a background-position change, which costs one composite. `<video>` elements are created only in the viewer or quick look, at most one alive.
7. **search ui never waits on the model.**
   - type, then debounce 120ms, then the query embedding runs in a worker, then vector search.
   - stale responses are dropped by sequence id.
   - previous results stay on screen, dimmed to 60% opacity, until the new set arrives.
   - no skeleton flash under 150ms.
8. **indexing never janks the ui.**
   - progress events are coalesced to at most 4 per second at the renderer.
   - counts update with tabular nums, so text width doesn't change.
   - new items append to groups below the viewport, never above it. if one lands above, the scroll position is anchored with `overflow-anchor`.
9. **budget**: input to first result paint under 100ms on 100k items, and 60fps scroll on the m2 baseline. measure with the brief's protocol: baseline, workload, runs, spread.

## 10. references worth stealing

- **apple photos (macOS)**: ⌘F focuses the toolbar search, and natural-language search finds "a key moment in a video" (https://support.apple.com/guide/photos/search-for-photos-and-videos-pht64de33e5a/mac, https://support.apple.com/guide/mac-help/use-apple-intelligence-in-photos-mchl35c53342/mac). steal: one search field in the toolbar, suggestions while typing, combinable terms ("beach 2017") turned into chips, and a video result that opens at the moment.
- **eagle**: hover preview for video, GIF, and audio directly in the grid (https://en.eagle.cool/support/article/hover-preview), and dense justified/waterfall layouts. steal: hover scrub with no click, and a way to disable it.
- **immich**: CLIP "contextual" search plus filters for type, date, folder, and file name in one panel (https://docs.immich.app/features/searching/). also a wasm justified layout for huge timelines (https://github.com/immich-app/justified-layout). steal: the date-grouped timeline (layout engine is agpl, reference only), and media type as a first-class filter.
- **ente**: magic search is fully on-device, with privacy stated plainly: "without your photos or search queries ever leaving your device" (https://ente.com/help/photos/features/search-and-discovery/magic-search). example queries are concrete ("the red motorcycle next to a fountain"). steal: privacy copy that names exactly what stays local, and concrete example queries as placeholder and empty-state hints.
- **google photos**: a single search box that mixes people, places, things, and dates, with results grouped by type. steal: grouped result sections with honest counts.
- **flickr justified layout**: https://github.com/flickr/justified-layout, the canonical algorithm and options (`showWidows`, breakout rows).
- **thumbhash**: https://github.com/evanw/thumbhash, which encodes aspect ratio and is more accurate than blurhash. steal: the instant placeholder tier.
- **raycast**: one search bar at the top where everything starts, built keyboard-first, with a consistent set of shortcuts (https://manual.raycast.com/search-bar, https://developers.raycast.com/api-reference/keyboard). steal: ⌘K focus, enter to act on the first result, arrow-only navigation, and shortcut hints right-aligned in the field.
- **linear**: header controls that stay in the same place across views, filters as removable chips, and quiet sidebar counts. steal: the same header row in library and search.
- **arc**: the window frame carries the sidebar and content sits in an inset rounded card (mux already does this). steal: frame plus card, and only that, not arc's colored frames.
- **twelve labs / video moment search**: results are timestamped segments, not whole videos (https://docs.twelvelabs.io/docs/guides/search). steal: one card per video with all segment ranges, and the range as the primary label.
- **youtube "most replayed" and chapters / frame.io comment markers**: marks on the seek bar locate content in time at a glance. steal: match markers on the player scrubber and the mini timeline on the moment card.
- **local repos in `research/raw/repos`** (FrameScout, VideoHighlighter, momentsearch, sift-video) are engine references. their uis are demo-grade (lists of timestamps), so nothing visual is taken from them.

## 11. open questions for the user

- model packaging (bundled vs one-time download) changes the first-run copy only. the layout is the same either way.
- justified rows by default (photo-forward) vs square grid by default (denser, screenshot-heavy libraries)? the recommendation is justified, with square one toggle away.
- should system accent (mux's "system" mode) be offered in v1? the recommendation is later. the teal default ties the family together.
