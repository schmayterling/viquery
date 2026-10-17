# viquery brief

cross-platform (macos, windows, linux) desktop app. local media gallery of images + videos -> searchable semantic library. content stays purely offline: no network at runtime for indexing/search (model files may ship with app or be fetched once by explicit user action).

## search requirements
- images: semantic search by what is happening, objects, scenery, natural language.
- videos: same, plus temporal: find the specific scene/moment (timestamped) by objects, scenery, what happened, natural language.

- speech: transcribe video audio (multilingual; english first) and use timestamped transcript segments as extra search signal mapped onto scenes.

## performance
- must work well cpu-only (baseline dev box: apple m2, 8 cores, 24gb; also assume ~4-core x86 laptop no gpu).
- gpu optional speedup (coreml/metal, directml, cuda, webgpu).
- "blazing fast": instant ui, virtualized gallery, sub-100ms search on 100k items, background indexing that never janks ui.

## principles (load-bearing)
- ground every decision in official language/framework/runtime docs; cite url + version. a claim without source is an observation, not a decision.
- before building anything, check whether it already exists (reference repos, ente/immich/etc, npm packages, local projects ~/Documents/ChatGPT/mux and ~/Documents/ChatGPT/hibi 2).
- pstack-derived principles: model valid states as variants; validate at trust boundaries; isolate before locking (single writer for db); idempotent, resumable indexing jobs (stable ids, readback before retry); measure claims (baseline, workload, runs, spread); deliver verifiable slices.
- smallest working design; no speculative abstraction.

## stack leaning (challenge if docs say otherwise)
electron + electron-vite + typescript, react 19 renderer (matches local project hibi), heavy work off main thread in electron utilityProcess workers, sqlite for metadata, onnx runtime for models, ffmpeg for video decode.

## references
temporal: github.com/bobgsning/FrameScout, github.com/Aseiel/VideoHighlighter
semantic: github.com/traversaal-ai/momentsearch, github.com/sourav4243/sift-video
models (look beyond these): huggingface.co/collections/HuggingFaceTB/smolvlm2, moondream.ai/models, huggingface.co/apple/MobileCLIP-S0, huggingface.co/apple/MobileCLIP-S1

## licensing (decided)
- viquery code: MIT, open source, personal use.
- default models must be redistributable under permissive terms (apache-2.0 / mit / bsd). no research-only weights (e.g. apple mobileclip LICENSE_MODELS) in the default path or bundled in the repo/app.
