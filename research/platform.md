# platform architecture research

checked 2026-10-17, asia/manila. scope: `research/BRIEF.md`. **verified** means official docs/release metadata; **observed** means inspected source; **measured** means local runnable check; **unverified** means release gate. no app built or commit made. ente source inspected read-only; no install/build/app execution.

## decision

use electron **44.9.0**, electron-vite **6.0.0**, typescript **7.0.2**, react/react-dom **19.3.1**. main handles lifecycle, native dialogs, window security, port setup and short asynchronous protocol handlers. isolate catalog, media/ml indexing and interactive search in separate node-enabled utility processes. background indexing cannot occupy main or interactive search event loops. [electron 44 process model][e-process], [utility api][e-utility], [performance][e-performance], [electron-vite][ev-guide].

metadata/fts5: bundled **node:sqlite**, with its release-candidate status explicitly accepted under pinned electron. vectors: **usearch 2.26.4** hnsw, canonical float32 embeddings retained in sqlite. media: **sharp 0.35.5**, **onnxruntime-node 1.30.0**, separately packaged **ffmpeg/ffprobe 9.0.2**. watch: **@parcel/watcher 2.6.0**. production recommendation is an audited lgpl ffmpeg build; exact artifact is an uncompleted release gate. alternatives and evidence follow. [node 24.22 sqlite][n-sqlite], [usearch 2.26.4][u-node], [sharp manifest][s-manifest], [ort node][ort-node], [ffmpeg licensing][f-legal].

```text
sandboxed react renderer
  | contextBridge: choose library, browse, job/model controls
  | transferred dom messageport: search requests/results/cancel
  | media:// capability urls: thumbnails/originals/proxies
  v
main: lifecycle + sender guard + port setup + async media protocol
  |                         |                          |
  v                         v                          v
catalog utility         indexing utility            search utility
- sqlite single writer  - ffprobe/ffmpeg children   - readonly sqlite
- fts/jobs/roots         - sharp/libvips              - usearch hnsw
- scan + watcher        - ort image/caption models  - ort text encoder
- streaming file hash   - bounded raw-frame pipe    - filters + fusion
- durable vector log    - submit results to catalog - ids + timestamps
  |                         |                          ^
  +------ sqlite + wal -----+---- derived caches ------+
  +------ committed vector changes -------------------+

optional worker_threads inside utility: measured pure-js cpu kernels
raw frames stay in indexing process; thumbnails use file streams
```

three utility processes are deliberate isolation, not a configurable pool. synchronous sqlite, native inference, or vector search may occupy one event loop without delaying another role. start renderer immediately, catalog next, search warm-up after first paint, indexing last. start background processing at one file. four-core baseline: ffmpeg one decode/filter thread, sharp one thread, ort one intra-op thread; overlapping decode+inference should consume at most two background cpu workers. m2 can try two threads per active native stage after measuring contention, rather than multiplying independent thread pools. interactive text encoder starts with one thread and priority over new background batches. isolation prevents event-loop blocking, not cpu/ram/io contention; budgets are proposals, not measured optimal settings, and native libraries may spawn extra threads. [electron performance][e-performance], [node workers][n-workers], [sharp concurrency][s-utility], [ort threading][ort-threads].

| module / process | responsibility |
| --- | --- |
| `main/index.ts` | data paths, instance lock, window, permission/navigation policy, utility lifecycle |
| `main/ipc.ts`, `preload/index.ts`, `shared/contracts.ts` | finite typed methods, sender/input validation, listener cleanup |
| `main/media-protocol.ts` | capability lookup, async file open, range response; no decode/db scan |
| `catalog/index.ts` | migrations, single writer, fts, job leases, transactional results |
| `catalog/files.ts` | scan/watch reconciliation, file observations, hash, drive state |
| `indexing/index.ts`, `indexing/media.ts` | one job, ffprobe/ffmpeg, raw-frame assembly, sharp/cache publication |
| `indexing/inference.ts` | trusted model paths, transforms, cached ort sessions, output validation |
| `search/index.ts` | paired text encoder, hnsw, filtered exact fallback, fusion, stale-query suppression |
| `renderer/gallery.tsx`, `renderer/search.ts` | virtualization, bounded image lifetime, cursor pagination |
| `models/manifest.json` | artifact digests, embedding space, dimensions, transforms, tokenizer, licenses |

these are responsibilities, not a plugin framework or one-interface-per-module requirement. electron-vite builds utility entrypoints as extra main-side inputs, keeping native dependencies external. bundle sandbox preload into one commonjs file; restricted preload `require` cannot load arbitrary node packages. [electron sandbox][e-sandbox], [electron-vite dependencies][ev-deps], hibi build evidence below.

## versions checked today

[releases.mjs](bench-platform/releases.mjs) runs `npm view <package> version dist-tags engines license dist.unpackedSize repository.url --json` and records registry publish timestamps. [releases.json](bench-platform/releases.json) contains results. [assets.mjs](bench-platform/assets.mjs) records github/npm binary metadata in [assets.json](bench-platform/assets.json). package and embedded binary versions differ.

| component | latest stable observed / proposed pin | source |
| --- | --- | --- |
| electron | **44.9.0**; chromium **152.0.7977.167**, bundled node **24.22.0**, electron abi **149** | [release][e-release], [args][e-args] |
| node | **26.12.0 current**, **24.22.0 lts**; use 24.22.0 for builds; measured host 26.8.1 | [current][n-current], [lts][n-lts] |
| sqlite upstream | **3.54.0**, 2026-10-09; bundled version controlled by electron/node | [history][q-releases] |
| electron-vite / vite | **6.0.0 / 8.3.4**, exact pins; major-upgrade build smoke pending | [registry](https://registry.npmjs.org/electron-vite/6.0.0), [vite](https://registry.npmjs.org/vite/8.3.4) |
| typescript | **7.0.2** | [registry](https://registry.npmjs.org/typescript/7.0.2) |
| react / react-dom | **19.3.1 / 19.3.1** | [react](https://registry.npmjs.org/react/19.3.1), [react-dom](https://registry.npmjs.org/react-dom/19.3.1) |
| electron-builder | **26.15.3**, use v26 docs | [registry](https://registry.npmjs.org/electron-builder/26.15.3), [config][b-config] |
| @electron/rebuild | **4.2.1**, build dependency when needed | [registry](https://registry.npmjs.org/@electron%2frebuild/4.2.1) |
| sharp | **0.35.5**; @img native packages 0.35.5, libvips packages 1.3.4 | [manifest][s-manifest] |
| libvips | **8.18.7**; sharp requires >=8.18.7; inspect packaged `sharp.versions.vips` | [release][v-release], [sharp][s-manifest] |
| onnxruntime-node | **1.30.0**, cpu baseline | [registry](https://registry.npmjs.org/onnxruntime-node/1.30.0), [docs][ort-node] |
| usearch | **2.26.4** | [registry](https://registry.npmjs.org/usearch/2.26.4), [binding][u-node] |
| @parcel/watcher | **2.6.0** | [versioned readme][w-parcel] |
| ffmpeg / ffprobe | **9.0.2**, record build flags + sha256 as well as version | [upstream][f-download] |

comparison-only, not default shipping dependencies: better-sqlite3 **13.0.3**, sqlite-vec **0.1.9**, @libsql/client **0.18.0**, hnswlib-node **3.0.0**, @lancedb/lancedb **0.40.0**, faiss-node **0.5.1**, ffmpeg-static **5.3.0**, ffprobe-static **3.1.0**, @ffmpeg-installer/ffmpeg **1.1.0**, ffbinaries **1.1.6**, chokidar **5.0.0** (requested v4 line: **4.0.3**), blake3 **3.0.0**, hash-wasm **4.12.0**. exact registry urls/dates/dist-tags are in `releases.json`. sqlite-vec's separate alpha tag is **0.1.10-alpha.4**.

## process choices and typed ipc

| location | use / limitation |
| --- | --- |
| main | electron/os APIs and bounded routing; no sync db/hash/decode/model loading/bulk serialization/vector loops |
| utilityProcess | node/native work and crash recovery; node privileges mean this is not a filesystem sandbox |
| worker_threads | pure-js cpu kernels or transferable/shared arrays when measured useful; same process failure domain, no electron APIs, addon thread-safety still matters |
| hidden sandboxed renderer + worker | browser-only libraries or webcodecs/webgpu; extra browser machinery, codec/demux and throttling/lifecycle constraints |

utility processes are default for native work; no new thread per file. electron warns about native module loading in concurrent worker environments. hibi's hidden analysis host is useful for browser-only work, not proof hidden renderer is best for ort/sqlite. [process model][e-process], [utility][e-utility], [multithreading][e-multithreading], [node workers][n-workers].

main creates `MessageChannelMain`; `child.postMessage(init, [port1])` transfers one endpoint to utility, and `webContents.postMessage('search:port', bootstrap, [port2])` transfers other to renderer. preload forwards dom port after load to known app origin; renderer validates source/origin/bootstrap token. requests carry ids. close ports on window/utility exit; replacement gets fresh generation/port. keep lifecycle/logging on utility control channel. [message ports][e-ports], [channel][e-channel].

**ipc is not universally zero-copy:** `MessagePortMain.postMessage` documents transfer of message ports, not arbitrary array-buffer transfer lists. node worker_threads explicitly support `ArrayBuffer` transfers/shared buffers, a different api. keep frames inside indexing and stream raster files instead of bridging tensors/base64. contextBridge copies/freezes data and proxies functions. [port api][e-port], [workers][n-workers], [bridge][e-bridge]. worker transfer detaches sender's buffer; use owned array buffers, not pooled node Buffer backing stores, and do not treat SharedArrayBuffer as lock-free ownership by default.

window: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`. expose finite methods, never raw `ipcRenderer`, arbitrary channel names, sql, paths or spawn commands. main guard checks exact app origin, expected window webContents and main frame; validate payloads at ipc/port entry. typescript is not runtime validation. deny navigation/new windows/permissions except intended actions. [isolation][e-isolation], [sandbox][e-sandbox], [security][e-security].

```ts
type Reply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: 'invalid' | 'unavailable' | 'failed'; message: string } };

type SearchMessage =
  | { id: number; type: 'search'; text: string; limit: number;
      filter?: { rootId?: number; kind?: 'image' | 'video' } }
  | { id: number; type: 'cancel' };
type SearchHit = {
  mediaId: number; segmentId: number; startMs: number; endMs: number;
  score: number; thumbnailUrl: string;
};
type SearchReply = { id: number;
  result: Reply<{ hits: SearchHit[]; indexSequence: number }> };
type DesktopApi = {
  chooseLibrary(): Promise<Reply<{ rootId: number }>>;
  browse(input: { rootId?: number; cursor?: string; limit: number }): Promise<Reply<GalleryPage>>;
  indexing(action: 'pause' | 'resume'): Promise<Reply<void>>;
  downloadModel(modelId: string): Promise<Reply<void>>;
  onIndexProgress(callback: (event: IndexProgress) => void): () => void;
};
```

`GalleryPage`/`IndexProgress` are app-owned contracts, not electron objects. finite channel map uses `satisfies`; augment `Window` with `DesktopApi`. bound ids/query length/page size, validate filters, only accept manifest model ids. direct search port gets same guards as invoke. coalesce pending queries, discard superseded results, cap progress broadcasts (proposed 5–10/s). cancellation initially suppresses stale native results rather than pretending running native calls are instantly interruptible. [ipc][e-ipc], [isolation/typescript][e-isolation].

## reusable local projects

observed worktrees 2026-10-17: mux commit `6c9e7f4c111bc7126c0aa1b27c361291aef4695e`; hibi commit `0979200e0081f43baaa7fab98db942365da93649`. paths below are source observations, not upstream guarantees. worktrees may contain later changes. neither app was modified or run as an application.

| pattern | exact local source | reuse / qualification |
| --- | --- | --- |
| finite typed channels | `/Users/may/Documents/ChatGPT/mux/src/shared/api.ts`, `src/shared/channels.ts` | `satisfies Record<...>` catches missing methods |
| bridge/unsubscribes | `/Users/may/Documents/ChatGPT/mux/src/preload/preload.ts:1` | finite wrappers, listener removal, dropped file path derived in preload |
| trusted sender | `/Users/may/Documents/ChatGPT/mux/src/main/main.ts:236`, `:368` | expected window/main-frame/origin guard |
| secure streaming scheme | `/Users/may/Documents/ChatGPT/mux/src/main/main.ts:19`, `:214` | standard/secure/fetch/stream/codeCache; own resolver, csp/nosniff |
| data dir + lock | `/Users/may/Documents/ChatGPT/mux/src/main/main.ts:30`, `src/main/data-dir.mts:19` | dev/test profiles; override selected before lock/storage |
| startup benchmark | `/Users/may/Documents/ChatGPT/mux/scripts/benchmark.mjs`, `scripts/bench-electron-baseline.mjs` | real electron launch, fresh/retained profiles, readiness predicate, median/p95 |
| vite/native packaging | `/Users/may/Documents/ChatGPT/mux/package.json:85`, `vite.config.mts`, `scripts/after-pack.cjs` | vanilla ts + vite-plugin-electron; native/helper unpacking in package config; after-pack hook only replaces mac icon |
| electron-vite/react split | `/Users/may/Documents/ChatGPT/hibi 2/electron.vite.config.ts` | main variants, native externals, bundled cjs sandbox preload, chromium target |
| bridge/data/window | `/Users/may/Documents/ChatGPT/hibi 2/src/preload/index.ts:111`, `src/shared/desktop.ts`, `src/main/index.ts:369`, `:742` | parallel bootstrap, typed api, dev profile, sandbox |
| video range serving | `/Users/may/Documents/ChatGPT/hibi 2/src/main/media.ts:244` | token + validated opened file, single range, streaming 206/416; add head/abort/empty-file cases |
| hidden worker host | `/Users/may/Documents/ChatGPT/hibi 2/src/main/analysis.ts:131`, `src/preload/analysis.ts` | isolated hidden sandbox window, navigation guards, `backgroundThrottling: false` |
| startup instrumentation | `/Users/may/Documents/ChatGPT/hibi 2/src/shared/startup.ts`, `bench/desktop/startup.bench.mjs` | spans and real fresh/retained-profile input/workspace readiness |
| packaging/resources | `/Users/may/Documents/ChatGPT/hibi 2/electron-builder.yml` | extraResources/fuses/signing; `npmRebuild: false` is app-specific |

use `app.getPath('userData')/library` for sqlite/durable state; separately named bounded `userData/viquery-cache` initially holds derived files, with capacity eviction. models under `userData/models` are durable assets, not thumbnail eviction candidates. large cache relocation can be added when needed. choose dev/test data dir before instance lock/db open. electron recommends subdirectories for app state and separating chromium `sessionData` caches when appropriate; there is no assumed `app.getPath('cache')` api. [electron app paths][e-app].

## local media delivery

register schemes once **before** app ready, and handlers on same session as window. use `app` for ui and `media` for assets. media flags: `standard`, `secure`, `stream`, `supportFetchAPI`, `corsEnabled` true; **`bypassCSP: false`**; no service workers/extensions. stream configures media elements for streamed responses; it does not implement byte ranges. secure enables secure-context treatment, not filesystem authorization. [protocol][e-protocol], [privileges][e-scheme].

serve `media://library/<opaque-capability>/thumb/320.jpg` and `/original`. capabilities map to approved asset/revision in bounded main cache populated by catalog responses. no absolute path in url; resolve within selected roots, account for symlinks, revalidate opened file/revision when changed. only converted raster thumbnails; no executable user html/svg. image/video requests may omit origin, so authorization is capability/session ownership, not `Origin` alone. csp allows `media:` only where required (`img-src`, `media-src`, `connect-src`), never broad network/csp bypass. exact mime, nosniff, immutable content-addressed thumbnails. `corsEnabled` enables checks, not access by itself: renderer fetch/canvas requires narrow `Access-Control-Allow-Origin` for trusted app origin, and anonymous cross-origin images where needed; do not use wildcard credentials. no localhost server/base64/whole-video read needed. main only opens asynchronously and establishes streams. [electron security][e-security], [protocol][e-protocol], [node streams][n-stream], hibi example above.

| request | response |
| --- | --- |
| get without range | 200 streamed body, length, `Accept-Ranges: bytes` |
| `bytes=start-end`, `bytes=start-`, `bytes=-suffix` | 206, clamped bounds, exact `Content-Range` + length |
| valid unsatisfiable range | 416, `Content-Range: bytes */size` |
| multiple ranges | initially ignore and stream 200; multipart unnecessary for normal playback |
| head | corresponding headers, no body |

handle zero-byte file before constructing stream; bound integer arithmetic; close/destroy stream on abort/navigation. malformed or unsupported range syntax may be ignored under http semantics. forwarding range headers to `net.fetch(fileURL)` is only acceptable after actual packaged seek tests: electron's basic protocol example alone does not guarantee range forwarding. [rfc 9110 sections 14–15][http-range], [protocol][e-protocol].

```text
viquery-cache/v1/
  thumbs/ab/cd/<full-hash>/<pipeline-rev>/image-320.jpg
  thumbs/ab/cd/<full-hash>/<pipeline-rev>/t-000012340-640.jpg
  posters/ab/cd/<full-hash>/<pipeline-rev>/poster.jpg
  proxies/ab/cd/<full-hash>/<proxy-profile-hash>/preview.webm
  tmp/<job-id>-<lease-token>.*
```

fanout avoids one enormous directory; content + processing revision + timestamp/size gives immutable idempotent artifacts. same-filesystem staging, close, rename, then publish path. cache miss regenerates via job. quota/lru evicts derived files only, preserving originals/catalog/models. layout is design choice, not measured filesystem optimization.

renderer: use actual thumbnail-size rasters, fixed dimensions, `decoding="async"`; optionally await `img.decode()` before swap. async is scheduling hint, not free decode. virtualize/release offscreen elements. `content-visibility: auto` skips layout/paint but does not replace virtualization or guarantee bitmap eviction. `createImageBitmap` helps explicit worker/canvas pipelines; ordinary img already has browser-managed decode, so extra canvas/bitmap path is unnecessary initially. close bitmaps when used. [html images][web-img], [css containment level 2][web-contain], [imagebitmap][web-bitmap].

rgba minimum = width × height × 4: 320² **0.391 mib**, 640² **1.563 mib**. 200 decoded 640px tiles alone = **312.5 mib**, excluding textures/cache/copies. compressed file size is not decoded memory. start jpeg 320/640 variants, alpha-preserving webp when needed; avif default awaits decode/encode-quality benchmark. memory figures are arithmetic; format-speed preference is unverified here.

### native playback, electron 44.9 / chromium 152

| codec, ordinary profiles/containers | macos | windows | linux |
| --- | --- | --- | --- |
| h.264/avc | built-in support | built-in support | built-in support |
| vp9 | software decode, hardware optional | same | same |
| av1 | software decode, hardware optional | same | same |
| hevc/h.265 | conditional platform/hardware/profile/os support | conditional driver/os codec/profile support | conditional build/platform/gpu support; not portable baseline |

electron regular `all.gn` enables chrome ffmpeg branding/proprietary codecs. separately distributed chromium-branded replacement ffmpeg has different flags. chromium lists av1/vp9 and conditional proprietary h.264/hevc; hevc decoding delegates to platform capabilities. [electron 44.9 args][e-args], [replacement args][e-ffmpeg-args], [chromium codecs][c-codecs], [chromium 152 media options][c-options], [supported types][c-types]. **unverified:** real hevc playback across machines, hdr tone mapping, ten-bit/chroma profiles, audio/container combinations.

use `canPlayType`/`mediaCapabilities.decodingInfo` as hints and catch actual decode failure. distinguish codec/profile/container/audio failure. poster appears immediately; optional local background proxy cached by source hash/profile. non-gpl baseline proxy: vp9/opus webm; native h.264 encoders can produce mp4 when available. software libx264 proxy requires gpl-enabled ffmpeg. do not eagerly transcode entire library. ffmpeg indexing remains available even if chromium cannot play original. [media capabilities spec][web-capabilities], [ffmpeg licensing][f-legal].

## metadata and vector storage

| binding | verified properties | choice |
| --- | --- | --- |
| node:sqlite in node 24.22.0 | unflagged; **stability 1.2 release candidate**, not stable 2; `DatabaseSync`; `loadExtension` from 22.13/23.5 gated by `allowExtension` | default with pinned runtime; synchronous operations isolated off main; one fewer native module |
| better-sqlite3 13.0.3 | mature synchronous statements/transactions and `loadExtension`; native addon | fallback if rc api unacceptable; rebuild for electron; do not ship both bindings |
| @libsql/client 0.18.0 | local `file:` backend; libsql fork includes vector blobs/diskann, no cloud needed for local mode | alternative when transactional ann/filtering outweigh avoiding sqlite fork/native backend |

sources: [node 24.22 sqlite][n-sqlite], [better-sqlite3 13][q-better], [libsql client][q-libsql-client], [libsql vectors][q-libsql-vector]. @libsql/client0.18.0 depends on native `libsql ^0.5.28`; it is not pure fetch in local mode. current turso docs recommend their newer `@tursodatabase/database` rewrite for new embedded apps; do not conflate that engine with libsql's sqlite fork. [current sdk guidance](https://docs.turso.tech/sdk/ts/reference).

local smoke used existing **electron 44.4.5 / node 24.21.0 / sqlite 3.53.4**: imported node:sqlite, created fts5, inserted/searched term; `loadExtension` method exists. [probe](bench-platform/sqlite-probe.cjs), [result](bench-platform/sqlite-electron-44.4.5.json). **not tested:** actual extension load; exact electron 44.9 utility on all os. accepting rc api is explicit, not describing it as fully stable. metadata connections keep extensions disabled; if adding sqlite-vec, load only trusted immutable bundled library then disable loading. [extension controls][n-sqlite].

### vector choices

| engine / npm version | capabilities | assessment |
| --- | --- | --- |
| plain float32/int8 matrix | exact scan, no index build; sqlite supplies persistence | simplest small-library oracle/fallback; scalar int8 is not simd dot product |
| sqlite-vec 0.1.9 | exact `vec0`; float32/int8/packed-bit; small c extension in sqlite file | good until measured limits; pre-v1; no stable ann guarantee |
| usearch 2.26.4 | native hnsw, float32/f16/bf16/int8/bits, save/load/mapped view | selected ann; napi prebuilds; js binding lacks general c++ filter predicate interface |
| hnswlib-node 3.0.0 | native hnsw, cosine/l2/ip, index persistence | usable, but npm release dates to 2024; binding/prebuild maintenance risk |
| @lancedb/lancedb 0.40.0 | embedded lance/arrow, exact/ivf/ivf-hnsw, pq/sq, fts/filtering | credible scale option; second storage/maintenance system and larger native distribution |
| faiss-node 0.5.1 | flat and factory indexes via faiss | npm release 2023; larger native build surface; c++ features do not imply complete node binding coverage |
| libsql vectors | vector blobs and diskann in sqlite fork | alternative with one transactional store; target node backend/filtered latency still unmeasured |

sources: [sqlite-vec][vec-release], [vector api][vec-api], [usearch binding][u-node], [sdk][u-sdk], [hnswlib-node][u-hnsw], [lancedb indexes][u-lance], [faiss-node][u-faiss], [libsql][q-libsql-vector]. select one ann library, not all these dependencies.

sqlite-vec stable **0.1.9** is exact-search line. main says **0.1.10-alpha.4** and contains ivf/diskann/rescore experiments: do not mislabel these released ann. int8 reduces float32 payload 4×, bits 32×, with model-dependent recall loss. scalar-quantization guide has unfinished examples; stable int8 vector support is not proof every placeholder quantizer function works. [stable][vec-release], [main version][vec-main], [ann experiments][vec-ann], [api][vec-api], [binary quantization][vec-binary].

published sqlite-vec **v0.1.0** benchmark: sift1m (**1m × 128, k=20**) static memory **17ms**, vec0 **33–35ms**, faiss **10ms** on author's setup. dimension comparison reports **105ms at 1536d**, **214ms at 3072d**, smaller dimensions under 75ms in that experiment. historical publisher results use different dimensions/storage/hardware; not predictions for this app's 1m × 512–1024. usearch's publisher speedups likewise do not establish app latency. [primary benchmark][vec-bench], [usearch upstream][u-readme].

### measured exact scan

command: `/opt/homebrew/bin/node research/bench-platform/scan.mjs`. apple m2, 8 logical cores, 24 gib, mac arm64, node **26.8.1**, v8 **14.6.202.34-node.28**. one worker, seeded uniform-random row-major **100,000 × 512**, new random query each run, dot product + exact top-20 min-heap + result sort. **5 warmups, 15 timed runs/type**. both kernels match independent full-sort reference on small matrix. [script](bench-platform/scan.mjs), [raw results](bench-platform/scan-100000x512.json).

| runtime / type | payload | median | p95 = max | min | mean |
| --- | --- | --- | --- | --- | --- |
| host node26 / float32 | 195.31 mib | 49.48ms | 54.25ms | 48.95ms | 49.73ms |
| host node26 / int8 | 48.83 mib | 54.35ms | 56.55ms | 52.78ms | 54.39ms |
| electron44.4.5 node24 / float32 | 195.31 mib | 50.26ms | 54.98ms | 49.12ms | 50.93ms |
| electron44.4.5 node24 / int8 | 48.83 mib | 54.12ms | 58.48ms | 52.89ms | 54.52ms |

cross-check used existing electron binary in `ELECTRON_RUN_AS_NODE=1` mode, same worker script, node **24.21.0**, v8 **15.2.124.28-electron.0**. [raw cross-check](bench-platform/scan-100000x512-electron-44.4.5.json). this is not a renderer/utility integration benchmark or electron44.9 measurement.

host setup **719.64ms**, whole worker **2954.43ms**, rss after both matrices **308.09 mib**. electron setup **620.26ms**, whole worker **2910.39ms**. nearest-rank p95 with 15 observations equals max; small tail sample. load before host run ~48% whole-machine cpu, ~19.2 gib available; before electron run ~40% cpu with other chats active. warm ram only: excludes model encoding, ipc, db/disk, filtering, cosine normalization and ui. int8 saved memory but scalar js still performs componentwise multiplies, so no speedup measured.

**unverified:** four-core x86, dim1024, 1m, native engines and real-vector recall. linear work scaling is inference, not measured timing. exact 100k×512 already spends about half 100ms budget before text encoding; use ann for portable product.

| count, dimensions | raw float32 / int8 payload | recommendation |
| --- | --- | --- |
| 10k, 512–1024 | 19.5–39.1 / 4.9–9.8 mib | exact f32 is reasonable, target timing unverified; usearch can keep one production engine |
| 100k, 512–1024 | 195–391 / 49–98 mib | usearch cosine/f32; starting connectivity16, expansion-search64–128; single query thread |
| 1m, 512–1024 | 1.91–3.81 / 0.48–0.95 gib | usearch f16 or validated i8; canonical f32 disk; mmap optional, page faults affect tail |

settings are tuning starts, not measured optimums. <100ms retrieval at all sizes remains target requiring recall/latency tests. payload excludes ids/graph/allocator/sqlite/copies/models/page cache. f16 halves f32; packed bits need only 61–122 mib at 1m but require model-specific recall checks/reranking. production uses usearch at all sizes; exact scan remains oracle and selective-filter fallback. [types/persistence][u-sdk], [quantization caveats][u-readme].

one index per embedding space + dimension + preprocessing/model revision. normalize per model contract; paired text/image encoders must share space. sqlite embedding ids become usearch bigint keys. durable sqlite change log + periodic index snapshot/sequence permits recovery; missing index rebuilds locally. `view()` is mapped access, not assumed mutable live index. [sdk][u-sdk], [binding][u-node].

node binding lacks c++ filter predicate parity. exact-scan small sql-prefiltered sets; otherwise overfetch/filter/rerank and expand if needed. fixed overfetch cannot guarantee exact filtered top-k. if selective filters dominate at 1m, reassess libsql/lancedb rather than custom filtered graph. [binding feature matrix][u-readme], [libsql][q-libsql-vector], [lancedb filtering][u-lance-filter].

fts5 indexes filenames/captions/transcripts. unicode61; prefix indexes for intended short prefixes. quote ordinary user tokens or validate explicit fts grammar: bound sql alone does not neutralize fts query syntax. retrieve lexical and vector candidates independently, fuse reciprocal ranks `sum(weight / (60 + rank))`, initially equal weights. bm25 lower ranks better; do not add raw bm25 and cosine scores. preserve moment timestamps; group best segments per media with expansion. fusion parameters un-tuned. [fts5/bm25][q-fts], [rrf primary paper][rrf-paper].

## schema, identity, resumable jobs

catalog owns single writer, search read-only connection with short transactions. wal on local app disk, not media/network/removable roots. use `synchronous=FULL` for durable catalog, batching small transactions; `NORMAL` trades away power-loss durability. foreign keys on, bounded busy timeout, passive checkpoints when idle. use sqlite backup facilities, not copying only live db while ignoring wal. [wal][q-wal], [durability][q-pragma], [backup][q-backup].

canonical content id: full-file **sha256**, streamed through node crypto off main; smallest dependency-free option. xxh3 is non-cryptographic; blake3 is cryptographic with streaming/simd, worth testing if hashing dominates. hash-wasm4.12.0 is portable fallback, not assumed faster than native node crypto. [crypto][n-crypto], [xxhash][hash-xx], [blake3][hash-blake], [hash-wasm][hash-wasm].

size/mtime/device/inode are change hints, not identity. optional head/middle/tail sample + size can prioritize likely duplicates; unchanged samples cannot detect changes elsewhere, regardless of hash strength. mtime may be preserved or changed independently; including it in content digest breaks dedup on timestamp-only changes. require full hash before canonical dedup/job identity; stat before/after hash and retry changing files after quiet period. this is correctness inference from input coverage and filesystem semantics. [fs caveats][n-fs].

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

CREATE TABLE roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  volume_key TEXT,
  state TEXT NOT NULL CHECK (state IN ('online', 'offline')),
  scan_generation INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  content_hash BLOB NOT NULL UNIQUE CHECK (length(content_hash) = 32),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  indexed_revision TEXT
) STRICT;
CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id),
  relative_path TEXT NOT NULL,
  media_id INTEGER REFERENCES media(id),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  mtime_ns TEXT NOT NULL,
  file_key TEXT,
  seen_generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('present', 'missing')),
  UNIQUE (root_id, relative_path)
) STRICT;
CREATE INDEX locations_media ON locations(media_id);
CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  pipeline_revision TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'frame', 'scene')),
  start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms INTEGER NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  CHECK ((kind = 'image' AND start_ms = 0 AND end_ms = 0)
      OR (kind = 'frame' AND end_ms = start_ms)
      OR (kind = 'scene' AND end_ms > start_ms)),
  UNIQUE (media_id, pipeline_revision, kind, start_ms, end_ms)
) STRICT;
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  dimension INTEGER NOT NULL CHECK (dimension > 0),
  weights_sha256 TEXT NOT NULL,
  transform_revision TEXT NOT NULL,
  UNIQUE (id, dimension)
) STRICT;
CREATE TABLE embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  vector_f32 BLOB NOT NULL CHECK (length(vector_f32) = dimension * 4),
  FOREIGN KEY (model_id, dimension) REFERENCES models(id, dimension),
  UNIQUE (segment_id, model_id)
) STRICT;
CREATE TABLE vector_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  embedding_id INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete'))
) STRICT;
CREATE TRIGGER embeddings_ai AFTER INSERT ON embeddings BEGIN
  INSERT INTO vector_changes(embedding_id, model_id, operation)
  VALUES (new.id, new.model_id, 'upsert');
END;
CREATE TRIGGER embeddings_au AFTER UPDATE OF vector_f32 ON embeddings BEGIN
  INSERT INTO vector_changes(embedding_id, model_id, operation)
  VALUES (new.id, new.model_id, 'upsert');
END;
CREATE TRIGGER embeddings_ad AFTER DELETE ON embeddings BEGIN
  INSERT INTO vector_changes(embedding_id, model_id, operation)
  VALUES (old.id, old.model_id, 'delete');
END;
CREATE VIRTUAL TABLE search_fts USING fts5(
  filename, caption, transcript, media_id UNINDEXED, segment_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);
CREATE TRIGGER segments_ad AFTER DELETE ON segments BEGIN
  DELETE FROM search_fts WHERE rowid = old.id;
END;
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  content_hash BLOB NOT NULL REFERENCES media(content_hash),
  stage TEXT NOT NULL CHECK (stage IN ('probe', 'thumbnail', 'segment', 'embed', 'caption', 'proxy')),
  segment_key TEXT NOT NULL DEFAULT 'whole',
  model_key TEXT NOT NULL DEFAULT '',
  pipeline_revision TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  available_at_ms INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until_ms INTEGER,
  last_error TEXT,
  CHECK ((state = 'running' AND lease_token IS NOT NULL AND lease_until_ms IS NOT NULL)
      OR (state <> 'running' AND lease_token IS NULL AND lease_until_ms IS NULL)),
  UNIQUE (content_hash, stage, segment_key, model_key, pipeline_revision)
) STRICT;
CREATE INDEX jobs_ready ON jobs(available_at_ms, id) WHERE state = 'queued';
```

schema is ddl draft, not migration. mtime/file keys use decimal strings to avoid js integer precision loss. un-hashed discoveries are locations with null media id and resume on scan. multiple paths share content/media. segment text and `search_fts` row (`rowid=segment.id`) change in same transaction; rename updates aggregated filenames. floats canonical little-endian f32; inference validates dimension, finite values, normalization and model space. sql byte-length checks cannot detect nan or wrong embedding semantics. embedding identity/model is immutable; upgrading model inserts new rows. [sqlite constraints][q-create], [fts5][q-fts], [node conversions][n-sqlite].

claim in short `BEGIN IMMEDIATE`, set lease token/deadline, commit, then run external work. renew long-job lease. commit outputs + done only if lease/revision still match. deterministic cache publication is atomic; lost ack triggers readback before retry. dead/expired lease requeues; late old-lease result rejected. no transaction remains open during ffmpeg/inference. [transactions][q-transactions], [upsert][q-upsert].

vector triggers commit log with embedding changes. search applies idempotently by id/model, tracks sequence, snapshots index + sequence via staged files/manifest. retain log until durable snapshot covers it; inconsistent projection rebuilds from sqlite. autoincrement avoids embedding-id reuse. search readiness follows applied sequence, not merely completed inference. ann is derived/recoverable, outside sqlite transaction. [autoincrement][q-auto], [usearch persistence][u-sdk].

## media processing

### ffmpeg acquisition and licensing

upstream **9.0.2** is latest current-major stable; **8.1.3** maintained branch has later patch date. upstream publishes source and links third-party binaries. wrapper npm version is not codec-tool version. [download/release list][f-download].

| acquisition | observed state | assessment |
| --- | --- | --- |
| ffmpeg-static 5.3.0 | readme still uses **ffmpeg6.1.1**; wrapper ~47 kib excludes downloaded tool | convenient prototype; old embedded tool; gpl; no windows arm64 in audited b6.1.1 assets |
| @ffmpeg-installer/ffmpeg1.1.0 | 2021 wrapper; platform packages mostly 4.1.0/2018-era snapshots, mac arm64 package4.1.5 | reject as current baseline; wrapper lgpl field does not cover every binary |
| ffbinaries1.1.6 | explicit version/platform downloader, ffmpeg/ffprobe components | build-time only, pinned hash/license; runtime download violates offline indexing |
| ente ffmpeg-packaging9.0.2 | modern mac universal, windows/linux x64+arm64 artifacts | reusable staging/checksum/release pattern, but **gpl/libx264** build |
| proposed production | ffmpeg+ffprobe9.0.2 reproducible lgpl build | no `--enable-gpl`, no `--enable-nonfree`, no libx264/libx265; actual artifact/provider/size unverified until built |

sources: [ffmpeg-static][f-static], [installer][f-installer], [ffbinaries][f-binaries], [ente9.0.2 build flags][f-ente-build], [upstream license][f-legal]. gpl applies to gpl-enabled ffmpeg binary. subprocess boundary or npm wrapper license alone does not settle application's distribution obligations. ship matching notices/source/build configuration; no claim that process separation removes license requirements.

measured release asset sizes, **mib**; [assets.json](bench-platform/assets.json). binaries not executed:

| platform | b6.1.1 ffmpeg / ffprobe, uncompressed | b6.1.1 gzip ffmpeg / ffprobe | ente9.0.2 archive including both |
| --- | --- | --- | --- |
| mac arm64 | 43.46 / 43.42 | 18.35 / 18.32 | 47.76 universal tar.gz |
| mac x64 | 75.21 / 75.13 | 24.12 / 24.07 | same universal archive |
| windows x64 | 78.96 / 78.84 | 28.21 / 28.15 | 28.53 zip |
| windows arm64 | no audited asset | no audited asset | 22.39 zip |
| linux x64 | 76.13 / 75.98 | 28.00 / 27.92 | 29.00 tar.gz |
| linux arm64 | 48.77 / 48.63 | 24.38 / 24.31 | 26.69 tar.gz |

sources: [b6.1.1 assets](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1), [ente9.0.2 assets](https://github.com/ente/ffmpeg-packaging/releases/tag/9.0.2). not predicted sizes of unbuilt lgpl configuration. ffprobe duplicates much statically linked footprint; keep it for reliable structured metadata because codec/timestamp correctness is core. ente omits packaged ffprobe and parses stderr; avoid that shortcut here.

### metadata, hardware and frames

ffprobe json (`-show_format -show_streams -of json`) supplies codec/container, duration/timebase, rotation, dimensions and color/hdr metadata. packet/frame inspection only where needed. use child argument arrays, `shell: false`; renderer cannot supply commands. limit protocols to local file/pipe as needed, so imported playlist cannot silently fetch network resources. subprocess exit, bounded stderr, deadline and cancellation belong at job boundary. [ffprobe][f-probe], [protocols][f-protocols], [node child process][n-child].

cpu baseline works with no accelerator. optional decode input flags: mac `-hwaccel videotoolbox`; windows `-hwaccel d3d11va`; linux `-hwaccel vaapi -hwaccel_device /dev/dri/renderD128`. `-hwaccels` enumerates compiled support, not working hardware/codec support. hardware surfaces may need `hwdownload` and matching software pixel format before rgb/scaling; cpu transfer can erase benefit. fall back to software; measure actual throughput/energy. hardware decode and encode choices differ. [ffmpeg acceleration][f-cli].

```sh
# keyframe overview, not complete semantic/scene coverage
ffmpeg -nostdin -threads 1 -filter_threads 1 -skip_frame nokey -i INPUT -an -sn -dn \
  -vf "scale=320:-2,showinfo" -fps_mode passthrough \
  -pix_fmt rgb24 -f rawvideo pipe:1

# select score is 0..1; this filtering follows decode
ffmpeg -nostdin -threads 1 -filter_threads 1 -i INPUT -an -sn -dn \
  -vf "select='gt(scene,0.3)',scale=320:-2,showinfo" \
  -fps_mode passthrough -pix_fmt rgb24 -f rawvideo pipe:1

# scdet score is percentage 0..100, default threshold10
ffmpeg -nostdin -threads 1 -filter_threads 1 -i INPUT -an -sn -dn \
  -vf "scdet=threshold=10:sc_pass=1,scale=320:-2,showinfo" \
  -fps_mode passthrough -pix_fmt rgb24 -f rawvideo pipe:1
```

command sketches, not run here. compute fixed output dimensions after orientation/aspect metadata; fixed-size scale/pad is simpler if stream dimensions change. `skip_frame nokey` is decoder input option and can avoid non-key decode; `select`/`fps` normally drop frames after decoding, so fewer output frames do not imply proportional decode savings. scdet emits `lavfi.scd.time`, score, mafd; its threshold10 differs from select0.3. keyframes miss short actions, scene cuts miss changes inside shot: combine sparse temporal samples and scene refinement. [skip_frame][f-all], [select][f-select], [scdet][f-scdet].

pipe rgb directly to node: frame bytes = width × height × 3. carry partial chunks and split multiple frames per chunk; never equate data event to frame. rawvideo has no timestamps: use separate metadata/showinfo stream or timestamped container, preserve source pts/timebase for vfr, not frameIndex/assumedFps. pause/await reading when two frames buffered; stop child on cancellation. model manifest determines crop/resize/normalize, rather than embedding stretched previews. no frame temp files required. [rawvideo][f-raw], [pipe][f-protocols], [stream backpressure][n-stream].

### sharp and libvips

sharp **0.35.5**, libvips **8.18.7** required minimum. `autoOrient()` applies exif rotation/mirroring; thumbnail/shrink-on-load paths avoid unnecessary full-size rgba. bound input pixels, first page/frame by default, raster jpeg/webp output. revision cache when orientation/color/crop policy changes. [sharp operations][s-ops], [constructor limits][s-constructor], [libvips thumbnail][v-thumb].

| format | baseline mac/windows/linux sharp prebuild |
| --- | --- |
| jpeg/png/webp/tiff/gif/svg input | documented; rasterize svg, never expose as app code |
| avif | documented; bit-depth/platform limits need packaged fixtures/`sharp.format` inspection |
| heic/hevc inside heif | **not guaranteed by default prebuild**; needs libheif with suitable hevc decoder; avif support is not heic support |
| camera raw: cr2/nef/arw/dng | not raw pixel-buffer api; optional libraw/loader or separate converter; not promised by standard prebuild |

sources: [sharp formats][s-install], [heif dependencies][s-heif], [libvips optional loaders][v-install], [heif loader][v-heif], [raw pixel loader][v-raw]. initial app explicitly reports unsupported heic/raw if no tested converter bundled. mac system conversion or separately packaged libvips+libheif/libraw helper are extensions; ente uses sips/mac and vips helpers elsewhere, not proof every camera format works. developer homebrew codec availability does not validate distributable capabilities.

hidden window/worker webcodecs can reuse chromium acceleration, but needs container demux, codec probes, keyframe/pts handling, frame disposal and unsupported-codec fallback. spec exposes codecs, not mp4/mkv demuxer. hidden browser also adds gpu/lifecycle scheduling. prefer native ffmpeg for broad offline cpu ingestion; revisit webcodecs only as measured supported-codec fast path. [webcodecs spec][web-codecs], [chrome guide][web-codecs-guide], hibi hidden host above.

## filesystem scale and offline drives

choose **@parcel/watcher2.6.0**: native backends, batched/coalesced events, snapshots/`getEventsSince`. mac fsevents, linux inotify, windows backend; watchman can improve some setups but is not shipped prerequisite. snapshot is acceleration hint, not exhaustive durable operation journal. errors/overflow/remount trigger reconciliation. [versioned readme][w-parcel].

**chokidar4.0.3** provides normalized add/change/unlink, atomic writes, `awaitWriteFinish`; v4 removed globs and traverses directories to establish watches. latest major is5. **fs.watch recursive works on linux since node19.1**, not only mac/windows; inode/rename/missing filename/network-filesystem caveats remain. [chokidar4][w-chokidar4], [versions](bench-platform/releases.json), [node24 fs][n-fs].

initial scan: async `opendir`/dirents with bounded stat/directory work; cheap extension prefilter then actual type/ffprobe validation. no eager million-file array or stat every entry simultaneously. emit catalog pages early, hash/index later. exclude own cache/trash/unsupported types and symlink loops. watcher before scan, reconcile buffered changes after; bounded queue overflow means rescan. only mark missing after successful full scan of **online** root. [directory/fs api][n-fs], [watcher batching][w-parcel].

paths are locations, content hash identity. same-volume inode/file-id hints may track rename but can be reused and vary by filesystem. full hash reconnects moved/copied files without recomputing embeddings. volume hint plus user root rebinding handles changed drive letters/mount paths. disconnected root becomes offline; retain catalog/thumbs/embeddings and stop retry storms. inaccessible root never means mass deletion. reconnect reconciles snapshot/full scan and resumes jobs. **unverified:** native persistent volume-id acquisition and overflow/remount behavior per os. [node fs caveats][n-fs].

## packaging and offline models

**electron-builder26.15.3**, per-os native ci plus packaged smoke. first targets: mac arm64/x64 separate dmg+zip, windows x64 nsis, linux x64 appimage/deb. optional windows/linux arm64 needs corresponding addon/runtime/tool artifacts and real smoke. napi reduces node-abi rebuild needs but still requires os/arch/libc compatibility. better-sqlite3 fallback must target electron **abi149**, not host node26 abi. [electron native modules][e-native], [builder26 config][b-config], [usearch napi build][u-package], [sharp install][s-install].

```yaml
# electron-builder26.15.3 sketch
appId: dev.viquery.desktop
productName: viquery
files:
  - out/**
  - package.json
asar: true
asarUnpack:
  - node_modules/sharp/**
  - node_modules/@img/**
  - node_modules/onnxruntime-node/bin/**
  - node_modules/usearch/**
  - node_modules/@parcel/watcher*/**
extraResources:
  - from: build/tools/${os}/${arch}
    to: tools
  - from: build/models
    to: models
  - from: build/licenses
    to: licenses
npmRebuild: true
nativeRebuilder: sequential
mac:
  target: [dmg, zip]
  hardenedRuntime: true
  notarize: true
  forceCodeSigning: true
win:
  target: [nsis]
linux:
  target: [AppImage, deb]
```

sketch omits credentials, entitlement filenames and ci arch matrix; confirm `${os}`/`${arch}` match staged directory names. actual tools/models live under `process.resourcesPath`, outside asar. native addon + dylib/so/dll dependencies must travel together. smart unpack helps; explicit sharp/@img unpack matches sharp's instructions. better-sqlite3 fallback adds its build native path to unpack and uses target `electron-builder install-app-deps`/`@electron/rebuild`. [builder contents][b-contents], [sharp electron-builder][s-install], [native modules][e-native].

keep sharp/ort/usearch/watcher external to bundler. use target prebuilds when compatible; don't blanket force source rebuild of every napi module. `npmRebuild: true` permits required target preparation, unlike blindly copied hibi setting. audit installed optional deps so mac doesn't ship linux/windows payloads. ort cpu prebuilds documented for all six os/arch pairs; provider support differs, and python/c-sdk support does not imply node binding parity. [ort node matrix][ort-node], [native rebuild][b-config]. for cpu-only build/install, set `ONNXRUNTIME_NODE_INSTALL=skip` or documented `--onnxruntime-node-install=skip`; onnxruntime-node1.30 postinstall otherwise may fetch extra gpu-provider binaries. cpu baseline uses bundled files, with no install/download script invoked by shipped app. [versioned1.30 readme](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/README.md), [installer](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/script/install.js). versioned readme says cuda11 support removed since1.22; generic provider docs can lag release details.

### measured distribution ingredients

| target | electron44.9 release zip | sharp native + libvips npm packages, unpacked | ort1.30 cpu sdk archive |
| --- | --- | --- | --- |
| mac arm64 | 124.68 mib | 0.28 + 17.40 mib | 40.41 mib |
| mac x64 | 128.36 mib | 0.25 + 19.44 mib | no x64 sdk asset in audited release; node docs still list cpu support |
| windows x64 | 151.28 mib | 18.89 + 18.85 mib | 78.82 mib |
| windows arm64 | 149.37 mib | not sampled | 80.07 mib |
| linux x64 | 117.60 mib | 0.41 + 17.84 mib | 10.78 mib |
| linux arm64 | 118.60 mib | 0.52 + 17.49 mib | 9.79 mib |

source: [assets.json](bench-platform/assets.json), [electron release](https://github.com/electron/electron/releases/tag/v44.9.0), [ort release](https://github.com/microsoft/onnxruntime/releases/tag/v1.30.0). columns differ: electron/sdk **compressed**, sharp full platform packages **unpacked**, with possible overlapping dependencies. not sum of final installed sizes. whole multi-target npm onnxruntime-node1.30 package **287.12 mib unpacked**; usearch **24.06 mib**; better-sqlite3 **26.04 mib** including source. sdk archive is not node binding. **unverified:** selected per-target node-binding bytes, stripped tools, universal app, signed installer and model-inclusive total.

universal mac supported: native-build both slices, merge, include arch-specific addons/runtime/helpers or valid fat binaries. v26 uses `mergeASARs`, `singleArchFiles`, `x64ArchFiles`; v27 docs move these settings. share model files once. ente preserves separate napi/ort arch dirs and selects by `process.arch`; its `mergeASARs: false` is layout-specific. prefer per-arch downloads until universal smoke on both actual architectures passes. [builder26 universal][b-mac], ente config below.

mac: developer id, hardened runtime, electron jit entitlements, all nested native binaries signed, notarized and stapled for offline verification. leave unsigned-library loading/library-validation relaxations off unless demonstrated necessary. windows: authenticode app/installer/tools; reputation separate from certificate, no immediate smartscreen bypass claim. linux: test glibc minimum, appimage/fuse, selected distro packaging. [electron signing][e-sign], [builder signing][b-sign], [notarization][b-notary], [utility unsigned library flag][e-utility].

baseline model weights/tokenizer/config/license ship via `extraResources/models/<model-id>` and load in place, no first-launch copy. optional explicit downloads go `userData/models/<manifest-digest>` with bounded staging, size/sha256 verification, rename. manifest pins shared embedding space, transforms/tokenizer revision, dims/types and licenses. no model hub auto-fetch/update/analytics/remote font during indexing/search. missing model returns explicit unavailable. renderer network denial alone is insufficient: node fetch/ffmpeg also must have no implicit remote path. [builder resources][b-contents], [ort session options][ort-api], ente asset pattern below.

## ente desktop source audit

checkout `research/raw/ente`: shallow+sparse desktop, commit **dd23b36b70aae6a4b63e76fe37ebd7ce87c35c86**, package **1.7.31-beta**, inspected read-only2026-10-17. no install/build/run. desktop pins electron42.10.0, builder26.15.3, chokidar4.0.3, comlink4.4.2. source is evidence of ente's implementation, not framework guarantee. [pinned package](https://github.com/ente-io/ente/blob/dd23b36b70aae6a4b63e76fe37ebd7ce87c35c86/desktop/package.json).

| exact path under `research/raw/ente` | observed implementation |
| --- | --- |
| `desktop/src/main/services/workers.ts:44` | watched utility fork, piped stdout/stderr; separate ml and ffmpeg |
| `desktop/src/main/services/workers.ts:68` | transfer port to child/renderer, pass userData/resolved native paths |
| `desktop/src/preload.ts:198` | wait for page load, forward dom port, remove one-shot listener |
| `desktop/src/main/utils/comlink.ts` | MessagePortMain EventEmitter adapted to comlink |
| `desktop/src/main/services/ml-worker.ts:18`, `:59` | zod init validation, limited comlink methods, rust napi addon + external ort, cached runtime/asset store, text warm-up |
| `desktop/src/main/services/ml-native.ts` | six os/arch triples, packaged `resources/napi` and `resources/onnxruntime/<arch>` |
| `desktop/scripts/ort.js` | **ort1.28.1-r1**, pinned sha256, staging/stamp, both mac arches; coreml mac/webgpu other custom builds |
| `desktop/scripts/ffmpeg.js` | **ffmpeg9.0.2**, archive+executable checksums, target mapping, staged extraction/rename |
| `desktop/electron-builder.yml` | extraFiles staged resources, universal mac, `mergeASARs: false`, `x64ArchFiles: **/{napi,onnxruntime}/**`, excludes ffprobe |
| `desktop/src/main/services/ffmpeg-worker.ts:317` | parse ffmpeg stderr because ffprobe omitted; explicit hevc/hdr proxy handling |
| `desktop/scripts/vips.js` | **libvips8.18.7** checksummed helpers linux/windows; mac uses sips |

**current source differs from older recipe:** no `onnxruntime-node` desktop dependency. rust bindings load separately packaged ort libraries. reuse process isolation, ports, immutable path resolution, checksums/staging, sessions/warm-up; current config is not proof of onnxruntime-node packaging. [workers][ente-workers], [ml][ente-ml], [paths][ente-native], [ort script][ente-ort], [builder][ente-builder].

ml worker creates asset store under `userData/assets`, with legacy `userData/models`. `rust/crates/ml/src/assets.rs` read via `git show` from same shallow commit (outside sparse worktree) defines `https://models.ente.com/<file>`, expected sizes/sha256, staged imports/downloads and model/vocabulary acquisition. warm-up can trigger download; query path races availability against50ms. viquery must change that behavior: baseline model already shipped; only explicit user action downloads extras. [pinned asset catalog](https://github.com/ente-io/ente/blob/dd23b36b70aae6a4b63e76fe37ebd7ce87c35c86/rust/crates/ml/src/assets.rs), [worker][ente-ml].

## verification and remaining gates

completed: official release/npm checks, binary size metadata audit, local mux/hibi reads, read-only ente audit, exact-scan benchmark/reference on host node and existing electron runtime, sqlite/fts smoke. scripts/raw samples in `research/bench-platform`. [check-schema.cjs](bench-platform/check-schema.cjs) passed against document's actual ddl on node26.8.1 and electron44.4.5/node24.21.0, sqlite3.53.4: vector length constraint/log/cascade, fts lookup/delete, unique job key and lease-state constraints. [node result](bench-platform/schema-node-v26.8.1.json), [electron result](bench-platform/schema-electron-44.4.5.json). in-memory check does not exercise wal/files/concurrency/recovery.

unverified before claiming blazing fast or shipping:

1. electron44.9 packaged smoke mac arm64/x64, windows x64, linux x64: modules/fts5/tools/models with network disabled; actual sqlite version/rc-api compatibility/migrations.
2. real 10k/100k/1m ×512/1024 vectors: retrieval p50/p95/p99, cold/warm, recall@20 vs exact, selective filters, rss/index build. total query-to-paint includes tokenizer/text model/ipc/fts; retrieval<100ms is not total search<100ms.
3. four-core x86 simultaneous indexing/query, thread budgets, packaged fresh/retained startup and first gallery scroll; use mux/hibi benchmark methodology.
4. head/range/suffix/abort/empty-file and actual seek fixtures; hevc/av1/vp9/h264, hdr/orientation/audio combinations; sharp heic/avif/raw and thumbnail decode memory.
5. crash during hash/cache/sql/lease/index snapshot and replay; file changes during index, rename/removable-drive disconnect/rebind, watcher overflow and million-file scan.
6. actual audited lgpl ffmpeg9.0.2 artifacts (or explicit gpl distribution decision), notices/source, signatures/stapling and installed/model-inclusive sizes. lgpl tools not built here.

## sources

official framework/runtime/library docs, upstream maintainer repos, standards and primary paper. rolling docs checked2026-10-17; versioned source/releases establish selected versions. local observations/measurements labeled separately.

[e-release]: https://releases.electronjs.org/release/v44.9.0
[e-args]: https://github.com/electron/electron/blob/v44.9.0/build/args/all.gn
[e-ffmpeg-args]: https://github.com/electron/electron/blob/v44.9.0/build/args/ffmpeg.gn
[e-process]: https://github.com/electron/electron/blob/v44.9.0/docs/tutorial/process-model.md
[e-utility]: https://www.electronjs.org/docs/latest/api/utility-process
[e-performance]: https://www.electronjs.org/docs/latest/tutorial/performance
[e-sandbox]: https://www.electronjs.org/docs/latest/tutorial/sandbox
[e-multithreading]: https://www.electronjs.org/docs/latest/tutorial/multithreading
[e-ports]: https://www.electronjs.org/docs/latest/tutorial/message-ports
[e-channel]: https://www.electronjs.org/docs/latest/api/message-channel-main
[e-port]: https://www.electronjs.org/docs/latest/api/message-port-main
[e-bridge]: https://www.electronjs.org/docs/latest/api/context-bridge
[e-isolation]: https://www.electronjs.org/docs/latest/tutorial/context-isolation
[e-security]: https://www.electronjs.org/docs/latest/tutorial/security
[e-ipc]: https://www.electronjs.org/docs/latest/tutorial/ipc
[e-protocol]: https://www.electronjs.org/docs/latest/api/protocol
[e-scheme]: https://www.electronjs.org/docs/latest/api/structures/custom-scheme
[e-app]: https://www.electronjs.org/docs/latest/api/app#appgetpathname
[e-native]: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
[e-sign]: https://www.electronjs.org/docs/latest/tutorial/code-signing
[ev-guide]: https://electron-vite.org/guide/
[ev-deps]: https://electron-vite.org/guide/dev#dependencies-vs-devdependencies
[n-current]: https://nodejs.org/en/blog/release/v26.12.0
[n-lts]: https://nodejs.org/en/blog/release/v24.22.0
[n-sqlite]: https://nodejs.org/download/release/v24.22.0/docs/api/sqlite.html
[n-workers]: https://nodejs.org/download/release/v24.22.0/docs/api/worker_threads.html
[n-fs]: https://nodejs.org/download/release/v24.22.0/docs/api/fs.html
[n-stream]: https://nodejs.org/download/release/v24.22.0/docs/api/stream.html
[n-child]: https://nodejs.org/download/release/v24.22.0/docs/api/child_process.html
[n-crypto]: https://nodejs.org/download/release/v24.22.0/docs/api/crypto.html
[q-releases]: https://www.sqlite.org/changes.html
[q-better]: https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/docs/api.md
[q-libsql-client]: https://github.com/tursodatabase/libsql-client-ts
[q-libsql-vector]: https://docs.turso.tech/features/ai-and-embeddings
[q-fts]: https://www.sqlite.org/fts5.html
[q-wal]: https://www.sqlite.org/wal.html
[q-pragma]: https://www.sqlite.org/pragma.html#pragma_synchronous
[q-backup]: https://www.sqlite.org/backup.html
[q-create]: https://www.sqlite.org/lang_createtable.html
[q-transactions]: https://www.sqlite.org/lang_transaction.html
[q-upsert]: https://www.sqlite.org/lang_upsert.html
[q-auto]: https://www.sqlite.org/autoinc.html
[vec-release]: https://github.com/asg017/sqlite-vec/releases/tag/v0.1.9
[vec-main]: https://github.com/asg017/sqlite-vec/blob/main/VERSION
[vec-ann]: https://github.com/asg017/sqlite-vec/blob/main/benchmarks-ann/README.md
[vec-api]: https://alexgarcia.xyz/sqlite-vec/api-reference.html
[vec-binary]: https://alexgarcia.xyz/sqlite-vec/guides/binary-quant.html
[vec-bench]: https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html
[u-node]: https://github.com/unum-cloud/USearch/blob/v2.26.4/javascript/lib.cpp
[u-sdk]: https://unum-cloud.github.io/USearch/javascript/
[u-readme]: https://github.com/unum-cloud/USearch
[u-package]: https://github.com/unum-cloud/USearch/blob/v2.26.4/package.json
[u-hnsw]: https://github.com/yoshoku/hnswlib-node
[u-lance]: https://docs.lancedb.com/indexing/
[u-lance-filter]: https://docs.lancedb.com/search/filtering/
[u-faiss]: https://github.com/ewfian/faiss-node
[rrf-paper]: https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
[f-download]: https://ffmpeg.org/download.html
[f-legal]: https://ffmpeg.org/legal.html
[f-static]: https://github.com/eugeneware/ffmpeg-static
[f-installer]: https://github.com/kribblo/node-ffmpeg-installer
[f-binaries]: https://github.com/ffbinaries/ffbinaries-node
[f-ente-build]: https://github.com/ente/ffmpeg-packaging/blob/9.0.2/scripts/build-desktop-cli.sh
[f-cli]: https://ffmpeg.org/ffmpeg.html#Advanced-Video-options
[f-all]: https://ffmpeg.org/ffmpeg-all.html
[f-select]: https://ffmpeg.org/ffmpeg-filters.html#select_002c-aselect
[f-scdet]: https://ffmpeg.org/ffmpeg-filters.html#scdet
[f-protocols]: https://ffmpeg.org/ffmpeg-protocols.html#pipe
[f-probe]: https://ffmpeg.org/ffprobe.html
[f-raw]: https://ffmpeg.org/ffmpeg-formats.html#rawvideo
[s-manifest]: https://github.com/lovell/sharp/blob/v0.35.5/package.json
[s-install]: https://sharp.pixelplumbing.com/install/
[s-utility]: https://sharp.pixelplumbing.com/api-utility/
[s-constructor]: https://sharp.pixelplumbing.com/api-constructor/
[s-ops]: https://sharp.pixelplumbing.com/api-operation/
[s-heif]: https://sharp.pixelplumbing.com/api-output/#heif
[v-release]: https://github.com/libvips/libvips/releases/tag/v8.18.7
[v-install]: https://www.libvips.org/install.html
[v-thumb]: https://www.libvips.org/API/current/ctor.Image.thumbnail.html
[v-heif]: https://www.libvips.org/API/current/ctor.Image.heifload.html
[v-raw]: https://www.libvips.org/API/current/ctor.Image.rawload.html
[ort-node]: https://onnxruntime.ai/docs/get-started/with-javascript/node.html
[ort-api]: https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.SessionOptions.html
[ort-threads]: https://onnxruntime.ai/docs/performance/tune-performance/threading.html
[w-parcel]: https://github.com/parcel-bundler/watcher/blob/v2.6.0/README.md
[w-chokidar4]: https://github.com/paulmillr/chokidar/blob/4.0.3/README.md
[hash-xx]: https://github.com/Cyan4973/xxHash
[hash-blake]: https://github.com/BLAKE3-team/BLAKE3
[hash-wasm]: https://github.com/Daninet/hash-wasm
[b-config]: https://www.electron.build/v26/docs/configuration/
[b-contents]: https://www.electron.build/v26/docs/contents/
[b-mac]: https://www.electron.build/v26/docs/mac/
[b-sign]: https://www.electron.build/v26/docs/features/code-signing/
[b-notary]: https://www.electron.build/v26/docs/features/code-signing/notarization
[http-range]: https://www.rfc-editor.org/rfc/rfc9110.html#section-14
[c-codecs]: https://www.chromium.org/audio-video/
[c-options]: https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.167/media/media_options.gni
[c-types]: https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.167/media/base/supported_types.cc
[web-img]: https://html.spec.whatwg.org/multipage/embedded-content.html#attr-img-decoding
[web-contain]: https://drafts.csswg.org/css-contain-2/#content-visibility
[web-bitmap]: https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap
[web-codecs]: https://w3c.github.io/webcodecs/
[web-codecs-guide]: https://developer.chrome.com/docs/web-platform/best-practices/webcodecs
[web-capabilities]: https://www.w3.org/TR/media-capabilities/
[ente-workers]: https://github.com/ente-io/ente/blob/dd23b36b70aae6a4b63e76fe37ebd7ce87c35c86/desktop/src/main/services/workers.ts
[ente-ml]: https://github.com/ente-io/ente/blob/dd23b36b70aae6a4b63e76fe37ebd7ce87c35c86/desktop/src/main/services/ml-worker.ts
[ente-native]: https://github.com/ente-io/ente/blob/dd23b36b70aae6a4b63e76fe37ebd7ce87c35c86/desktop/src/main/services/ml-native.ts
[ente-ort]: https://github.com/ente-io/ente/blob/dd23b36b70aae6a4b63e76fe37ebd7ce87c35c86/desktop/scripts/ort.js
[ente-builder]: https://github.com/ente-io/ente/blob/dd23b36b70aae6a4b63e76fe37ebd7ce87c35c86/desktop/electron-builder.yml
