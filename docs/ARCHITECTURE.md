# viquery architecture

binding design for v1. evidence lives in research/: prior-art.md (pipelines, licenses), models.md (model picks, measured cpu latency, preprocessing), platform.md (electron, storage, packaging), design.md (ui). when this file and research disagree, this file wins; change it deliberately.

## goals

- offline: media bytes, thumbnails, vectors, transcripts never leave the device. no runtime network. models are provisioned at build/dev time (`npm run models`) and loaded with remote fetch disabled.
- cpu-first: default models run well on 4 cpu cores; gpu execution providers are opportunistic.
- fast: ui never waits on indexing. gallery opens from the db alone; search p95 < 100ms at 100k vectors on m2, including text encoding, fusion and ipc.

## processes

```
renderer (react, sandboxed) ──preload rpc──┬── MessagePort ──> catalog utility   (single db writer)
        │                                  └── MessagePort ──> search utility    (read-only db, vectors in memory, text encoders)
        │ ipc invoke (dialogs, reveal, appInfo)
main (thin: window, menu, vq:// protocol, dialogs, spawns utilities, brokers ports)
        catalog ──rpc──> compute utility  (low priority: ffprobe/ffmpeg, sharp, onnx image/asr/sentence models)
        catalog ──event──> search          (CatalogChange after each committed batch)
```

- main never touches media decoding or models. it owns: BrowserWindow, `vq://` protocol, native dialogs, `shell.showItemInFolder`, spawning the three utilities with `utilityProcess.fork`, and handing MessagePorts (`MessageChannelMain`) to renderer, catalog, search, compute. it keeps one read-only `node:sqlite` connection only to resolve `vq://media/<id>` to a path.
- catalog: owns the db (only writer, WAL). folders, scanning, watching, hashing, job queue, writing compute results, library listing for the renderer, index progress events.
- compute: stateless worker. runs at lowered os priority (`os.setPriority`), onnx intra-op threads 2. writes image files (thumbs, sprites, frames) directly to the data dir; returns metadata/vectors/text to catalog. never writes the db.
- search: read-only db connection + in-memory contiguous Float32Array of current-generation clip vectors and transcript sentence vectors. loads clip text and sentence encoders once at start. separate process so indexing load never queues queries.

the shared contracts are code, not prose: `src/shared/api.ts` (renderer api + vq:// urls), `src/shared/protocol.ts` (compute rpc, generations, catalog->search change event), `src/shared/rpc.ts` (transport), `src/shared/paths.ts` (data dir layout).

## data dir

`<userData>/library/`: `viquery.db`, `thumbs/xx/<mediaId>.webp`, `sprites/xx/<mediaId>.webp`, `frames/xx/<mediaId>/<ms>.webp`. paths are deterministic from ids (`src/shared/paths.ts`) so the protocol handler needs no db lookup except for originals.

## identity and jobs

- media identity = sha256 of full file content. a media row can have many file aliases (paths); renames/moves keep vectors.
- media rows without aliases remain stored but hidden from library/search; garbage collection is a separate explicit slice.
- scan: stat-gated. unchanged (path, size, mtime) skips hashing. changed or new file -> hash -> upsert media -> alias.
- stages per media, each a row in `job`: `thumb` (probe + thumbnail + video sprite) -> `visual` (scenes + frame embeddings) -> `ocr` (visible text) -> `speech` (videos with audio). scheduling order matches the ui phases: all thumbs first, then images visual, then videos visual, then text, then speech. ocr requires the current visual job to finish; replacing visual rows invalidates that media's ocr rows and job.
- jobs are idempotent: results are written in one transaction that replaces that media's rows for that stage+generation. on startup `running` resets to `pending`. failures record error + attempts; three attempts then `failed` (visible; retried only when one of its files changes or its folder is added again, never by routine reconciliation).
- generations (`GENERATION` in protocol.ts) version model + preprocessing + segmentation. search loads only current-generation rows; catalog re-enqueues stale ones.

## schema (catalog owns migrations; `PRAGMA user_version`)

```sql
create table folder (
  id integer primary key,
  path text not null unique,
  added_at integer not null
);

create table media (
  id integer primary key,
  sha256 blob not null unique,
  kind integer not null,            -- 0 image, 1 video
  width integer not null,           -- after orientation
  height integer not null,
  duration_ms integer,              -- videos
  has_audio integer not null,       -- 0/1; speech stage only when 1
  taken_at integer not null,        -- exif/container time, else file mtime (epoch ms)
  added_at integer not null,        -- first indexed (epoch ms); scope 'recent' = last 30 days
  bytes integer not null,
  codec text,
  sprite text                       -- json Sprite, null until generated
);
create index media_taken on media(taken_at desc);

create table file (                 -- path aliases
  id integer primary key,
  path text not null unique,
  folder_id integer not null references folder(id) on delete cascade,
  media_id integer references media(id),
  name text not null,
  size integer not null,
  mtime_ms integer not null
);
create index file_media on file(media_id);
create index file_folder on file(folder_id);

create table job (
  media_id integer not null references media(id) on delete cascade,
  stage text not null,              -- 'thumb' | 'visual' | 'ocr' | 'speech'
  generation integer not null,
  state text not null,              -- 'pending' | 'running' | 'done' | 'failed'
  attempts integer not null default 0,
  error text,
  primary key (media_id, stage)
) without rowid;
create index job_pending on job(state, stage);

create table scene (                -- video time windows: shots split to <= 10s
  id integer primary key,
  media_id integer not null references media(id) on delete cascade,
  generation integer not null,
  start_ms integer not null,
  end_ms integer not null
);
create index scene_media on scene(media_id, start_ms);

create table sample (               -- one embedded frame (images: one per media)
  id integer primary key,
  media_id integer not null references media(id) on delete cascade,
  scene_id integer references scene(id) on delete cascade,
  generation integer not null,
  t_ms integer,
  embedding blob not null           -- float32 l2-normalized
);
create index sample_media on sample(media_id);

create table transcript (
  id integer primary key,
  media_id integer not null references media(id) on delete cascade,
  generation integer not null,
  start_ms integer not null,
  end_ms integer not null,
  language text not null,
  text text not null,
  embedding blob not null           -- float32 l2-normalized sentence vector
);
create index transcript_media on transcript(media_id, start_ms);

create table ocr (
  id integer primary key,
  media_id integer not null references media(id) on delete cascade,
  generation integer not null,
  t_ms integer,                     -- null for images; decoded frame pts for videos
  text text not null,
  embedding blob not null           -- float32 l2-normalized sentence vector
);
create index ocr_media on ocr(media_id, t_ms);

create virtual table ocr_fts using fts5(
  text, content='ocr', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
create virtual table transcript_fts using fts5(
  text, content='transcript', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
create virtual table file_fts using fts5(
  name, content='file', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
-- plus the standard external-content sync triggers from https://sqlite.org/fts5.html#external_content_tables
```

## indexing pipeline (compute)

- images: decode with sharp (exif orientation applied) -> thumbnail webp (long edge 512) -> model preprocessing -> one clip vector. formats sharp cannot decode (e.g. hevc heic) fall back to ffmpeg decode; if that fails the job fails visibly.
- videos: ffprobe -> poster thumb + sprite sheet (frames at ~2% steps) -> scene detection with ffmpeg `select='gt(scene,0.3)'` on a <=384px analysis stream, cuts < 0.5s merged -> shots split into <= 10s windows -> samples: midpoint for windows <= 2s, else 20/50/80% -> frames decoded at sample pts, saved as webp (long edge 320) and embedded. timestamps come from decoded pts, never frame index.
- ocr: sharp original images at <=1600px long edge; videos input-seek near visual sample times with ffmpeg `-ss t -noaccurate_seek -copyts -start_at_zero`, decode one <=1280px keyframe per seek, never a full decode pass. pp-ocrv5 mobile detection -> recognition only for detected boxes -> minilm per text line. repeated decoded pts are recognized once; repeated text within a job reuses its sentence embedding. spans keep decoded frame pts, mapping to its containing scene, and matched keyframes get 320px thumbnail files. between-keyframe text changes can be missed; accurate seek when a keyframe lies more than one scene window away is the upgrade path. own generation and resumable catalog job; schema migration 2. see research/ocr.md for license, accuracy and cpu costs.
- speech: ffmpeg -> 16khz mono f32 pcm piped (no temp files) in <= 5 min windows over the audio stream's own extent (window ends early at speech crossing its edge) -> whisper (english default) with timestamps, silence skipped -> segments embedded with the sentence model.
- details, thresholds and model ids: research/prior-art.md "recommended viquery pipeline" and research/models.md.

## search (search utility)

1. parse query + filter. 2. clip text vector -> exact dot-product scan over current sample vectors (filtered by scope/kind/date via per-media metadata held in memory) -> top 200 samples. 3. fts5 bm25 over transcript + ocr + file names (query escaped as data) -> top 200. 4. sentence vector -> exact scan over transcript and ocr sentence vectors -> top 200 in one branch. 5. canonicalize each branch to targets (image media, or video scene; transcript segments map to overlapping scenes; ocr points map to the containing scene); one vote per target per branch. 6. reciprocal rank fusion, k = 60. 7. group video targets by media, merge adjacent matched scenes with gap < 2s, keep best sample time as seekMs. returns `SearchResult`.
- exact scan first (measured ~50ms for 100k x 512 f32 in one js thread on m2). add an ann index only when measured p95 misses the budget at real vector counts, keeping exact rerank.
- natural-language branches gate before fusion: clip cosine >= max(0.20, best in query scope - 0.08), sentence cosine >= 0.45; fts votes require actual term hits. calibrated on the default model pack against the 10x10 named image/query matrix + eight abstract queries (`src/search/bench-calibration.ts`), and `launch.mp4` + generated testsrc2/tone/silence distractors in core-smoke. merged moments span at most 30s; speech matches seek to the segment start; ocr matches seek to the decoded frame and return its text as the snippet.
- `searchVideo(id, query)`: scan only that media's vector slots, pool max per scene, map transcript overlaps and ocr frame points. a lazy, single-video in-memory fts index keeps bm25 statistics local; catalog changes invalidate it. the same cutoff helper uses a stricter 0.006 clip band for timeline markers, and global moment spans keep only visual-only scenes that also pass it (the wide band only decides which videos are results); sum cosine excess above the soft floors + relative bm25, then normalize by the strongest scene for continuous scene heat in time order, including zero-heat unmatched scenes. speech-only markers seek to scene start; ocr markers seek to decoded frame pts; missing/unindexed videos return `[]`.
- `similar(id)`: same scan with the media's own vector(s) as query; text-image relevance floors do not apply to image-image similarity.

## renderer

react 19, design per research/design.md (search field centered in the topbar). columnar `LibraryIndex` -> justified layout -> virtualized rows; thumbnails via `vq://` with fixed aspect boxes. no media bytes over ipc.

## models (default pack, all permissive)

see research/models.md for exact ids, files, sha256, preprocessing. default: openai clip vit-b/32 via `Xenova/clip-vit-base-patch32` (mit; measured ~20ms/image int8, 2 threads, m2) image + text; whisper base.en q8 (mit); all-minilm-l6-v2 (apache-2.0); pp-ocrv5 mobile det/rec (apache-2.0, english + simplified/traditional chinese + japanese; 21.4mb with dictionary/license). ocr uses mit paddleocr 1.2.0 with the existing runtime; minilm semantic quality remains english-first. runtime: @huggingface/transformers on onnxruntime-node (cpu; coreml/dml/cuda opportunistic), with `env.allowRemoteModels = false`. multilingual pack (whisper base + multilingual-e5-small) is a later opt-in.

## packaging (later slice)

electron-builder; models and lgpl ffmpeg/ffprobe builds as extraResources; native deps (sharp, onnxruntime-node) asarUnpack. dev resolves ffmpeg from `resources/bin` else PATH. cpu-only release builds set `ONNXRUNTIME_NODE_INSTALL=skip` so onnxruntime-node's postinstall skips cuda downloads on linux (js/node/script/install.js @ v1.30.0); a project `.npmrc` key works but npm 11 warns on every command.

## verification

- `npm run check`: biome, tsc, node --test.
- one end-to-end fixture test: index a tiny folder (2 images, 1 short video with speech) through catalog+compute, then query search and assert the expected item/moment ranks first.
- `npm run bench:search`: 100k synthetic vectors, p50/p95 over 50 queries.
