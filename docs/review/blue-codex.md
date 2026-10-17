# blue-team review: claude findings

review date: 2026-10-17. branch: `may/blue-codex`. worktree: `.worktrees/blue-codex`. reviewed current code, starting from `9925dae`, then incorporated main through `73cc87b` before search work as authorized. implementation head: `46ddf2d`.

all 28 assigned findings have dispositions below: 27 addressed by this branch, one already fixed upstream and verified. “fixed” describes the reported failure and the agreed slice; remaining product/performance limits are stated separately. rl-34 includes rejected subclaims. findings assigned to the other engineer were excluded.

environment: apple m2, macos, node 26.8.1, electron 44.9.0, ffmpeg 9.0.1, sharp 0.35.5. existing dependency/model symlinks preserved; no install or model download. heavy checks ran serially.

| finding | verdict | current-code evidence and resulting behavior | commit |
|---|---|---|---|
| rl-1 | fixed | original URLs returned existing heic/tiff/avi/mpg files, while renderer treated decode errors as disappearance. compute now makes a display preview only when sharp metadata reports a format outside jpeg/png/webp/gif/avif; ordinary images get no extra derivative. real app displayed heic and tiff previews; avi/mpg retained poster, clear unsupported-format copy and reveal action. regression disguises a tiff as jpg, proving metadata controls generation. | `5f74012` |
| rl-2 | fixed | card selection was local and absent from open state. selected moment now reaches viewer/player/poster. real marker check opened chosen later scene; current-build keyboard check selected bars 1:10–1:30 and opened at 69.02s, expected 69s. each key event awaited a render; the original repro's synchronous key loop was unsuitable for advancing react state. | `8bf2f82` |
| rl-9 | fixed | utility exit previously left ports/calls alive. disconnect now rejects pending/future calls; main restarts the linked utility trio with bounded backoff, reconnects renderer and replays subscriptions. real SIGKILL of search, compute and catalog each recovered and returned cat results. fourth crash reached inline stopped state and rejected new calls, without modal. | `a0a17b4` |
| rl-11 | fixed | focus called full rescan; now checks offline roots only. scans coalesce per root, with at most one trailing walk for changes during an active scan. catalog regression confirms shared queued promise. failed-job retry behavior from upstream `0db3187` preserved. | `3970858` |
| rl-12 | fixed | search counted every non-done job as pending. only pending/running now count, including incremental refresh when attempts become failed. affected search regression and final suite passed; exhausted failures no longer promise growing results. | `7429a13` |
| rl-13 | fixed | grid had no stable-item anchor across relayout. it now restores first visible id plus offset. real 300-image library, 60 newer files inserted: viewport center stayed img270.jpg while scrollTop changed 2400→6889 and grid height 29333→33822. | `7429a13` |
| rl-14 | fixed | repeated full listings/counts/progress queries were confirmed hot paths. lean columnar listing, one-view cache, aggregate libraryStats, temporary incremental job counters, changed-id pending refresh and stable geometry references remove repeated work. 100k synthetic measurements below distinguish cached, uncached and recent calls. | `7429a13` |
| rl-15 | fixed | whole item cache was cleared and results replaced on each bump. changed ids now become stale while retaining visible metadata; same-query results append without reordering existing hits/scenes. 250 real-app samples recorded zero blank card titles. rename while player open updated title, preserved exact video DOM node and recorded zero blank samples, preserving upstream viewer continuity. | `7429a13` |
| rl-16 | fixed | addFolder awaited hashing before returning. it now registers scan and returns inserted folder immediately; catalog regression observes count=0 before settled discovery. navigation happens at initial user action. | `3970858` |
| rl-17 | fixed | shared spawn helper had no child registry; entrypoint had no abandoned-decode sweep. synchronous exit cleanup kills active decoders; startup removes only abandoned .decode-* directories. entrypoint regression failed before fix (“ffmpeg survived compute SIGTERM”), passes SIGTERM/explicit exit and keeps completed frames. actual built electron quit during 4k ffmpeg work also left no live child at 1.5s. forced termination limit below. | `0c25c37` |
| rl-18 | fixed | sprite command decoded all source frames. keyframe decode plus eof padding now produces all 50 tiles. sparse-GOP regression failed at tile25 before fix, passes afterward. real sprite median 6394.71→432.89ms across three serial runs each; workload/spread below. | `ca6c0bf` |
| rl-20 | fixed | ordinary words silently became media filters. only explicit type:video/type:image syntax now parses as a type filter; natural query words remain. real character-by-character “a video game console on a desk” stayed intact, media All; clearing stayed All. existing visible media controls remove explicit filters. | `6cec54e` |
| rl-21 | fixed | find input Enter consumed old pins while query stale. Enter now waits for current results. real player held time=2s when query changed and Enter arrived during debounce. | `8bf2f82` |
| rl-22 | fixed | walker accepted dot/sidecar entries; search manufactured readiness. dot entries, @eaDir and $RECYCLE.BIN are skipped; MediaItem.ready drives search tiles. catalog fixture includes AppleDouble and sidecar-directory copies and verifies only actual items are indexed; paused item reports not ready. | `7429a13` |
| rl-23 | fixed | folder-close callback changed each sidebar render and reran menu focus effect. callback now stable. real confirmation kept focus on Remove through parent rerender. | `5f5052c` |
| rl-24 | fixed | fullscreen targeted video stage, excluding controls. target is full player, with visible exit control and matching state. real electron test exposed fullscreen permission denial as well; narrowly permitted trusted main-frame fullscreen. actual fullscreen element contained vbar; on-screen exit worked. | `5f5052c` |
| rl-25 | fixed | benchmark represented vectors rather than realistic media count. benchmark now includes 990k vectors: 90k stills + 10k five-minute videos at 3 samples/10s. persisted raw runs and corrected architecture claim; measured p95=312.8ms before models/fusion/ipc. scale optimization remains deferred, with plan below. | `98363b3` |
| rl-26 | fixed upstream | current catalog already marks an empty/replaced known root offline and keeps aliases. existing real Catalog boundary regression empties mount point and observes offline with all three items retained. final suite passed; no duplicate patch/test added. | `e35a4c5` |
| rl-27 | fixed | data-directory check covered equality only. canonical containment now rejects descendants too. catalog regression rejects dataDir/thumbs before any scan. | `3970858` |
| rl-28 | fixed | bare pointerup resized sidebar without drag. handler now requires active drag; cancel clears state. real pointerup at x=345 left width unchanged. | `5f5052c` |
| rl-29 | fixed | quick-look escape handler depended on focus remaining inside. window capture handler now closes on Escape/Space while open. real check moved focus to sidebar and Escape closed preview. | `5f5052c` |
| rl-30 | fixed | moment list lacked list parent; popovers claimed menu behavior they did not implement; player tabs lacked panels/roving focus. added list parent, ordinary dialog popovers with pressed buttons, and associated tabpanel/roving tabs. real right-arrow selected transcript tab and its labelled panel. | `5f5052c` |
| rl-32 | fixed | dictionary-download risk cannot be reproduced on macos. BrowserWindow explicitly disables spellcheck, removing reliance on interception of dictionary requests on windows/linux. static option verified against electron definitions; cross-platform runtime dictionary behavior was not tested. | `dbdabec` |
| rl-33 | fixed | subscription map insertion followed await, leaving a double-subscribe window. map now stores subscribe promise before awaiting; remove/close await it before unsubscribe. confirmed by current control flow; linux inotify timing not exercised. | `3970858` |
| rl-34 | fixed; subclaims rejected/flagged | duplicate query-vector finite/type check removed because all production encoders return unitVector-validated vectors. minWidth changed 720→640 so specified below-700 drawer is reachable; real app confirmed breakpoint and fixed drawer. remaining validation/dead-path decisions below. | `46ddf2d` |
| rl-35 | fixed | title-bar overlay and prepaint used mismatched colors. overlay now #1e1e1e, dark prepaint #171717, light #ffffff. actual dark BrowserWindow background asserted; native overlay inspection remains platform-specific. | `dbdabec` |
| rl-4 | fixed with measured recall ceiling | original .20 floor admitted unrelated fixtures and renderer always led with moments. .23 floor permits empty results; section ordering uses approved SearchResult.leading. follow-up replaces overly strict .01 band with .03, smallest measured band retaining ≥95% of multi-positive set: 52/53, 7/477 negatives. purple giraffe returns zero fixture results in smoke and real app. broader background-set counterexample below remains documented. | `b0fa040`, `4f11d17` |
| rl-5 | fixed | fts OR/stopwords admitted unrelated speech. quoted Unicode content terms now use AND after English stopword removal; both indexes require bm25 strength ≥5e-7. rpc regression isolates lexical votes, preserves genuine single-term hit, rejects missing-term and stopword-only matches. real-encoder corpus no longer returns rocket transcript for five reported bad queries. tone has no transcript with inherited whisper gate `c9c1ebe`. | `17f612a` |

the approved shared additions shipped with their implementations: paths.preview/mediaUrl.preview; service state/events plus rpc disconnect; MediaItem.ready, LibraryStats/libraryStats(), LibraryChange payload; SearchResult.leading. LibraryStats.years is used by date-filter UI. no contract removals were made for cleanup.

rl-4 calibration used production preprocessing and local clip b/32 int8 encoders: 10 originals, four natural variants each (center 80% crop, brightness 80%, horizontal flip, 5° rotation), plus three fixture cat encodings. that yields 53 labelled positives and 477 other image/query pairs. raw matrix, manifest, variant labels and frontier are persisted in [bench-calibration-results.json](../../src/search/bench-calibration-results.json); runnable source is [bench-calibration.ts](../../src/search/bench-calibration.ts).

| global band | retained positives / 53 | recall | accepted negatives / 477 |
|---|---:|---:|---:|
| .006 | 19 | 35.8% | 0 |
| .01 | 32 | 60.4% | 1 |
| .02 | 47 | 88.7% | 3 |
| **.03, selected** | **52** | **98.1%** | **7** |
| .04 | 52 | 98.1% | 15 |
| .05 | 52 | 98.1% | 16 |
| .06 | 53 | 100% | 17 |
| .08 | 53 | 100% | 21 |

zero false positives and ≥95% recall cannot both hold on these measured bands. selected .03 follows the parent-directed rule: reach ≥95%, then minimize false positives. one missed positive is rotated grass, cosine .23042 versus cutoff .25322. original named pairs retain 10/10, with 3/90 cross-image pairs admitted. timeline markers remain at .006; this is intentionally stricter than global candidate retrieval.

on the actual smoke library, unrelated best visual scores are purple giraffe .20813, underwater wedding .20843, snowmobile blizzard .22567, dragon juggling pancakes .22287: all below .23. this does not establish universal rejection: purple giraffe scores .24010 against horse.png in the wider ten-image background set and remains a false positive there. the small labelled variant set establishes measured recall, not broad-category recall for every user's library. abstract queries below the floor can still miss.

to rerun calibration after generating smoke fixtures:

```sh
npm run build
npx electron tests/fixtures/core-smoke.mjs
node --experimental-strip-types src/search/bench-calibration.ts /absolute/path/to/research/raw/images
```

rl-5 follows [sqlite fts5 full-text query syntax](https://www.sqlite.org/fts5.html#full_text_query_syntax) and [fts5 bm25](https://www.sqlite.org/fts5.html#the_bm25_function). quoting each content token treats it as data; AND requires all remaining terms. fts5 rank is negated to obtain strength. floor 5e-7 keeps genuine ubiquitous single-term hits that a 1e-6 floor rejected in the fixture; stopword-only input supplies no lexical vote. the English stopword list matches the current English model pack; semantic branches can independently return a relevant result.

rl-14 measurements used the repointed red-team perf script, synthetic 100k media (20% videos), ~220k jobs, m2, seven serial runs per path, no concurrent heavy benchmark. values are milliseconds, median (min–max):

| path | before | after |
|---|---:|---:|
| library(all), repeated same filter | 599.1 (588.7–614.0) | cached <0.1 |
| library(recent) | 586.6 (576.0–598.0) | 296.1 (290.2–298.3) |
| indexState | 39.1 (38.1–39.5) | <0.1 (0.0–0.3) |
| search refresh, 200 changed ids | 33.9 (33.6–35.5) | 0.1 (0.1–0.2) |

one uncached all-library call measured 319.2ms, n=1; it is not a p95 or repeated baseline. listing remains O(n) when membership/geometry actually changes, and recent listing remains O(n). the fix removes frequent redundant listing/geometry work, not all 100k-item costs. progress counters are temporary sqlite tables/triggers rebuilt at catalog startup, not persistent derived state.

rl-18 measured actual mediaTools.sprite including sharp/webp on existing 60s 3840×2160 h264/30fps, 1800 frames, 437MiB, m2, ffmpeg 9.0.1, node 26.8.1, two decode/filter threads, sharp concurrency one. three serial runs each, no explicit warmup, shared laptop:

| implementation | samples, ms | median, ms | range, ms |
|---|---|---:|---|
| full decode | 6386.03, 6399.28, 6394.71 | 6394.71 | 6386.03–6399.28 |
| keyframe decode + padding | 432.89, 431.91, 470.10 | 432.89 | 431.91–470.10 |

measured speedup 14.77×. hover timing is approximate within a GOP; full-duration demux remains. no hour-long/hevc extrapolation or all-intra speedup claim.

rl-25 scan-only benchmark now uses 50 measured runs after 10 warmups, exact top-200 over seeded 512d normalized f32 vectors, warm memory, two workers. worker transfer is included; model encoding, db, fusion and electron ipc are excluded. environment and individual samples: [blue-codex-scale.json](blue-codex-scale.json).

| workload | vector bytes | p50 | p95 | range |
|---|---:|---:|---:|---:|
| 100k vectors | 204,800,000 | 19.2ms | 19.7ms | 19.1–30.9ms |
| 990k vectors | 2,027,520,000 | 194.2ms | 312.8ms | 193.7–323.2ms |

sub-100ms search for a mixed 100k-item library remains unachieved. architecture now states that limit and the next evaluation: per-scene pooling and quantization, then offline ann candidates with exact rerank if recall survives. end-to-end p95 and recall must be measured before claiming the target.

rl-34 is not a blanket license to delete boundary checks. unitVector consumes unknown model output and normalizes it; catalog validates compute results before database insertion; Vectors.append validates externally persisted blob dimensions/alignment/finiteness before matrix construction. these are distinct model/ipc/disk boundaries. compute argument checks guard subprocess/file execution. the redundant check after trusted query encoders was removed.

remaining paths are flagged explicitly, rather than removed with unrelated contract churn: similar() has no renderer caller yet, although design §6.4 requests nearest neighbours; real catalog etaMs is always null while the mock exercises the eta UI; Scene.frameMs currently has no renderer consumer but is used by the frame-serving smoke. scanPlain is benchmark oracle code with an existing explanatory comment and is tree-shaken from built utility entries (no function scanPlain in out/main). the unreachable drawer claim was real and is fixed. broad removal of the other guards is rejected for the boundary reasons above.

final gate at `46ddf2d` passed, in order:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx electron tests/fixtures/core-smoke.mjs
```

typecheck passed node/web; lint checked 66 files; tests passed 10/10, zero skips, 6.362s. smoke passed three utilities, 27 completed jobs, real local semantic/speech search, previews/sprites/frames, range/head, seek and reload. subsequent crash-limit verification changed no repository code.

real-app verification used repointed copies of reviewer scripts in /tmp/blue-codex plus focused harnesses, against built electron with test libraries, not mocked HTML. relevant runnable artifacts:

| command / artifact | checked |
|---|---|
| `npx electron /tmp/blue-codex/formats.mjs` | heic/tiff display; avi/mpg poster/copy/reveal |
| `npx electron /tmp/blue-codex/drawer-keyboard.mjs` | 640px drawer; ] + Enter selected moment |
| `npx electron /tmp/blue-codex/recovery.mjs` | search/compute/catalog crashes; fourth crash stops inline and rejects calls |
| `npx electron /tmp/blue-codex/ui-interactions.mjs` | folder focus, resizer, quick-look escape, fullscreen controls/exit, tabpanel, stale Enter |
| `npx electron /tmp/blue-codex/search-ui.mjs` | image section first; purple giraffe no matches; prepaint token |
| `node /tmp/blue-codex/quit-check.mjs` | actual electron quit while ffmpeg runs; no surviving child |
| `npx electron /tmp/blue-codex/continuity.mjs` | viewer item refetch after rename; exact video element retained |
| repointed app-harness4/app-harness7/app-harness8 | scroll anchoring, card continuity, natural query typing |

these /tmp artifacts and their test-library profiles are local session evidence, not portable committed fixtures. persistent regressions remain in existing catalog/compute/search tests and core-smoke; the calibration check requires ≥95% labelled recall. captured screenshots:

- [heic preview](/tmp/blue-codex/rl1/fixed-coffee-heic.heic.png), [unsupported avi](/tmp/blue-codex/rl1/fixed-clip-avi.avi.png).
- [selected moment](/tmp/blue-codex/selected-moment.png), [fullscreen controls](/tmp/blue-codex/fullscreen.png), [narrow drawer](/tmp/blue-codex/drawer.png).
- [image section first](/tmp/blue-codex/search-cat.png), [no matches](/tmp/blue-codex/no-matches.png), [service recovery](/tmp/blue-codex/recovery-search.png), [bounded stop](/tmp/blue-codex/recovery-failed.png).

remaining limits/deferrals:

- unsupported video gets useful poster and reveal now; displayable proxy transcode is a later slice, as approved. image previews are capped at 2560px, not full-resolution archival renditions.
- SIGKILL/native crash/forced windows termination bypasses javascript exit hooks and may orphan a decoder. startup sweeps abandoned temp directories; an OS parent-death/job mechanism is needed for a hard-kill guarantee. normal SIGTERM/exit and actual electron quit passed.
- realistic mixed-library latency target remains unmet; pooling/quantization/ann evaluation is planned, not implemented.
- semantic false positives and one labelled variant miss remain as quantified above; English stopword handling does not establish multilingual relevance.
- windows/linux app runs, native title-bar visuals, dictionary downloads, native crash behavior and linux watcher timing were not executed on this macos host. no packaged build was tested.
