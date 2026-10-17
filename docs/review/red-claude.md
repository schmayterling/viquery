# red-team review: viquery @ 61e66da (red-claude)

reviewer: claude red team. snapshot: detached head 61e66da, node v26.8.1, electron 44.9.0, ffmpeg 9.0.1, apple m2 8 cores 24 gb, macos 27.
no source edits, no commits. repro scripts + screenshots live outside the repo in `/tmp/red-claude/` (listed at the end).

## counts

- critical: 0
- high: 10
- medium: 16
- low: 9 (2 of them plausible, rest confirmed)
- total: 35. every high and medium is confirmed by a run against the real code (electron app, real models, or the real `Catalog`/`SearchEngine` classes).

baseline: `npm run lint`, `npm run typecheck`, `npm test` (5/5) and `npx electron tests/fixtures/core-smoke.mjs` (13 s) all pass. none of the findings below are caught by them.

---

## high

### RL-1 · high · renderer/ux · `src/renderer/src/Viewer.tsx:317`, `src/renderer/src/Player.tsx:342`, `src/renderer/src/Viewer.tsx:227-244`
**summary:** the viewer can't show heic/tiff images or avi/mpg (and mts/m2ts/3gp) videos. it tells the user "The original moved or was deleted." instead.
**failure scenario:** a user double-clicks an iphone photo (`.heic`) or a camcorder clip. the catalog indexes and thumbnails it (sharp/ffmpeg), and `vq://media/<id>` returns 200. chromium can't decode the format, so `<img onError>` / `<video onError>` sets `missing` and the viewer claims the file is gone.
**evidence (confirmed):** `/tmp/red-claude/app-harness.mjs` (library `/tmp/red-claude/lib-media`). HEAD `vq://media/<id>` gives `200 image/heic`, `200 image/tiff`, `200 video/x-msvideo` and `200 video/mpeg`. viewer text for all four: `The original moved or was deleted.` screenshot: `/tmp/red-claude/run-media/viewer-coffee-heic.heic.png`. the extension allow-lists in `src/catalog/core.ts:28-54` and the mime table in `src/main/media-protocol.ts:14-38` admit these formats.
**fix direction:** tell "not decodable here" apart from a missing file (`MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED` / image decode failure + HEAD 200). serve a compute-made preview rendition for formats chromium can't decode.

### RL-2 · high · renderer/ux (temporal) · `src/renderer/src/Viewer.tsx:192-197`, `src/renderer/src/Search.tsx:196-199,238-244,316-320`, `src/renderer/src/App.tsx:257-264`
**summary:** the player always opens at the first-ranked moment (`moments[0].startMs - 1s`). this happens even when the user clicks a specific marker or picks a scene with `[`/`]` and presses enter.
**failure scenario:** a card shows 3 moments. the user clicks the 1:00–1:30 marker, or presses `]` twice (the card announces "showing 1:00 to 1:30") and then enter. the player starts at 0:00.
**evidence (confirmed):** `/tmp/red-claude/app-harness2.mjs markers`. bars.mp4 moments in rank order are `0-30000, 30000-60000, 60000-90000`. clicking marker k=2 leaves `currentTime` at 2.92 s (expected ≥ 59 s). after `]`×2 the label says `showing 1:00 to 1:30`, and enter leaves `currentTime` at 3.00 s. the card's `cur` state is never passed to `onOpen`.
**fix direction:** pass the selected moment (card `cur`) through `onOpen` → `ViewerState` and start the player at that moment.

### RL-3 · high · search/temporal (known seeded issue, characterized) · `src/search/engine.ts:51-60,543-549,677-699`, `src/renderer/src/Viewer.tsx:192`
**summary:** global moments cover whole videos. the cutoff `max(.20, best - .08)` is almost always just the .20 floor, and any adjacent scene that clears it is merged (up to 30 s). the player uses a separate `.006` band, so the card and the player disagree.
**failure scenario:** "a rocket launching" makes the launch.mp4 card read `0:00 – 0:11` ("1 scene", the whole track lit), while the player shows a single match `0:00 – 0:05`. on a 90 s clip the moments become three 30 s blocks covering the entire video (`0-30000, 30000-60000, 60000-90000`). clicking opens at the group start minus 1 s, not at the matching frame.
**evidence (confirmed):** clip cosines from `/tmp/red-claude/gate-scores.ts`: launch scene1 .269, scene2 .211. global cutoff = max(.20, .189) = .20, so both scenes pass and merge into 0–11000. timeline cutoff = .263, so only scene1 matches (0–5533). screenshots: `/tmp/red-claude/run-media/search-rocket.png` (card 0:00–0:11) and `/tmp/red-claude/run-media/player-rocket.png` (Matches 1, 0:00–0:05). smoke still passes because it only checks `seekMs < 5500` and `<= 30000`.
**fix direction:** build moments from scenes that clear the per-video timeline cutoff (share the cutoff helper with `searchVideo`) or split groups at score drops. open at the best frame or that scene's start.

### RL-4 · high · search quality · `src/search/engine.ts:50-60,543-549`, `src/renderer/src/Search.tsx:131-154`
**summary:** the relevance gates don't gate. the .20 visual floor sits inside clip b/32's score range for unrelated content (the code comment cites negatives up to .246), and the .08 band is bounded by the floor. every query returns unrelated media and the no-results state is unreachable. the moments section is also always rendered first, even when an image is the top hit (design §6.2 orders sections by top hit).
**failure scenario:** "purple giraffe" returns cat.jpg, cat-128.jpg and three test-pattern videos. "a cat" returns coffee.jpg plus three test-pattern videos, and the junk video cards render above the cat images.
**evidence (confirmed):** `/tmp/red-claude/search-exp.ts` runs the real `SearchEngine` with the real encoders on the smoke db. `/tmp/red-claude/gate-scores.ts`: for "purple giraffe" the top score is .208, so the cutoff is .20, and bars .208, cat .205, tone .204, silence .204 and cat-128 .201 all pass. for "a cat", coffee .207 and the testsrc videos .206–.210 pass. ui: `/tmp/red-claude/run-media/search-rocket.png` shows avi/mpg test patterns as rocket moments.
**fix direction:** calibrate the floor against a background/negative set per model (b/32 needs ≥ ~.25, or use a relative margin over a background prior). order result sections by top hit.

### RL-5 · high · search quality · `src/search/engine.ts:71-78,575-611,361-387,411-438`, `src/ml/index.ts:143-169`, `src/compute/media.ts:474-482`
**summary:** the lexical branch ORs every query word, stopwords included, and lexical votes have no gate. any transcript containing "and/what/my/so/the/you" matches natural-language queries. whisper hallucinations on non-speech audio are indexed too (a 440 hz tone becomes "The"). in moments, a spoken/text hit then takes over the moment's seek point, thumbnail scene and snippet.
**failure scenario:** "a dog and a cat" returns the rocket video as a moment with snippet "And so my fellow Americans…" (matched "and"), and the player marks both rocket scenes as matches. "what is this", "pictures of my kids" and "so" all return the rocket video. "can you see the sunset" returns tone.mp4 (a pure sine tone) with snippet "The".
**evidence (confirmed):** `/tmp/red-claude/search-exp.ts` output, real app `/tmp/red-claude/run-media/search-dog-and-cat.png` and `/tmp/red-claude/run-media/player-dog-and-cat.png` (Matches 2 on the rocket video). db: `transcript` row for tone.mp4 = `0|12000|The`.
**fix direction:** require all terms (or phrase/near matching) and drop stopwords. gate lexical votes on bm25 strength. drop whisper chunks with high no-speech/low logprob and known hallucination strings.

### RL-6 · high · catalog/indexing · `src/catalog/core.ts:741-758,363-380,496-507`, `src/renderer/src/Sidebar.tsx:126-129`
**summary:** if one subdirectory can't be opened (EACCES/EPERM), the walk throws and aborts discovery mid-folder. the whole folder is then marked offline, and `work()` skips offline folders, so visual/speech indexing for that folder stops silently while the footer says "up to date".
**failure scenario:** adding an ext4 drive root (`lost+found` is root 0700), an ntfs drive root (`System Volume Information`), or a macos folder containing a tcc-protected package leaves the folder shown as "Offline" (tooltip "Drive not connected"). files after the bad dir are never found, and thumbnailed items never become searchable.
**evidence (confirmed):** `/tmp/red-claude/catalog-exp.ts` C2 (real `Catalog`, stub compute, `lost+found` chmod 000): `state: offline`, 4 of 5 readable files found, `jobs: done 4 (thumb), pending 4 (visual)` stuck, `indexState: {phase: idle, items: 4, failed: 0}`.
**fix direction:** skip unreadable subdirectories with a warning. reserve offline for a missing root.

### RL-7 · high · catalog/data · `src/catalog/core.ts:210-231,393-445,430-439`
**summary:** nested or overlapping folders are accepted. `file.path` is globally unique and `folder_id` is overwritten by whichever folder scans last. every rescan (every window focus, see RL-11) therefore re-hashes the whole overlap twice. removing the inner folder deletes files the outer folder still covers, and sidebar counts are wrong.
**failure scenario:** a user adds `~/Pictures`, later `~/Pictures/2024`. after that, every alt-tab re-reads all of 2024 twice. removing "2024" from the sidebar hides those photos even though ~/Pictures is still added. the "Pictures" count excludes them.
**evidence (confirmed):** `/tmp/red-claude/catalog-exp.ts` C1: change events for all 5 overlap files on every unchanged rescan, counts `lib 1 / sub 5` for 6 files, and only 1 of 6 files left after removing `sub`. `/tmp/red-claude/nested-cost.ts`: rescan of 20×32 MiB takes 1 ms when not nested vs ~750 ms nested, every time.
**fix direction:** canonical-prefix check in `addFolder` (reject or merge nested roots), or key aliases by (folder, path).

### RL-8 · high · compute/catalog · `src/compute/media.ts:130-175`, `src/catalog/core.ts:871-881`, `src/search/engine.ts:324,497-520`, `src/renderer/src/Player.tsx:661-666`
**summary:** `windows()` builds 10 s windows from the container duration. when a window has no decoded frame, `sampleFrames()` picks a frame outside it, `validateVisual` rejects the whole result, and the job fails permanently after 3 attempts. with no scenes, the video's transcript can't map to targets either, so the video becomes unsearchable. the player says "Still indexing this video" forever.
**failure scenario:** a video whose audio runs 0.5 s past the video track, with duration just past a 10 s boundary (very common container shape), or a vfr screen recording with a >10 s static gap.
**evidence (confirmed):** real app run `/tmp/red-claude/run-media/log.txt`: `gap.mp4` (frames at 0–1.9 s and 25–26.9 s) and `overhang.mp4` (video 20.0 s, audio 20.5 s) give `visual failed attempts 3 "invalid sample timestamp"`.
**fix direction:** derive windows from the decoded frame range and drop or merge frameless windows. clamp samples to in-window frames instead of failing the job.

### RL-9 · high · robustness · `src/main/index.ts:83-88`, `src/shared/rpc.ts:42-76`, `src/search/index.ts:52-62`, `src/catalog/index.ts:86-93`
**summary:** a crashed utility is never restarted, and pending rpc promises never settle. there is no ui error, and recovery requires an app restart (the console only says "restart viquery to resume").
**failure scenario:** if the search utility dies (e.g. onnxruntime native crash or oom), typing a new query keeps the old results dimmed forever with no message. if compute dies mid-indexing, the footer freezes on "Indexing videos 1 of 8" with a job stuck `running`.
**evidence (confirmed):** `/tmp/red-claude/app-harness2.mjs`. after SIGKILL of search, 8 s later: query "a cat" shows the rocket results with `data-stale=true` and `error: null`. after SIGKILL of compute: last index event `videos 1/8`, age 25 s, `visual running 1, pending 6` (`/tmp/red-claude/run-ckill/log.txt`).
**fix direction:** reject pending calls on port close/utility exit and respawn the utility (re-handshake ports). surface the error state in the ui.

### RL-10 · high · renderer/search · `src/search/engine.ts:401-404,718-719`, `src/renderer/src/Search.tsx:283-285`, `src/renderer/src/Player.tsx:293,691`, `src/renderer/src/Viewer.tsx:193-197`
**summary:** `seekMs` doubles as the frame-thumbnail key. for speech/text matches it is the segment start or scene start, which is never a sampled frame time, so `vq://frame/<id>/<seekMs>` returns 404. every speech/text moment card, player match row, hover preview and player poster is blank.
**failure scenario:** "ask what you can do for your country" or any lexical match gives a blank 16:9 card, and blank thumbnails in the player's Matches list.
**evidence (confirmed):** `vq://frame/2/0` → 404 and `vq://frame/2/5533` → 404, while launch frames exist only at 1133, 2733, 4400, 6600, 8267 and 9933 ms. card `img` computed `visibility: hidden`. screenshots `/tmp/red-claude/run-media/search-dog-and-cat.png` and `/tmp/red-claude/run-media/player-dog-and-cat.png`.
**fix direction:** carry a representative frame time (sample `t_ms`) in `Moment`/`SceneMatch` for imagery, separate from `seekMs` for playback.

---

## medium

### RL-11 · medium · catalog/perf · `src/main/index.ts:262-264`, `src/catalog/core.ts:346-391,353-355,512`
**summary:** every window focus queues a full rescan. it is not coalesced, it resets every failed job to pending (3 more retries each time), it pauses all non-thumb indexing while it walks, and it flips the footer to "Finding files".
**failure scenario:** a user alt-tabs 10 times during indexing, which queues 10 full walks (~7 s each at 100k files) while visual/speech work is paused. broken files are retried on every focus.
**evidence (confirmed):** `/tmp/red-claude/catalog-exp.ts`. C3: probe calls for a corrupt file go 3 → 9 after two focus rescans. C4: 10k files, one stat-gated rescan 680 ms, 10 rapid rescans 5267 ms.
**fix direction:** rely on the watcher; on focus only re-check offline roots, coalesce queued scans, and stop resetting `failed` on automatic scans.

### RL-12 · medium · search/ux · `src/search/engine.ts:250-258,670-673`, `src/renderer/src/App.tsx:335-346`, `src/renderer/src/Search.tsx:355-362`
**summary:** failed jobs count as "pending" (`state != 'done'`). once anything has failed, search permanently says "Still indexing 1 image and 3 videos. Results may grow." and the no-results view says the videos "are still being indexed", while the footer says "up to date · 4 items couldn't be indexed".
**evidence (confirmed):** after idle with 4 failures, `pending: {images: 1, videos: 3}` (run-media log). screenshot `/tmp/red-claude/run-media/search-dog-and-cat.png` shows both contradicting lines.
**fix direction:** count only `pending|running`, and refresh `pending` when a job fails.

### RL-13 · medium · renderer/ux · `src/renderer/src/Grid.tsx:96-114,255-312`, `src/renderer/src/App.tsx:92-147`, `src/catalog/core.ts:592-598`
**summary:** there is no scroll anchoring (the design §9.8 promise). items landing above the viewport, such as newer files or thumb-stage EXIF `taken_at` rewrites that re-sort the library, shove the user's place.
**evidence (confirmed):** `/tmp/red-claude/app-harness4.mjs`, all-media view scrolled to 2400 px. before: center tile `img270.jpg, July 15, 2019`. after 60 newer files arrive (watcher → refetch), at the same scrollTop: center tile `new023.jpg, October 17, 2026`, grid height 29333 → 33822 px.
**fix direction:** remember the first visible item id before relayout and restore its offset after.

### RL-14 · medium · performance @100k · `src/catalog/core.ts:253-292,681-721`, `src/search/engine.ts:206-259`, `src/renderer/src/App.tsx:117-147`, `src/renderer/src/Grid.tsx:96-99`
**summary:** the hot paths that run continuously during indexing are o(n):
- `catalog.library()` takes 689 ms, and the renderer fetches it 3× per library-change bump (all, recent, current view, at most every 2 s).
- `indexState()` takes 42 ms and runs every 100 ms.
- search `refresh()` takes 36 ms per change batch (a full `job` scan in `refreshPending`).
- the renderer re-justifies 100k items (34 ms) on every bump.

the single-writer catalog spends most of its time on progress/listing instead of jobs, and the ui drops frames every bump.
**evidence (confirmed):** `/tmp/red-claude/perf-exp.ts`. synthetic 100k media (20% video), ~220k jobs, m2, median of 7: library 689 ms (min 685 / max 734), recent 683, indexState 42.4, refresh 36.4, folders 17.5. `/tmp/red-claude/library-sql.ts`: the sql alone is 225 ms with `m.*`, 126 ms with only the needed columns, so the rest is `TypedArray.from` over row objects. `/tmp/red-claude/layout-perf.mjs`: justify(100k) 34.4 ms median.
**fix direction:** lean column list straight into typed arrays. keep incremental counters for progress/pending. don't refetch `all`/`recent` for counts on every bump.

### RL-15 · medium · renderer/ux · `src/renderer/src/items.ts:38-41`, `src/renderer/src/App.tsx:92-115`, `src/renderer/src/Search.tsx:38-75,221-225`
**summary:** each library-change bump clears the whole item cache and re-runs the current search. during indexing (every ≤ 2 s), moment-card titles, meta and timeline scale blank out and come back, video tiles lose hover scrub until refetch, and search results re-rank and reflow under the cursor. design §6.2 says results should be append-only.
**evidence (confirmed):** `/tmp/red-claude/app-harness7.mjs`, sampling every 16 ms after one file landed: the card title was blank in 17 of 250 samples (~270 ms). reflow follows from the code path `useSearch` deps `[key, version]`.
**fix direction:** invalidate cached items per changed id, and merge new search results append-only (or re-run only on user input).

### RL-16 · medium · catalog/ux · `src/catalog/core.ts:228-230`, `src/renderer/src/App.tsx:171-176`
**summary:** `addFolder()` resolves only after the entire folder has been walked and hashed. the ui then calls `setPlace(folder)` whenever that happens, minutes later on large folders, and yanks the user out of whatever they were doing (search, another folder).
**evidence (confirmed):** `/tmp/red-claude/catalog-exp.ts` C5: 40×32 MiB, the folder row is visible after 100 ms but `addFolder()` resolves after 1531 ms. this scales with bytes hashed.
**fix direction:** return the folder right after insert and run the scan in the background. navigate immediately or not at all.

### RL-17 · medium · compute/resources · `src/main/index.ts:336-340`, `src/compute/media.ts:32-58,380-427`
**summary:** quitting during indexing kills the utilities but not their ffmpeg children. ffmpeg ignores sigpipe and keeps decoding after the app exits (reparented to pid 1). `extract`'s `.decode-*` png temp dirs are never cleaned because the `finally` never ran.
**evidence (confirmed):** `/tmp/red-claude/app-harness5.mjs` and `/tmp/red-claude/app-harness5b.mjs` (60 s 4k clip). 2 s and 6 s after quit, `ffmpeg … -v info -i …uhd60.mp4` is still running with ppid 1. afterwards, `profile/library/frames/01/1/.decode-yuRA6J` holds 19 png files. on the next launch the job restarts alongside the orphan.
**fix direction:** track spawned children in compute and kill them on exit/SIGTERM (or spawn in a process group and kill the group). sweep `.decode-*` at startup.

### RL-18 · medium · performance (long 4k video) · `src/compute/media.ts:324-346`
**summary:** the thumbnail stage ("the grid is fully usable after this") builds the hover sprite by fully decoding the whole video at source resolution. long 4k videos hold the 2 thumb slots for minutes and stall thumbnails for everything else.
**evidence (confirmed):** 60 s 3840×2160 testsrc2 clip, 2 threads. the shipped sprite command takes 6.95 s; the same filter with `-skip_frame nokey` takes 0.42 s (16×). an hour of 4k is ~7 min per video before any real-camera hevc decode cost.
**fix direction:** keyframe-only or per-timestamp `-ss` seeks for the 50 sprite frames, and/or move sprites off the thumbnail gate.

### RL-19 · medium · performance (memory) · `src/compute/media.ts:429-490` (ponytail at 462)
**summary:** speech decodes the whole file's pcm into one buffer, copies it into a Float32Array, and hands spans to whisper. peak memory is ~3.3× the pcm size the comment budgets, and continuous audio becomes one multi-hour span.
**evidence (confirmed):** `/tmp/red-claude/audio-mem.ts` on a 2 h file: pcm 439 MB, peak rss 1465 MB sampled (`/usr/bin/time -l` max rss 1.54 GB), 1 span of 120 min. a 6 h recording is about 4.5 GB in the compute utility.
**fix direction:** decode in windows (`-ss/-t`, e.g. 30–60 s with overlap) and cap span length.

### RL-20 · medium · renderer/ux · `src/renderer/src/App.tsx:184-203`
**summary:** chip parsing consumes `video/clip/photo/image/picture` anywhere in a sentence on space and silently flips the media filter. the filter persists after the query is cleared.
**failure scenario:** typing "a video game console on a desk" turns the field into "a game console on a desk" and switches the media filter to videos only (image results hidden). clearing the search leaves the library filtered to videos.
**evidence (confirmed):** `/tmp/red-claude/app-harness8.mjs`: `field: "a game console on a desk"`, `mediaSegment: "Videos"`, and the filter is still `Videos` after clearing.
**fix direction:** only treat leading/standalone tokens as chips (or require an explicit gesture), and show a removable chip.

### RL-21 · medium · renderer/player · `src/renderer/src/Player.tsx:527-536`
**summary:** enter in "Find in this video" seeks to `pins[0]` even while results are stale (the 150 ms debounce plus search time), so it jumps to the previous query's match.
**evidence (confirmed):** `/tmp/red-claude/app-harness3.mjs`: after "an astronaut" (pin 0:05–0:11), type "a rocket launching" and press enter. it seeks to 5.533 s, while the correct pin is 0:00–0:05.
**fix direction:** ignore enter (or defer it to arrival) while `results.q !== q`.

### RL-22 · medium · catalog + renderer · `src/catalog/core.ts:741-757`, `src/renderer/src/Search.tsx:114`
**summary:** hidden/sidecar files with media extensions (macos `._*` appledouble files on exfat/fat drives, synology `@eaDir` thumbs) are indexed. they fail permanently and stay as grey tiles. the search grid also forces `ready = 1` ("search hits are indexed"), but filename hits can be unindexed or failed media, which then render as blank tiles in results.
**evidence (confirmed):** run-media: `._cat.jpg` thumb failed (`no video or image stream`), tile `img=false`. "a dog and a cat" image results are `cat.jpg, cat-tiff.tiff, ._cat.jpg`, and the third tile is blank in `/tmp/red-claude/run-media/search-dog-and-cat.png`.
**fix direction:** skip `._*`/dot entries (and known sidecar dirs) in `walk`, and use real readiness for search hits.

### RL-23 · medium · a11y/focus · `src/renderer/src/Sidebar.tsx:175-185`
**summary:** the folder menu's effect depends on an `onClose` prop that is a new function on every Sidebar render. each app re-render (every ≤ 2 s during indexing) re-runs it and refocuses the first button, so keyboard users can't stay on "Remove".
**evidence (confirmed):** `/tmp/red-claude/app-harness3.mjs`: focus on "Remove" becomes "Cancel" within ~1 s, with 4 `libraryChanged` events in 7 s.
**fix direction:** run the show/focus effect once on mount (stable `onClose` via ref/useCallback).

### RL-24 · medium · renderer/player · `src/renderer/src/Player.tsx:320-346,492`
**summary:** fullscreen is requested on `.vstage`, which contains only the `<video>`. the custom controls (seek, match markers, time, prev/next match, panel) are siblings and disappear in fullscreen, with no on-screen way back.
**evidence (confirmed by code path):** `video.current?.parentElement?.requestFullscreen()` targets `.vstage`; `.vbar` is its sibling in `.vplayer-main`.
**fix direction:** fullscreen the player container that includes `.vbar` (and auto-hide the controls there).

### RL-25 · medium · performance claim · `src/search/bench.ts`, docs/ARCHITECTURE.md "search", research/BRIEF.md
**summary:** the sub-100 ms target is benchmarked at 100k vectors, but videos add ~3 vectors per 10 s window (18/min). a 100k-item library with ordinary video share is several hundred thousand vectors, where the project's own scan bench already misses the budget before encoding, fusion and ipc.
**evidence (confirmed):** `npm run bench:search` on m2. 100k vectors: p50 20.6 / p95 23.5 ms (workers2). 500k vectors: p50 126 / p95 204 ms (workers2), plain scan p95 307 ms, and 1 GB of SharedArrayBuffer resident in the search process.
**fix direction:** benchmark at realistic vector counts (e.g. 10k videos × 5 min ≈ 900k). plan pooling per scene, quantization or ann + exact rerank.

### RL-26 · medium · catalog/data · `src/catalog/core.ts:451-463`
**summary:** a root that exists but is empty is treated as "every file deleted". on linux, fstab/manual mount points stay as empty directories when the drive is unplugged. all aliases are dropped, the library empties (design §5: offline folders stay listed and searchable), and remounting forces a full re-hash.
**evidence (confirmed, simulated):** `/tmp/red-claude/catalog-exp.ts` C6, root emptied in place: `library: 0`, folder `state: online, count: 0`. after restoring, 20 media are re-hashed.
**fix direction:** if the root lost all previous files at once (or its `dev` changed), treat the folder as offline instead of deleting aliases.

---

## low

### RL-27 · low · catalog · `src/catalog/core.ts:214-216`
**summary:** the data-dir guard is equality-only, so adding `<userData>/library/thumbs` (or frames/sprites) is accepted. every new thumbnail then becomes a new media item, and the watcher feeds it back forever.
**evidence (confirmed):** `/tmp/red-claude/datadir-loop.ts`: `addFolderError: null`, media count 1→2→3→4→5 over 5 rescans.
**fix direction:** reject roots inside the data dir (path-prefix check on canonical paths).

### RL-28 · low · renderer/ux · `src/renderer/src/Sidebar.tsx:251-254`
**summary:** the resizer applies `onResize(x, true)` on any pointerup over the 6 px strip, without checking that a drag started there.
**evidence (confirmed):** dispatching pointerup at x=345 changed `--sidebar-width` from 248px to 345px (`/tmp/red-claude/app-harness3.mjs`).
**fix direction:** ignore pointerup unless `dragging`.

### RL-29 · low · a11y/focus · `src/renderer/src/Viewer.tsx:71-127`
**summary:** quick look is a `role=dialog` with no focus containment, and its escape/space handler lives on the quick-look element. once focus leaves (tab), escape no longer closes it.
**evidence (confirmed):** `/tmp/red-claude/app-harness8.mjs`: opened with space, focus moved to the sidebar, escape → `stillOpenAfterEscape: true`.
**fix direction:** trap focus while open, or handle escape at window level while quick look is shown.

### RL-30 · low · a11y · `src/renderer/src/Search.tsx:188,263-266`, `src/renderer/src/Topbar.tsx:194-224`, `src/renderer/src/Header.tsx:144-178`, `src/renderer/src/Player.tsx:549-622`
**summary:** the aria structure is invalid in several places:
- moment cards are `role=listitem` without a `role=list` parent.
- the tile-size and date popovers are `role=menu` without menu keyboard behavior (arrows/roving focus), and the date menu contains form inputs.
- the player tabs have no `role=tabpanel`, and the list ids are reused across tabs.

**evidence (confirmed by code path).**
**fix direction:** add `role=list` on `.moments`, use plain popovers with buttons (or implement the menu pattern), and add a tabpanel.

### RL-31 · low · identity vs binding design · `src/catalog/core.ts:96-124` vs docs/ARCHITECTURE.md "identity and jobs"
**summary:** files over 64 MiB are identified by size plus 3×4 MiB windows. the binding design still says "sha256 of full file content", and only a ponytail comment records the change. two same-size files that differ only outside the windows collapse into one media item (one becomes an invisible alias).
**evidence (confirmed by code/doc diff).**
**fix direction:** update ARCHITECTURE.md deliberately, or add the background full-hash pass the comment names.

### RL-32 · low · offline guarantee (plausible) · `src/main/index.ts:235-240,284-292`
**summary:** the electron spellchecker is on by default, and on windows/linux electron downloads hunspell dictionaries from google's cdn (electron.d.ts: "By default Electron will download hunspell dictionaries from the Chromium CDN"). the webRequest blocker covers renderer requests; whether it also intercepts this browser-initiated download is unverified. untestable on macos, where the os spellchecker is used.
**fix direction:** set `spellcheck: false` in webPreferences (the search fields already opt out per element) or `session.setSpellCheckerEnabled(false)`.

### RL-33 · low · catalog/watch (plausible) · `src/catalog/index.ts:21-46`
**summary:** `watch()` checks `subscriptions.has(path)` before `await watcher.subscribe`. concurrent callers (startup rescan + focus rescan, or addFolder + the focus fired by the closing dialog) can both subscribe, and the first subscription leaks. after removeFolder, the leaked one keeps firing `rescan(oldId)`, and each fire resets all failed jobs (core.ts:353-355). the race window is widest on linux, where inotify subscribe walks the whole tree.
**fix direction:** store the subscribe promise in the map before awaiting it.

### RL-34 · low · code quality vs AGENTS.md
**summary:** the code repeats checks and carries unused paths, against the "not overly defensive" and "no speculative code" rules:
- embeddings are validated 3 times: `unitVector` (src/ml/index.ts:35-45), `validVector` (src/catalog/core.ts:816-825) and `Vectors.append` (src/search/vectors.ts:51-68).
- query vectors are re-checked in `encode` (src/search/engine.ts:448-453) after `unitVector`.
- compute re-validates catalog-built requests (src/compute/api.ts:20-40).
- dead or unused paths: `similar()` is exposed over ipc but unused by any ui (src/preload/index.ts:55; it does sequential full scans per source sample, src/search/engine.ts:461-495).
- the narrow-drawer branch is unreachable: window `minWidth: 720` vs `(max-width: 700px)` (src/renderer/src/App.tsx:34,245-255; styles.css:1856).
- `etaMs` is always null (src/catalog/core.ts:709), so the eta ui is dead (Sidebar.tsx:359-361).
- `Scene.frameMs` is computed by a correlated subquery but unused by the renderer (src/catalog/core.ts:321-329).
- the bench-only `scanPlain` lives in the production module (src/search/scan.ts:74-94).

**fix direction:** keep one check at the compute→catalog boundary, and drop or flag the dead paths (not deleted here).

### RL-35 · low · chrome · `src/main/index.ts:196-203,234`
**summary:** commit 61e66da ("match dark title bar overlay to frame color") sets `#202020`, but the frame renders as `#1e1e1e` (`--surface: oklch(0.235 0 0)`). `backgroundColor` uses the surface colors while design §5 asks for `--background`, which is #171717 in dark.
**evidence (confirmed):** pixel samples from the real dark-mode screenshot: topbar/sidebar `1e1e1e`, card `171717`.
**fix direction:** derive the overlay color from the token (#1e1e1e), and use `--background` for the pre-paint color.

---

## ui critique (impeccable, product register)

run notes:
- `context.mjs` reported `NO_PRODUCT_MD`. init was skipped because it would write PRODUCT.md and this review is read-only; research/design.md §0 stood in.
- independence was degraded: assessments ran sequentially, no subagents.
- the detector `detect.mjs --json src/renderer` found 1 hit, "overused font: Geist". that is a false positive for product register: it is the deliberate mux/hibi family, with system font on macos.
- browser overlay was not attempted (electron renderer). evidence came from the real-app screenshots above.
- snapshot persistence was skipped (no repo writes).

nielsen heuristics (0–4):

| # | heuristic | score | key issue |
|---|---|---|---|
| 1 | visibility of system status | 2 | "up to date" vs "still indexing" contradiction (RL-12), false "Offline" (RL-6), silent crashes (RL-9) |
| 2 | match system / real world | 2 | "moved or was deleted" for unsupported formats (RL-1), "Still indexing this video" for failed ones (RL-8) |
| 3 | user control and freedom | 2 | chips hijack the media filter (RL-20), addFolder yanks the view (RL-16), quick look escape (RL-29) |
| 4 | consistency and standards | 2 | card range ≠ player markers (RL-3), marker click ignored (RL-2), aria roles (RL-30) |
| 5 | error prevention | 1 | nested/data-dir folders accepted (RL-7, RL-27), stale enter (RL-21), resizer misfire (RL-28) |
| 6 | recognition rather than recall | 3 | recent queries, visible segmented filters, shortcuts in titles |
| 7 | flexibility and efficiency | 3 | strong keyboard model (⌘K, `[ ]`, j/k/l, f, t), held back by RL-2 |
| 8 | aesthetic and minimalist design | 3 | restrained, on-system; ungated junk results crowd the top (RL-4) |
| 9 | error recovery | 1 | no way to see which items failed, misleading copy, crash needs a restart with no hint |
| 10 | help and documentation | 2 | tooltips with shortcuts and first-run facts; no shortcut sheet |
| | **total** | **21/40** | acceptable band: solid shell, core temporal flow unreliable |

persona red flags:
- **power user (alex):** picks scene 3 with `]` and gets scene 1 (RL-2). enter in find jumps to the last query's match (RL-21). fullscreen loses the scrubber (RL-24).
- **first-timer (jordan):** iphone photos say "moved or was deleted" (RL-1). "purple giraffe" shows cats and test patterns (RL-4). "Still indexing" never ends (RL-12).
- **accessibility-dependent (sam):** focus snaps back to "Cancel" every couple of seconds while removing a folder (RL-23). quick look loses escape after tab (RL-29). list/menu roles lie to screen readers (RL-30).

what works: tokenized restrained design matching design.md, global reduced-motion kill switch, focus-visible everywhere, virtualized justified grid with exact geometry, careful stale-result dimming, good esc layering in field/panel/viewer.

---

## checked and sound

- **vq:// protocol:**
  - digit-only paths (traversal impossible).
  - originals pinned to realpath inside the folder root, so symlink escapes are rejected; plus `O_NOFOLLOW` and size+mtime pinning.
  - bigint range parsing (suffix, 416, empty file), HEAD, abort → stream destroy, `nosniff` + `default-src 'none'` on responses.
  - range/head verified by the smoke.
- **renderer isolation:**
  - sandbox + contextIsolation, nodeIntegration off.
  - the preload exposes fixed method names only, so the renderer can't reach internal rpc (`rescan`, `lookup`, `addFolder(path)`).
  - `trusted()` frame/url check on ipc, `window.open` denied, `will-navigate` blocked, permission handlers deny.
  - webRequest cancels http/https/ws/wss outside the dev origin.
- **rpc trust boundary:** ids, filters, query length (≤4096) and `items` (≤10000) are validated in catalog/search.
- **xss:** no `innerHTML`/`dangerouslySetInnerHTML`. filenames/transcripts render as react text; the highlight regex escapes input.
- **ffmpeg:** argv arrays (no shell), absolute paths, `-protocol_whitelist file,pipe`. filename-driven stderr parse pollution would need crafted directory names and only affects that item.
- **offline:** transformers `allowRemoteModels=false` + `local_files_only`; fonts bundled (Geist woff2); the renderer blocks remote requests. caveat: RL-32.
- **db:** foreign keys on (node:sqlite default, verified). fts external-content triggers fire on fk cascade, and `integrity-check` passes after folder removal (`/tmp/red-claude/fts-cascade.ts`).
- **jobs:** `running` resets to pending on restart; the generation + state check precedes every write; per-stage results are replaced in one transaction; identical copies become aliases (smoke).
- **search concurrency:** `refresh()` is deferred while queries are active, so SharedArrayBuffer compaction can't race the scan workers. search-as-you-type drops stale responses by sequence; in-video search uses a live flag.
- **video teardown:** arrowing through 7 videos in the viewer kept ≤3 original streams open in main, back to 1 afterwards (`/tmp/red-claude/app-harness6.mjs`). no fd leak.
- **tests:** 5 scenario tests, one per module, not redundant. the gap is no renderer test at all (RL-2/RL-21 would be one cheap check each).

## repro artifacts (outside repo)

- `/tmp/red-claude/catalog-exp.ts`, `/tmp/red-claude/nested-cost.ts`, `/tmp/red-claude/datadir-loop.ts`, `/tmp/red-claude/fts-cascade.ts`: real `Catalog` with a stub compute (`node <file>`).
- `/tmp/red-claude/search-exp.ts`, `/tmp/red-claude/gate-scores.ts`: real `SearchEngine`/encoders on `out/core-smoke-profile` or harness dbs.
- `/tmp/red-claude/perf-exp.ts`, `/tmp/red-claude/library-sql.ts`, `/tmp/red-claude/layout-perf.mjs` (bundled layout), `/tmp/red-claude/audio-mem.ts`: measurements.
- `/tmp/red-claude/app-harness.mjs` … `app-harness8.mjs`: drive the built app (`PATH=/opt/homebrew/bin:$PATH npx electron <harness> <args>` from the worktree after `npm run build`). logs and screenshots are in `/tmp/red-claude/run-*/`.
- crafted media: `/tmp/red-claude/lib-media` (heic, tiff, avi, mpg, broken, vfr gap, audio overhang, appledouble), `/tmp/red-claude/lib-markers`, `/tmp/red-claude/lib-moments`, `/tmp/red-claude/lib-scroll`, `/tmp/red-claude/big` (60 s 4k, 2 h audio).
