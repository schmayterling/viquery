# viquery independent review (codex) — 61e66da

scratch repros: `/tmp/red-codex/` (`catalog-repro.mjs`, `search-repro.mjs`, log `catalog-repro-r2.log`). RC-1..RC-7 come from codex runs 1-2 (each ended on a provider content filter; findings recorded from their logs and report edits). run 3 findings live in REVIEW-red-codex-r3.md (RC-8+).

## ranked findings

### RC-1 high · data integrity · src/catalog/core.ts `contentHash`
sampled identity (>64 MiB: size + head/middle/tail 4 MiB) merges distinct files.
- scenario: two 75 MB bmp images of equal size differing only at offset 8 MiB -> one media row, both paths aliased to media 1; the second image never gets its own thumbnail/vector.
- evidence: `catalog-repro-r2.log` "sample collision": full sha256 differ (95b1… vs 1a67…), decoded frame md5 differ, `libraryIds:[1]`, both aliases -> media_id 1. CONFIRMED.
- fix direction: keep sampled key only as a fast provisional key; confirm identity with a full hash (background, after thumbnails) before merging two paths into one media.

### RC-2 high · data integrity · src/catalog/core.ts `removeFolder` / folder ownership
overlapping folders: add parent, add child, remove child -> files shared with the parent disappear.
- evidence: "overlapping folders": before parent count 0 / child count 1 (file owned only by child); after removing child, `libraryIds: []` although the file is still under the parent folder. CONFIRMED.
- fix direction: a file belongs to every folder containing it (or reject/merge nested folders on add); removal re-attributes to remaining ancestors.

### RC-3 high · data loss · src/catalog/core.ts `scanFolder` vanished handling
a root that becomes an empty directory (unmounted drive leaving its mount point) is treated as "all files deleted".
- evidence: "empty mountpoint": after rename+mkdir of the root and rescan, folder stays `online`, `libraryIds: []`. CONFIRMED.
- fix direction: treat an empty or identity-changed root (dev/ino change, missing marker) as offline, never as mass deletion; architecture already requires "inaccessible root never means mass deletion".

### RC-5 (reported, needs verification) · file scope · media decode / url handling
run 2 reported that local media decoding can reach files outside the user's selected folders. exact path not recorded before the run ended. verify (symlinked entries inside a library folder, alias paths, `vq://media/<id>` resolution) and fix if real.

### RC-6 (reported, needs verification) · resources · src/compute speech pcm
(r3 owns audio/scale verification; see REVIEW-red-codex-r3.md)
run 2 reported whole-timeline audio allocation from tiny files whose audio starts late (container duration drives the pcm buffer, not the audio stream). verify with a small file whose audio starts far into a long timeline and measure allocation.

### RC-4 — medium — temporal search consistency — CONFIRMED

- file: `src/search/engine.ts:50-60,348-359,540-549,677-719`
- summary: global result labels whole clip as matching while player timeline rejects its latter half.
- failure scenario: indexed fixture `launch.mp4`, query `a rocket launching` -> global moment 0–11,000 ms; timeline only 0–5,533 ms has `match:true`, later scene has no sources and `match:false`.
- evidence/repro: after successful `npm run build && npx --no-install electron tests/fixtures/core-smoke.mjs`, run `PATH=/opt/homebrew/bin:$PATH node --experimental-strip-types /tmp/red-codex/search-repro.mjs`; output recorded in `/tmp/red-codex/search-repro-r2.log`. global `startMs:0,endMs:11000`; timeline second scene `startMs:5533,endMs:11000,sources:[],match:false`. global .08 band admits then merges a scene rejected by timeline .006 band; this follows documented thresholds but creates contradictory user-visible match spans.
- suggested fix direction: distinguish broad video retrieval from precise moment localization; derive displayed spans from same local gate as timeline.

### RC-7 — medium — search preview assets — CONFIRMED

- file: `src/search/engine.ts:707-721`; `src/renderer/src/Search.tsx:282-288`; `src/compute/media.ts:411-421`
- summary: transcript seek times are used as preview frame filenames although only sampled visual timestamps exist.
- failure scenario: speech query `ask not what your country can do for you` -> moment `seekMs:0`; result card asks for `vq://frame/2/0`, which does not exist; speech-matching video gets broken/hidden preview.
- evidence/repro: same search repro logs `speech global … seekMs:0 … frameStatus:404`; smoke's visual frames are sample times, not every transcript start. playback seeking to speech start is correct; using that time as asset key is wrong.
- suggested fix direction: return a separate representative preview timestamp or resolve speech seek time to nearest existing visual sample.

## checked and sound
- `npm run build && npx electron tests/fixtures/core-smoke.mjs` passes on the snapshot.
