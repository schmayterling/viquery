# viquery blue team (claude): verify + fix

base: main 53cb323. branch: may/blue-claude. each finding was reproduced on current code before the fix and re-run after it. scratch copies of the red repros, repointed to this worktree, live in `/tmp/blue-claude/` and run from there. red-claude duplicates (RL-*) were folded into the matching RC fixes.

host: macos arm64 (apple m2), node v26.8.1, ffmpeg 9.0.1, cpu models, shared laptop under load. timings are single runs unless a run count is given.

## verdicts

| id | sev | verdict | commit | evidence after fix |
|---|---|---|---|---|
| RC-1 / RL-31 | high | fixed | ce69396, 858603c | sampled collision: libraryIds `[1,2]`, aliases split (was `[1]`, both on media 1) |
| RC-2 / RL-7 | high | fixed | 107b880, 858603c | nested add resolves to the outer folder, outer add absorbs the inner one. nested rescan 1–3 ms (red: ~750 ms / 640 MB) |
| RC-3 / RL-6 | high | fixed | e35a4c5, 858603c | empty mount point: offline, count kept (was online, 0 items). unreadable subdir: online, warning, aliases kept (was the whole folder offline with indexing stopped) |
| RC-5 | high | fixed (+1 extra) | e897c23, d756d48 | concat via symlinked segment: `Format not on whitelist` (was decoded red pixels from outside). alias swapped for an outside symlink with forged size/mtime: refused (was thumbnailed). `vq://media` 404 confirmed |
| RC-8 | high | fixed | 0db3187 | failing visual calls 3 → 3 → 3 across "add folder b" and "rescan b" (was 3 → 6 → 9) |
| RC-6 / RL-19 | medium | fixed | 0dcb416 | late 1 s audio at 2 h: 67/83/79 ms, peak rss 107.8–109.9 MiB, 0.1 MiB backing (was 1.4–3.2 s, up to 1.93 GiB). real speech: 902 ms, 700 MiB peak with the model (was 3.2 s, 1.7 GiB) |
| RC-4 / RL-3 | medium | fixed | 0adefb5 | rocket on launch.mp4: global `0–5533` = timeline `0–5533` (was `0–11000`). on bars/tone/silence the global spans equal the union of timeline-marked scenes |
| RC-7 / RL-10 | medium | fixed (contract) | 6b0866d | speech moment `seekMs:0, frameMs:1133` → `vq://frame` 200 (was 404) |
| RC-9 / RL-8 | medium | fixed | 3b8f04b | sparse-frames, gap.mp4 and overhang.mp4 all index: `idle, failed 0`, no out-of-window samples (were 3× `invalid sample timestamp`) |
| RC-10 | medium | fixed | c9c1ebe (+ speech gen bump in 0dcb416) | tone videos: no transcript, `bye` has no speech/text evidence (was `Bye!`). jfk transcript unchanged |
| RC-12 | medium | fixed | 5a8e852 | all-media now returns the photo in both scale scenarios (was `images:[]`) |
| RC-13 | medium | fixed | 89dcb96 | renderer harness after a library change: `viewerTitle:'photo-81.jpg'`, body kept, 81 refetched (old code: title `''`, body empty) |
| RC-11 | low | deferred | — | packaging is a planned later slice (ARCHITECTURE "packaging") |

other commit: 5d154a3 excludes `docs/review/repro-codex/` from biome. those scripts are verbatim red evidence with absolute paths, and `npm run lint` failed on main because of them.

## per finding

### RC-1 / RL-31 sampled identity
- root cause: `contentHash` keys >64 MiB files by size + three 4 MiB windows and upserts on that key alone.
- fix: the sampled key stays the fast first key. when it matches a media that has another alias still present with its recorded size/mtime, both files are fully hashed. equal content aliases. different content is keyed by its full sha256. renames/moves (no other alias present) skip the full read, so large-file scans stay fast. ARCHITECTURE "identity and jobs" now says this.
- known ceiling (ponytail in code): a distinct file whose sampled twin is already gone inherits that identity. upgrade: persist full hashes.
- check: `tests/catalog.test.ts` boundary test (three sparse 75 MiB files, two identical).

### RC-2 / RL-7 nested folders
- model: a file belongs to exactly one folder, the outermost library folder containing it. `addFolder(child)` returns the existing container. `addFolder(parent)` moves nested folders' aliases to the parent in one transaction and deletes the nested folder rows. catalog/index.ts drops their watchers. counts stay right and files no longer flip owners on every scan, so the double re-hash per focus is gone.
- `removeFolder(child)` is no longer reachable for a covered child: the sidebar lists only the container.

### RC-3 / RL-6 empty or replaced root, unreadable subfolder
- skip an unreadable or vanished subdirectory (EACCES/EPERM/ENOENT/ENOTDIR on `opendir`) with a warning. its known aliases are kept, the walk continues, and the folder stays online, so indexing doesn't stop silently.
- the folder goes offline with no deletions when it previously had files, none of them were seen, and the walk found nothing or the root dev/ino changed since its last full scan (kept in memory per session). a missing or unreadable root is still offline, as before.
- dev/ino is not persisted: removable volumes can get a new st_dev on remount, which would leave a persisted folder offline for good.
- known tradeoff: a folder the user empties completely shows as offline with its old items until it is removed or files come back.

### RC-5 file scope
- verified: ffmpeg 9.0.1 already refuses hls with a non-standard extension and unsafe concat paths. a concat script disguised as `.mp4` that points at a symlink inside the folder still decoded a file outside it.
- fix in `mediaTools` for every ffmpeg/ffprobe input: `-protocol_whitelist file` (was `file,pipe`) and `-format_whitelist mov,matroska,avi,mpegts,mpeg,mpegvideo,ogg,image2,jpeg_pipe,png_pipe,webp_pipe,gif,gif_pipe,bmp_pipe,tiff_pipe`. both options are listed by `ffmpeg -h full` on 9.0.1 (https://ffmpeg.org/ffmpeg-formats.html#Format-Options). checked that mp4/mov/m4v/3gp/mkv/webm/avi/mts/m2ts/mpg/mpeg, jpg/png/webp/gif/bmp/tiff and avif still probe.
- extra (boundary-catalog repro): an alias replaced by a symlink to an outside file with forged size/mtime was indexed. `checkFile` now `lstat`s and requires a regular file.
- `vq://media/<id>` serves only catalog aliases that realpath inside their folder root with matching size/mtime (repro: 404 for the symlink).
- check: `tests/compute.test.ts` "media tools never follow a concat script disguised as a video".

### RC-8 retry scope
- removed the global `failed → pending` reset that ran on every rescan, including each window focus. failed jobs now reset only for media whose alias is new or changed (inside that scan's upsert) and when a folder is added again (explicit retry, scoped to that folder).
- check: the catalog fixture test asserts that an unchanged rescan doesn't retry and that touching the file does.

### RC-6 / RL-19 speech memory
- `audio()` is now an async generator. it probes the audio stream's start/duration, then decodes ≤300 s windows with `-ss/-t` from the stream start (no leading padding). window times stay on the container timeline. a window whose last speech span runs into its edge ends early, so the next window starts at that speech. pulsed 700 s check: 100/100 spans aligned across window boundaries. memory is bounded by one window (19 MB pcm). the ponytail note is gone.
- speech generation bumped 1 → 2 in the same commit (approved by parent). the windowed decode and the RC-10 gate both change speech output, so existing transcripts re-run once.

### RC-4 / RL-3 global vs timeline spans
- the wide global band still decides whether a video is a result. `moments()` keeps a visual-only scene only if it clears `relevanceCutoff('visual', videoBest, visualBand.timeline)`, the same helper `searchVideo` uses. scenes that also have speech/text evidence are kept, as on the timeline.
- check: `tests/search.test.ts` (scene inside the global band but outside the timeline band is not spanned).

### RC-7 / RL-10 preview frames
- contract (approved): `Moment.frameMs`, a preview frame saved on disk. `seekMs` stays the playback position.
- the engine picks the saved frame (visual sample or ocr keyframe) nearest `seekMs` for global moments and timeline scenes. renderer frame urls (Search card, Player hover + list, Viewer poster) use `frameMs`. mock updated.

### RC-9 / RL-8 sparse frames
- a window with no decoded frame (long hold, vfr gap, audio overhang past the video track) samples the frame held across it once, at the window start. its embedding is reused and its frame file is copied to `<window start>.webp`. scenes keep covering the timeline, so speech in that range still maps to a scene.
- check: `tests/compute.test.ts` (one frame per 20 s: every sample inside its window, every frame file exists).

### RC-10 no-speech gate
- transformers.js 4.3.1 exposes no no_speech/logprob/compression gating. custom logits processors run after whisper's suppress list, which masks `<|nocaptions|>`.
- added whisper's own signal: one encoder + one decoder step at `<|startoftranscript|>`. the span is dropped when p(`<|nocaptions|>`) > 0.5 (openai/whisper no_speech_prob). measured: launch.mp4 speech .017, sine tones .52–.56, pulsed beeps .17–.38.
- segments with gzip compression ratio > 2.4 (whisper's default) are dropped. this catches "BEEEE…" loops. a plain "beep" for an audible beep still passes.
- ceiling (ponytail): one check per span on its first 30 s.
- check: `tests/compute.test.ts` tone control returns no segments, and jfk is still asserted.

### RC-12 media tabs
- `search(media:'all')` now runs the gated/capped ranking separately for images and for videos and returns both lists. a dense video can no longer crowd out or out-score the photos the images tab shows. renderer tab counts are unchanged. the per-kind scans are masked, so dot-product work is the same, plus one extra mask build per table. the speed claim was not re-measured.
- check: `tests/search.test.ts` all-media query keeps a video that stronger photos used to gate out.

### RC-13 viewer refresh
- `clearItems` → `staleItems`: cached items stay readable and are refetched by the next `ensureItems`. ids missing from the response are evicted, and a library change during an in-flight request keeps them stale. the Viewer re-ensures its window on each items version, so the open item refreshes in place and the Player stays mounted.
- no committed test: there is no renderer test harness, and adding a dom framework for one check was out of scope. the evidence is the red bundle harness, driven headless by electron.

### RC-11 packaging
- deferred, as planned. the packaging slice must copy models and ffmpeg/ffprobe into `resources/` and run a packaged smoke.

## verification (head)

- `npm run typecheck`: ok. `npm run lint`: ok (65 files). `npm test`: 8/8 pass. `npm run build`: ok. `npx electron tests/fixtures/core-smoke.mjs`: passed.
- repros re-run after the fixes: catalog-repro, permission-repro, catalog-r3, boundary-playlist, boundary-concat, boundary-catalog, compute-r3 (audio/speech/visual/catalog), tone-search-r3, search-repro, search-scale-r3, renderer harness, red-claude nested-cost, gap/overhang media.
