# visible text search

measured 2026-10-17 on apple m2 cpu, 24 gib ram, node 26.8.1 and ffmpeg 9.0.1. chosen: `paddleocr@1.2.0` (mit; 1,991,545 bytes unpacked, no dependencies) with pp-ocrv5 mobile detector + recognizer (apache-2.0). supplied `onnxruntime-node@1.30.0` is the existing app runtime. models + upstream dictionary + license total 21,393,497 bytes. parent approved dependency, contracts and schema before implementation.

## candidate measurement

scratch-only install: `/tmp/ocr-eval`. all onnx candidates use the app's ort 1.30 cpu backend, intra-op 2 / inter-op 1 threads, sequential execution. sharp uses one thread. one warmup plus five measured runs per input, candidates run serially. cpu contention varied across other chats; these are shared-machine samples, not isolated throughput guarantees. raw timings and recognized text: [ocr-bench-results.json](ocr-bench-results.json).

fixtures: sharp/svg renders five english lines at 1000×650, three japanese lines at 1000×650, a large single-line card, plus the existing cat photo with no text. english includes `PROJECT AURORA`, `QUARTERLY REVENUE REPORT`, dates/numbers and a sentence; japanese includes `東京都の図書館` and `日本語の文字を検索します`. detector cap 960px for the candidate comparison. times below are median [min–max] ms; decode excluded except for candidates that require an encoded image. cer ignores case and whitespace: missing spaces still harm lexical search even with 0% cer.

| candidate | code / model license; model bytes | english screenshot ms | no-text photo ms | english / japanese cer | integration |
| --- | --- | ---: | ---: | --- | --- |
| paddleocr 1.2.0 | mit / apache-2.0; 21.38mb with comparison dictionary | 583 [544–611] | 26 [26–29] | 0% / 0% | raw pixels, caller-owned ort, no canvas/opencv, no model fetching |
| ppu-paddle-ocr 6.6.1 | mit / apache-2.0; same v5 models | 523 [511–548] | 23 [19–26] | 11.5% / 25.9% | opencv wasm + ppu-ocv/native canvas; missed first line of both cards |
| @gutenye/ocr-node 1.4.9 | mit / apache-2.0; v4 det+rec+dict 15,594,089 bytes | 739 [727–787] | 36 [34–41] | 0% / 33.3% | default bundled v4; opencv/js-clipper; lost english spaces and japanese characters |
| esearch-ocr 8.5.2 | apache-2.0 / apache-2.0; same v5 models | 985 [952–1041] | 96 [73–119] | 0% / 0% | supplied ort, requires canvas/ImageData adapter on node |
| raw v5 on ort 1.30 | app code / apache-2.0; same v5 models | 529 [486–588] | 28 [25–31] | 0% / 0% | 54-line scratch axis-aligned component/unclip/ctc prototype; perspective/rotated box work remains |
| tesseract.js 7.0.0 | apache-2.0 / apache-2.0; eng+jpn compressed 3,519,744 bytes | 186 [182–197] | 105 [102–107] | 0% / 0% | separate wasm engine; core package 45.3mb unpacked across variants; emitted false text on photo |

paddleocr chosen for exact fixture text, small integration, detector-only empty-image inference and one runtime. tesseract is faster on the clean screenshot/card; its extra engine and empty-photo false positives lose this comparison. raw onnx is similar in speed but would make viquery own geometry/cropping code. no production accuracy claim follows from three generated cards.

the comparison mirror dictionary contained an extra empty line that shifts ctc ids in libraries expecting upstream character order. paddleocr, esearch and raw use the upstream dictionary; ppu uses its expected mirror dictionary. shipping pins use the upstream dictionary at immutable commit `a38c087bcb2579f9ccc2068aea02ec893b1c2311`, append the required space character and let paddleocr handle ctc blank indexing.

## resolution and keyframe experiment

generated 10-minute h264 video: 1920×1080, 2fps, gop 20 frames / 10s; 36px burned-in caption on a contrasting rectangle. five seeks near 137.4, 297.4, 487.4, 598 and 297.4 seconds. `-ss t -noaccurate_seek -copyts`, one frame, 1280px scale, png pipe: 66.9ms median [61.7–74.5]. decoded pts were 130, 290, 480, 590 and 290 seconds. cost does not grow with elapsed video time in this workload.

320px caption read only `E`, 44.2ms median [42.4–52.4]. 1280px read `Emergency evacuation route: use the northern exit` exactly, 280.2ms [269.7–348.6]. this is why ocr does not reuse 320px visual thumbnails.

shipping pipeline uses `-copyts -start_at_zero`, stores the first decoded frame's pts and deduplicates repeated keyframes per job. ocr hits map to the containing scene and save a 320px thumbnail at the actual seek time. ponytail ceiling: text changing between keyframes can be missed. upgrade to accurate seek when a keyframe is more than one scene window before its sample; no claim of frame-complete subtitle coverage.

## shipping pipeline costs

measured through `createComputeApi().ocr` with runtime fetch forbidden, final 1600px image cap / 1280px keyframes, shared minilm, all preprocessing/decoding and output thumbnails included. one warmup + five runs, 2 ort threads, low process priority. separate run from candidate comparison, so timings reflect different machine contention and resize shapes.

| input | median [min–max] | output |
| --- | ---: | --- |
| five-line 1000×650 screenshot | 288.2ms [277.5–302.4] | five exact text lines + sentence vectors |
| no-text cat photo | 17.8ms [17.1–19.0] | no spans, detector only |
| original 1080p caption image | 357.0ms [351.6–651.1] | exact caption + sentence vector |
| one video minute, 18 sample seeks / 6 unique 1280px keyframes | 2.301s [2.246–2.377] | six timed captions; repeated text embeds once |

cold first screenshot call: 491.4ms, one observation including ocr/minilm loading. video figure measures the first minute of the long source with six 10s windows and 20/50/80% sample positions; excludes the separate visual/scene pass, includes ocr seeks, inference, minilm and matched-frame thumbnail output. it is a workload-specific per-video-minute measurement, not an estimate for arbitrary shot density. blank detections skip recognition, sentence encoding and thumbnail output.

## coverage and verification

default model reads english, simplified/traditional chinese and japanese; only english and japanese tested here. other scripts need a different recognizer + dictionary, not a runtime change. minilm stays english-first: recognizing non-latin text does not promise multilingual semantic retrieval. unicode61 lexical matching retains the existing tokenization limitations for unsegmented cjk substrings.

one focused generated fixture indexes an image plus an eight-second video whose text appears at 4s, queries global search and searchVideo, and verifies snippet, decoded 4s seek, second-half scene markers and live catalog refresh with fetch disabled. existing catalog test only gains the required empty ocr stub; smoke count changes from 19 to 27 jobs.

passed in worktree: `npm run typecheck`, `npm run lint`, `npm test` (6/6), `npm run build`, `npx electron tests/fixtures/core-smoke.mjs` (27 jobs). linux/windows packaging and a real multilingual/rotated-document corpus remain unmeasured.

sources: [paddleocr runtime](https://github.com/X3ZvaWQ/paddleocr.js), [ppu](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr), [gutenye](https://github.com/gutenye/ocr), [esearch](https://github.com/xushengfeng/eSearch-OCR), [tesseract](https://github.com/naptha/tesseract.js), [v5 mobile recognition and license](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec), [v5 mobile detection and license](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det), [pinned onnx mirror](https://huggingface.co/snowfluke/ppu-paddle-ocr-models/tree/bf1d5edb0335d3262be7caf13f766ba274b4cadd), [ffmpeg seeking](https://ffmpeg.org/ffmpeg.html#Main-options), [ort thread options](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.SessionOptions.html).
