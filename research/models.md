# models and inference runtime

researched 2026-10-17 against [brief](BRIEF.md), including required english-first speech and permissive weights. all recommended tiers use MIT / Apache-2.0 weights. no apple weights downloaded; no application changes or commit.

“measured” means this machine ran it. “verified” means inspected source/artifact. unknown is not zero. artifact sizes use decimal mb; mib only where upstream explicitly uses it. published accuracy normally uses full precision; it is not a converted/quantized accuracy guarantee.

## recommendation

| role | concrete choice | rationale / complete download / license |
| --- | --- | --- |
| default image/scene search | OpenAI CLIP ViT-B/32, Xenova separate int8 ONNX towers | measured ~20 ms/image, ~16 ms/query at two cpu threads; 512-d; **156.34 mb** with downloaded assets. **MIT License**, copyright OpenAI 2021. [license](https://github.com/openai/CLIP/blob/main/LICENSE), [conversion](https://huggingface.co/Xenova/clip-vit-base-patch32) |
| optional image quality + multilingual | google/siglip2-base-patch16-224, onnx-community int8 | stronger published retrieval, 768-d; **412.40 mb** including 34.4 mb tokenizer assets. **Apache License, Version 2.0**. [publisher](https://huggingface.co/google/siglip2-base-patch16-224), [conversion](https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX) |
| phase 1 speech | onnx-community/whisper-base.en q8 | measured cpu RTF .080 at two threads; **81.14 mb** with assets; timestamped ASR verified in utilityProcess. upstream **MIT License**. [upstream/license](https://github.com/openai/whisper#license), [conversion](https://huggingface.co/onnx-community/whisper-base.en) |
| default transcript text search | all-MiniLM-L6-v2 q8 | ~24 mb with tokenizer, 384-d; short english transcript/caption segments. **Apache License, Version 2.0**. [publisher](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), [conversion](https://huggingface.co/Xenova/all-MiniLM-L6-v2) |
| phase 2 multilingual speech | multilingual Whisper base-q5_1 + packaged cpu-only whisper.cpp v1.9.5 child hosted by utilityProcess | supports actual language detection; weights/runtime **MIT License**; base-q5_1 **57 mib**, optional small-q5_1 **181 mib**. native binary size unmeasured. [weights](https://huggingface.co/ggerganov/whisper.cpp), [pinned CLI](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/cli/cli.cpp) |
| phase 2 multilingual text | multilingual-e5-small q8, replacement text pack | **MIT License**, 384-d, 100 languages; **135–140 mb** with tokenizer. explicit activation, rebuild text index then switch. [publisher](https://huggingface.co/intfloat/multilingual-e5-small), [conversion](https://huggingface.co/Xenova/multilingual-e5-small) |
| optional captions | Florence-2-base-ft ONNX | 0.23b, **MIT License**; bounded captions on selected keyframes. off by default on cpu. SmolVLM2-500M-Video-Instruct, **Apache License, Version 2.0**, alternative for multi-frame prompts. [florence](https://huggingface.co/microsoft/Florence-2-base-ft), [smolvlm2](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct) |

image + english speech + english text packs total **~262 mb**, excluding electron, native runtime, ffmpeg, VAD, indexes, thumbnails. MiniLM/VAD/captioning/multilingual paths were not benchmarked. this is engineering selection from measured image/ASR speed and published quality, not a claim of universal best retrieval.

runtime: **onnxruntime-node 1.30.0**, **@huggingface/transformers 4.3.1** for tokenizer/image/audio processing and whisper generation. long-lived utilityProcess sessions, one indexing job at a time, initially two intra-op threads. record model/revision/precision/preprocessing fingerprint with each index. changing CLIP to SigLIP2 needs new image index; text embeddings occupy separate space. [node API](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.SessionOptions.html), [v4.3.1 dependencies](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/package.json)

CLIP finds objects, settings, and visible actions in timestamped frames. single frame does not establish event order/cause. optional multi-frame captions add richer signal. sub-100 ms over 100k items still needs vector/fts benchmark; encoder measurements do not establish whole-search target.

## image/text models and published quality

all metrics percent; retrieval pair is **text→image / image→text**. R@1 and R@5 differ. prompt ensembles, preprocessing and test splits differ across sources; compare only within stated protocol. cpu feasibility assumes available graph kernels, not GPU performance quoted in papers.

apple params are image + text, millions; all english-focused, no verified multilingual claim. sources: [official table](https://github.com/apple/ml-mobileclip#evaluation), [paper table 3](https://arxiv.org/html/2508.20691v1), [per-model configs](https://huggingface.co/apple/MobileCLIP2-S0/blob/main/config.json).

| checkpoint | params m | dim / px | ImageNet top1 | coco R@1 | flickr30k R@1 |
| --- | --- | --- | ---: | --- | --- |
| MobileCLIP-S0 | 11.4 + 42.4 | 512 / 256 | 67.8 | 40.4 / 58.7 | 67.7 / 85.9 |
| MobileCLIP-S1 | 21.5 + 63.4 | 512 / 256 | 72.6 | 44.0 / 62.2 | 71.0 / 89.2 |
| MobileCLIP-S2 | 35.7 + 63.4 | 512 / 256 | 74.4 | 45.4 / 63.4 | 73.4 / 90.3 |
| MobileCLIP-B | 86.3 + 63.4 | 512 / 224 | 76.8 | 50.6 / 68.8 | 77.3 / 91.4 |
| MobileCLIP-B-LT | same | 512 / 224 | 77.2 | 50.0 / 68.7 | 76.9 / 92.3 |
| MobileCLIP2-S0 | 11.4 + 63.4 | 512 / 256 | 71.5 | 43.7 / 62.7 | 69.2 / 86.6 |
| MobileCLIP2-S2 | 35.7 + 63.4 | 512 / 256 | 77.2 | 48.8 / 66.7 | 74.8 / 90.4 |
| MobileCLIP2-B | 86.3 + 63.4 | 512 / 224 | 79.4 | 49.9 / 67.5 | 76.5 / 89.7 |
| MobileCLIP2-S3 | 125.1 + 123.6 | 768 / 256 | 80.7 | 50.9 / 68.4 | 77.3 / 91.6 |
| MobileCLIP2-L-14 | 304.3 + 123.6 | 768 / 224 | 81.9 | 51.6 / 69.0 | 77.2 / 92.0 |
| MobileCLIP2-S4 | 321.6 + 123.6 | 768 / 256 | 81.9 | 51.5 / 69.3 | 78.0 / 92.4 |

MobileCLIP2 released sizes are S0/S2/B/S3/L-14/S4; no official S1 in release list. **all apple rows excluded from recommended tiers.** exact weight terms: **Apple Machine Learning Research Model License Agreement**, HF apple-amlr. code's MIT does not license weights. research grant covers non-commercial scientific/academic activity and expressly excludes product development and commercial products/services. redistribution remains research-limited, with agreement/attribution and identifying derivatives. ONNX conversion or opt-in download does not widen rights. original and v2 S0 license files checked; full exact text saved under raw/licenses. [controlling terms](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS), [original HF](https://huggingface.co/apple/MobileCLIP-S0/blob/main/LICENSE), [v2 HF](https://huggingface.co/apple/MobileCLIP2-S0/blob/main/LICENSE)

google metrics use SigLIP2 paper table 1, including its original-SigLIP re-evaluation. totals include text vocabulary: base/224 **203,155,970** vs **375,187,970**; so400m/384 **877,960,498** vs **1,136,008,498** from HF tensor metadata. all **Apache License, Version 2.0**. standard original SigLIP is english-focused; SigLIP2 is multilingual. [paper](https://arxiv.org/html/2502.14786v1), [SigLIP card](https://huggingface.co/google/siglip-base-patch16-224), [SigLIP2 card](https://huggingface.co/google/siglip2-base-patch16-224)

| checkpoint | total params m | dim / px | ImageNet | coco R@1 | flickr R@1 |
| --- | --- | --- | ---: | --- | --- |
| SigLIP base-patch16-224 | 203.2 | 768 / 224 | 76.2 | 47.2 / 64.5 | 77.9 / 89.6 |
| SigLIP base-patch16-256 | ~203.2 | 768 / 256 | 76.7 | 47.4 / 65.1 | 78.3 / 91.1 |
| SigLIP so400m-patch14-384 | 878.0 | 1152 / 384 | 83.2 | 52.0 / 70.2 | 80.5 / 93.5 |
| SigLIP2 base-patch16-224 | 375.2 | 768 / 224 | 78.2 | 52.1 / 68.9 | 80.7 / 93.0 |
| SigLIP2 base-patch16-256 | ~375.2 | 768 / 256 | 79.1 | 53.2 / 69.7 | 81.7 / 94.4 |
| SigLIP2 so400m-patch14-224 | ~1135.5 | 1152 / 224 | 83.2 | 55.1 / 71.5 | 84.3 / 94.6 |
| SigLIP2 so400m-patch14-384 | 1136.0 | 1152 / 384 | 84.1 | 55.8 / 71.7 | 85.7 / 94.9 |

additional SigLIP2 B/32-256: ~377m, 768-d, multilingual; ImageNet 74.0, coco 47.2/63.7, flickr 75.5/89.3 R@1 in same paper. immich exports it; ready q8 package not validated here. lower image token count may help cpu, but multilingual text tower still dominates download. so400m is not compact cpu tier.

| other checkpoint | params / dim / px | published quality | language / exact weight license |
| --- | --- | --- | --- |
| OpenAI CLIP ViT-B/32 | ~151.3m / 512 / 224 | ImageNet 63.3; coco 30.4/50.1, flickr 58.8/78.9 R@1 | english; **MIT License**. [upstream](https://github.com/openai/CLIP), [comparison](https://arxiv.org/html/2508.20691v1) |
| OpenCLIP B/32 laion2b_s34b_b79k | ~151.3m / 512 / 224 | ImageNet 65.7; coco 39.1/56.2, flickr 66.4/84.4 R@1 | english; **MIT License**. [card](https://huggingface.co/laion/CLIP-ViT-B-32-laion2B-s34B-b79K) |
| OpenCLIP B/32 DataComp XL s13b_b90k | ~151.3m / 512 / 224 | ImageNet 69.2; coco 37.1/53.5, flickr 61.1/79.0 R@1 | english; **MIT License**. [card](https://huggingface.co/laion/CLIP-ViT-B-32-DataComp.XL-s13B-b90K) |
| OpenCLIP B/32-256 DataComp | ~151m / 512 / 256 | ImageNet 72.8; coco 39.9/57.9, flickr 64.9/84.8 R@1 | english; **MIT License**; pin exact training variant. [checkpoint/card](https://huggingface.co/laion/CLIP-ViT-B-32-256x256-DataComp-s34B-b86K), [official results](https://github.com/mlfoundations/open_clip/blob/main/docs/openclip_results.csv) |
| TinyCLIP ViT-8M/16 Text-3M | **23.45m actual total**, nickname excludes embeddings / 512 / 224 | ImageNet 41.1; exact coco/flickr not verified | english; **MIT License**. [card](https://huggingface.co/wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M), [tensor metadata](https://huggingface.co/api/models/wkcn/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M) |
| TinyCLIP ViT-40M/32 Text-19M | **84.21m actual total** (~39.7 image + 44.5 text) / 512 / 224 | ImageNet 59.8; coco 33.5/48.7, flickr 59.1/76.1 R@1 | english; **MIT License**. [card](https://huggingface.co/wkcn/TinyCLIP-ViT-40M-32-Text-19M-LAION400M), [official zoo](https://github.com/wkcn/TinyCLIP), [comparison](https://arxiv.org/html/2508.20691v1) |
| TinyCLIP ViT-39M/16 Text-19M | ~83m actual total / 512 / 224 | ImageNet 63.5; exact retrieval not verified | english; **MIT License**. [publisher zoo](https://github.com/wkcn/TinyCLIP) |
| nomic-embed-vision-v1.5 + nomic-embed-text-v1.5 | 92.95m vision + ~136.7m text / 768 / 224 | ImageNet 71.0; T→I R@5 coco 56.21, flickr30k 77.98 | english; both **Apache License, Version 2.0**; published shared image/text space; search_query prefix for queries. [card](https://huggingface.co/nomic-ai/nomic-embed-vision-v1.5), [report](https://arxiv.org/html/2406.18587v1) |
| jina-clip-v2 | 865.28m (561m text +304m vision) / 1024→64 / 512 | coco R@5 68.35/81.46, flickr R@5 89.84/98.00; ImageNet not verified | 89 languages; **Creative Commons Attribution-NonCommercial 4.0 International**. excluded; commercial download needs separate agreement. [card/license](https://huggingface.co/jinaai/jina-clip-v2), [paper appendix](https://arxiv.org/html/2412.08802v2) |

small 2025–2026 candidates beyond requested families:

| model | params / dim / px | quality / disposition |
| --- | --- | --- |
| PE-Core-T16-384 | publisher rounded ~10m vision +40m text; exact full total unverified /512/384 | ImageNet 62.1; coco T→I R@1 33.0. **Apache License, Version 2.0**. original pt 278.28 mb; no ready T-size ONNX found in audited converter organizations. [official results](https://github.com/facebookresearch/perception_models/blob/main/apps/pe/README.md), [artifact](https://huggingface.co/facebook/PE-Core-T16-384) |
| PE-Core-S16-384 | publisher ~20m+40m, exact total unverified /512/384; 32 text tokens | ImageNet 72.7; coco T→I R@1 42.6. **Apache License, Version 2.0**. 384px attention/export work still needs measurement; source says width384, overriding README394 typo. [config](https://github.com/facebookresearch/perception_models/blob/main/core/vision_encoder/config.py), [card](https://huggingface.co/facebook/PE-Core-S16-384) |
| PE-Core-B16-224 | publisher ~90m+310m, export count larger /1024/224 | ImageNet 78.4; coco T→I R@1 50.9. **Apache License, Version 2.0**. ready ONNX, not smaller than tested SigLIP packs. [publisher](https://huggingface.co/facebook/PE-Core-B16-224), [ONNX](https://huggingface.co/onnx-community/PE-Core-B16-224-ONNX) |
| ACED-F0/F1/F2, CVPR2025 | ~22.7+28.8 /86.2+28.8 /86.2+28.8m; 256px; dimensions/exact deployable licenses unverified | ImageNet 68.5/74.9/76.9; F0 coco/flickr T→I R@1 41.2/71.4 in comparison. suitable redistributable pinned ONNX not established; excluded pending facts. [original paper](https://openaccess.thecvf.com/content/CVPR2025/html/Udandarao_Active_Data_Curation_Effectively_Distills_Large-Scale_Multimodal_Models_CVPR_2025_paper.html), [comparison](https://arxiv.org/html/2508.20691v1) |

PE tiny/small are real recent options. parameter count alone establishes neither cpu speed nor package size. no verified 2026 compact CLIP-style checkpoint with an already measured superior tradeoff replaced default here.

## ONNX exports and sizes

raw/hub-catalog.json and raw/export-audit.json retain HF file metadata/revisions. V/T = separate vision/text files; numbers mb. fp16 does not imply fast cpu execution. external data must be included.

| export | fp32 V/T | fp16 V/T | int8 V/T | q4 V/T |
| --- | --- | --- | --- | --- |
| [Xenova/mobileclip_s0](https://huggingface.co/Xenova/mobileclip_s0/tree/main/onnx), research-only |45.54/169.81|22.88/84.97|11.85/42.80|36.70/126.46|
| [Xenova/mobileclip_s1](https://huggingface.co/Xenova/mobileclip_s1/tree/main/onnx), research-only |86.05/253.89|43.21/127.12|22.36/64.12|70.12/125.61|
| [Xenova/mobileclip_s2](https://huggingface.co/Xenova/mobileclip_s2/tree/main/onnx), research-only |143.02/253.89|71.71/127.12|36.74/64.12|118.69/125.61|
| [Xenova/mobileclip_b](https://huggingface.co/Xenova/mobileclip_b/tree/main/onnx), also blt, research-only |345.59/253.90|172.96/127.13|87.51/64.13|57.62/125.62|
| [Xenova/clip-vit-base-patch32](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/main/onnx) |351.69/254.06|176.08/127.34|88.65/64.07|63.64/125.74|
| [Xenova/siglip-base-patch16-224](https://huggingface.co/Xenova/siglip-base-patch16-224/tree/main/onnx) |371.82/441.33|186.14/220.87|94.10/110.98|63.26/154.69|
| [Xenova/siglip-base-patch16-256](https://huggingface.co/Xenova/siglip-base-patch16-256/tree/main/onnx) |372.00/441.33|186.24/220.87|94.28/110.98|63.45/154.69|
| [onnx-community/siglip2-base-patch16-224-ONNX](https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/tree/main/onnx) |371.81/1129.47|186.04/564.86|94.55/283.44|63.27/842.83|
| [onnx-community/siglip2-base-patch16-256-ONNX](https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX/tree/main/onnx) |371.99/1129.47|186.13/564.86|94.74/283.44|63.45/842.83|
| [onnx-community/siglip2-so400m-patch14-384-ONNX](https://huggingface.co/onnx-community/siglip2-so400m-patch14-384-ONNX/tree/main/onnx) |1713.49/2831.73 with text data|857.03/1416.14|434.20/711.13|279.56/1444.67|
| [onnx-community/PE-Core-B16-224-ONNX](https://huggingface.co/onnx-community/PE-Core-B16-224-ONNX/tree/main/onnx) |372.79/1416.36|186.57/708.39|94.46/355.60|63.58/478.55|

| combined/single graph | fp32 | fp16 | int8 | q4 |
| --- | ---: | ---: | ---: | ---: |
| [TinyCLIP8M/16+3M](https://huggingface.co/onnx-community/TinyCLIP-ViT-8M-16-Text-3M-YFCC15M-ONNX/tree/main/onnx) |94.07|47.18|24.28|58.69|
| [TinyCLIP40M/32+19M](https://huggingface.co/onnx-community/TinyCLIP-ViT-40M-32-Text-19M-LAION400M-ONNX/tree/main/onnx) |337.22|168.81|85.62|144.37|
| [TinyCLIP39M/16+19M](https://huggingface.co/onnx-community/TinyCLIP-ViT-39M-16-Text-19M-YFCC15M-ONNX/tree/main/onnx) |332.81|166.60|84.74|139.95|
| [nomic vision v1.5](https://huggingface.co/nomic-ai/nomic-embed-vision-v1.5/tree/main/onnx), vision only |374.49|187.39|96.75|61.96|
| [jina-clip-v2](https://huggingface.co/jinaai/jina-clip-v2/tree/main/onnx), excluded NC |3455.64 incl data|1728.81|874.35|1417.71|
| [SigLIP so400m/14-384](https://huggingface.co/onnx-community/siglip-so400m-patch14-384-ONNX/tree/main/onnx) |3512.96 incl data|**invalid 2-byte artifact at inspected revision**|894.23|705.39|

MobileCLIP2 official release is pt. no ready v2 ONNX found in audited onnx-community/Xenova/immich catalogs; bounded observation, not global absence. apple licensing already excludes product use.

immich exports [LAION B/32](https://huggingface.co/immich-app/ViT-B-32__laion2b-s34b-b79k), [SigLIP base](https://huggingface.co/immich-app/ViT-B-16-SigLIP__webli), [SigLIP2 base](https://huggingface.co/immich-app/ViT-B-16-SigLIP2__webli), [SigLIP2 B/32-256](https://huggingface.co/immich-app/ViT-B-32-SigLIP2-256__webli) and so400m. layout is visual/model.onnx + textual/model.onnx with preprocess/tokenizer assets. LAION pair fp32 **351.61+254.19 mb**, no int8 ONNX pair in that inspected repo. large text graphs may be <1mb shells plus data; armnn/rknn files are different runtime formats.

q4 often leaves embeddings/convolutions at higher precision, can exceed int8 size, and was slower here. TinyCLIP's smallest package trades substantial published quality and exports combined tower graph; split-tower candidates were easier to benchmark directly.

## measurements: image/text

environment: apple m2, 8 cores, 24 gib; macos27.0 build26A5425a; node26.8.1, ORT1.30.0, transformers.js4.3.1, sharp0.35.5. shared laptop, other work active; not isolated/thermal-controlled. three model families downloaded to raw/models, about5.01gb across tested precisions/assets. one benchmark process at a time, nice10. raw manifests pin revision/sha256.

four warmup + **20 measured runs** per successful configuration. median = middle-pair mean; p90 = nearest rank18 of20. batch8 uses first eight different fixtures. timers cover preprocessed tensor inference/output, excluding decode/resize/tokenizer/loading. text uses one padded77-token CLIP or64-token SigLIP query. batch8 is whole batch latency. CPU explicitly cpu EP; CoreML = MLProgram flag0x010 plus CPU fallback, unprofiled node assignment, so hybrid/fallback possible.

| model | dtype / provider, two threads | image1 median/p90 ms | image8 total median/p90 ms | image8 per-image median/p90 ms | text1 median/p90 ms |
| --- | --- | --- | --- | --- | --- |
|clip b/32|int8 / cpu|20.0/23.7|155.5/179.5|19.4/22.4|16.0/18.1|
|clip b/32|int8 / coreml|failed|failed|—|failed|
|clip b/32|fp32 / cpu|60.4/65.0|492.2/533.3|61.5/66.7|66.5/154.8|
|clip b/32|fp32 / coreml|59.4/63.0|423.2/432.6|52.9/54.1|62.4/91.8|
|clip b/32|q4 / cpu|62.3/63.9|482.7/616.2|60.3/77.0|41.6/42.6|
|clip b/32|q4 / coreml|failed|failed|—|failed|
|siglip base|int8 / cpu|70.8/74.4|729.9/963.2|91.2/120.4|36.7/53.3|
|siglip base|int8 / coreml|122.0/204.3|686.1/868.8|85.8/108.6|47.0/47.7|
|siglip base|fp32 / cpu|211.3/255.6|2155.6/2466.7|269.4/308.3|83.1/90.6|
|siglip base|fp32 / coreml|failed|failed|—|failed|
|siglip base|q4 / cpu|264.0/282.3|2137.7/2338.7|267.2/292.3|79.1/87.0|
|siglip base|q4 / coreml|failed|failed|—|failed|
|siglip2 base|int8 / cpu|89.9/131.0|625.6/661.4|78.2/82.7|22.5/22.9|
|siglip2 base|int8 / coreml|112.0/120.3|670.6/696.7|83.8/87.1|47.3/49.5|
|siglip2 base|fp32 / cpu|211.8/226.6|1834.0/2368.2|229.3/296.0|73.5/81.8|
|siglip2 base|fp32 / coreml|failed|failed|—|failed|
|siglip2 base|q4 / cpu|249.4/256.1|2978.8/4518.4|372.4/564.8|162.5/218.3|
|siglip2 base|q4 / coreml|failed|failed|—|failed|

cpu int8 thread sweep, same20-run protocol:

| model | threads | image1 median/p90 ms | image8 total median/p90 ms | text1 median/p90 ms |
| --- | --- | --- | --- | --- |
|clip b/32|1|33.6/34.4|258.1/262.9|27.4/29.2|
|clip b/32|2|20.0/23.7|155.5/179.5|16.0/18.1|
|clip b/32|4|20.0/26.2|134.2/197.8|14.0/15.7|
|siglip base|1|163.2/206.9|1220.8/1479.8|39.9/41.3|
|siglip base|2|70.8/74.4|729.9/963.2|36.7/53.3|
|siglip base|4|62.2/83.6|463.7/479.9|19.4/19.8|
|siglip2 base|1|143.2/147.7|1388.2/1712.5|46.4/54.1|
|siglip2 base|2|89.9/131.0|625.6/661.4|22.5/22.9|
|siglip2 base|4|44.0/46.0|402.3/430.2|14.6/15.8|

clip b/32 cpu int8 load: vision 72ms, text 84ms. siglip base cpu int8 load: vision 85ms, text 73ms. siglip2 base cpu int8 load: vision 102ms, text 147ms. single load observations, not cold-start distributions.

coreml failures: clip int8/q4 model-plan error code -7; siglip/siglip2 fp32/q4 patch embedding Conv missing required pad parameter. successful int8 SigLIP runs do not establish proportion offloaded. no universal advantage found; keep cpu default. static/fp16/CoreML-specific export validation remains work.

q4 slower than int8 here; text q4 often grew. four threads improved some throughput but clip batch1 median barely changed and p90 worsened. batch8 not uniformly faster per image for SigLIP. two threads/batch1 is conservative responsive background starting point, not hardware-universal optimum.

raw: [clip](raw/bench-clip-vit-base-patch32.json), [siglip](raw/bench-siglip-base.json), [siglip2](raw/bench-siglip2-base.json), individual timings retained. skipped fp16, GPU timing, graph/spinning variants, x86 comparison.


ten retrieval images: astronaut, coffee, cat, rocket launch, galaxies, horse silhouette, camera operator, brick, grass, gravel. source URLs/authors/cc0-public-domain status/sha256 stored in raw/images/manifest.json; [official provenance](https://github.com/scikit-image/scikit-image/blob/v0.24.0/skimage/data/_fetchers.py).

all nine cpu model/precision pairs got **10/10 top-1** for obvious descriptions against ten images. raw top-three scores/rankings in benchmark JSON. sanity check validates gross preprocessing/tower/quantization errors; does not rank hard-negative retrieval, multilingual quality, negation, counts, events, or video timestamps. pretrained benchmark accuracy not reproduced.

## runtimes and acceleration

versions inspected: onnxruntime-node **1.30.0**, transformers.js **4.3.1**, **3.8.1** source/dependencies for comparison, node-llama-cpp **3.22.2** registry/docs. measured node26.8.1; utilityProcess check used existing hibi 2 electron44.7.0/node24.21.0/chromium152.0.7977.130. no electron installation added.

use versioned [ORT1.30 node README](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/README.md); [older getting-started table](https://onnxruntime.ai/docs/get-started/with-javascript/node.html) omits coreml/webgpu and still says cuda11.8.

| platform | cpu | coreml | directml | cuda | native webgpu |
| --- | --- | --- | --- | --- | --- |
| windows x64/arm64 |yes|no|yes|not npm prebuilt|experimental|
| linux x64 |yes|no|no|cuda12 extra EP libraries|experimental|
| linux arm64 |yes|no|no|no|absent prebuilt|
| macos arm64 |yes, measured|yes, measured|no|no|experimental; listed locally|
| macos x64 |documented yes|documented yes|no|no|documented experimental; local package lacked darwin/x64 folder|

mac arm64 ort.listSupportedBackends() returned cpu/webgpu/coreml, all bundled. provider listing does not prove useful offload. linux cuda libraries are extra nuget downloads controlled by installer; windows native C++ CUDA support does not mean npm-node support. intel-mac package discrepancy needs packaging validation/custom build. [installer](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/script/install.js), [install manifests](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/script/install-metadata.js)

starting cpu session, as measured:

~~~js
{
  executionProviders: ['cpu'],
  graphOptimizationLevel: 'all',
  executionMode: 'sequential',
  intraOpNumThreads: 2,
  interOpNumThreads: 1
}
~~~

intra-op splits work inside operators; inter-op controls parallel graph execution. defaults can create one thread pool per physical core/session, oversubscribing laptop with many sessions. graph levels disabled/basic/extended/layout/all; optimizedModelFilePath writes optimized graph that may depend on provider/hardware; freeDimensionOverrides specializes symbolic input sizes. enableCpuMemArena/enableMemPattern change allocation behavior. extra session config can disable spinning to reduce idle cpu, unmeasured here. DML needs sequential execution, disabled memory patterns, serialized Run calls per session. [threads](https://onnxruntime.ai/docs/performance/tune-performance/threading.html), [session API](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.SessionOptions.html), [DML restrictions](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)

CoreML node1.30 uses legacy coreMlFlags; tests use **0x010 MLProgram**. arbitrary Python ModelCacheDirectory/ModelFormat/MLComputeUnits options are not exposed by this binding. compilation and fallback can dominate; static-shape/fp16 models are optimization candidates, not measured wins. [pinned parser](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/src/session_options_helper.cc), [CoreML options](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.CoreMLExecutionProviderOption.html)

transformers.js4.3.1 selects node ORT1.30 in node and web ORT1.31.0-dev.20260914-8d85527a0 in web; node images use sharp, tokenizers pure js/ts @huggingface/tokenizers. devices include cpu/coreml/dml/cuda/webgpu/wasm and WebNN variants where supported. dtype fp32/fp16/q8/int8/uint8/q4/bnb4/q4f16, including per-module choices. option existence does not provide missing model file/kernel. high-level loaders accept session_options. v3.8.1 pins node ORT1.21.0; v4 adds native node WebGPU, so “WebGPU browser only” is stale. [v4 package](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/package.json), [v4 backend](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/src/backends/onnx.js), [v3 backend](https://github.com/huggingface/transformers.js/blob/3.8.1/src/backends/onnx.js), [dtype docs](https://huggingface.co/docs/transformers.js/en/guides/dtypes), [v4 release](https://huggingface.co/blog/transformersjs-v4)

offline contract: env.allowRemoteModels=false, env.localModelPath to installed directory, local_files_only=true, explicit device/dtype. local wasm/mjs workers too if web backend included; default CDN asset URLs violate brief. [node tutorial](https://huggingface.co/docs/transformers.js/en/tutorials/node), [web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html)

**utilityProcess verified locally:** CLIP image/text finite [1,512] embeddings and base.en q8 timestamped speech succeeded in electron44.7.0 utilityProcess; raw/electron-smoke.json records versions/results. supports placement on this mac, not signed/asar builds or other oses. electron utilityProcess supplies node plus message ports via chromium services and starts after app ready. [API](https://www.electronjs.org/docs/latest/api/utility-process)

ORT uses N-API6, reducing ordinary per-node-version ABI rebuild needs. still externalize native dependencies from bundler, preserve package structure, unpack native libraries, ship correct architecture, validate codesigning/dll lookup. node-API does not fix loader/allocator errors. upstream electron crash report concerns ORT1.14/electron35; evidence for smoke tests/isolation, not proof current1.30 fails. [N-API declaration](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/package.json), [electron native guidance](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules), [specific report](https://github.com/microsoft/onnxruntime/issues/29763)

installed npm native files, uncompressed:

| folder | mb | contents/limits |
| --- | ---: | --- |
| darwin/arm64 |89.45|two44.59mb dylib copies +.267mb binding, both present|
| linux/x64 |46.22|base library/binding; CUDA libraries/dependencies extra|
| linux/arm64 |25.53|base library/binding|
| win32/x64 |67.08|ORT/binding/DirectML/dxcompiler/dxil|
| win32/arm64 |72.74|same categories|
| darwin/x64 |unknown|absent inspected package despite README matrix|

whole npm unpacked metadata301.07mb. actual per-file evidence raw/runtime-audit.json. not signed installer/download sizes; sharp, renderer wasm, CUDA/cuDNN, llama binaries extra. preserve licenses when selecting platform files.

node-llama-cpp3.22.2 is useful GGUF text runtime, **not established phase1 vision path**. public image API remains open issue88/v4 milestone. mtmd support does not automatically become node support. electron guide permits main process and warns renderer crashes; utilityProcess compatibility for this wrapper unverified. GGUF vision alternative is packaged llama.cpp executable plus matching language model/mmproj. [image issue](https://github.com/withcatai/node-llama-cpp/issues/88), [electron guide](https://node-llama-cpp.withcat.ai/guide/electron), [mtmd](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)

onnxruntime-web in renderer/dedicated worker uses wasm/WebGPU through chromium; avoids node-addon ABI but adds asset/CSP/secure-context and wasm-thread cross-origin-isolation concerns. keep work off UI and all version-matched wasm/mjs/models local. browser canvas preprocessing differs from node sharp. measure native node WebGPU before adding a second default path. [deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html), [webgpu](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)

gpu path: macos try native WebGPU/Metal or compatible CoreML fp16 graphs; windows DML fp16/fp32 with sequential runs, native WebGPU alternative; linux x64 optional CUDA12 on NVIDIA or native WebGPU. always cpu fallback after graph/load checks and embedding/ranking parity test. WebGPU/DML/CUDA/fp16 performance not measured; no automatic speedup claimed.

## scene captions / vqa

default cpu pass = image embeddings + required speech. captions optional, on selected frames/windows, never blocking initial search. even assumed5s/image makes100k captions ~139h serially.

seconds below are **unverified planning estimates, not sourced benchmarks**: warm quantized native execution, one image, ~40 generated tokens, greedy, no tiling/beam search, ~four cpu threads. m2 budget = assumed vision/prefill +40/decode-rate; four-core avx2 x86 roughly2–3× widened. larger images/multi-frame input cost more. these budgets cannot establish relative model quality.

| checkpoint / exact license | artifacts / llama.cpp mtmd | estimated m2 / four-core x86 seconds per image; quality |
| --- | --- | --- |
| SmolVLM2-256M-Video-Instruct; **Apache License, Version 2.0** | publisher [ONNX](https://huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct/tree/main/onnx), [GGUF](https://huggingface.co/ggml-org/SmolVLM2-256M-Video-Instruct-GGUF); mtmd yes |~1–6 /3–15; minimum resource; Video-MME33.7. [card](https://huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct)|
| SmolVLM2-500M-Video-Instruct; **Apache License, Version 2.0** |publisher [ONNX](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct/tree/main/onnx), [GGUF](https://huggingface.co/ggml-org/SmolVLM2-500M-Video-Instruct-GGUF); mtmd yes|~2–9 /5–25; Video-MME42.2, first multi-frame alternative. [card](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct)|
| SmolVLM2-2.2B-Instruct; **Apache License, Version 2.0** |[GGUF](https://huggingface.co/ggml-org/SmolVLM2-2.2B-Instruct-GGUF), complete ready ONNX unverified; mtmd yes|~6–25 /15–75; name omits Video but accepts video; Video-MME52.1. [card](https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct)|
| moondream0.5b; **Apache License, Version 2.0** |official [int4/int8 mf packages](https://huggingface.co/vikhyatk/moondream2/tree/onnx), not bare ONNX; exact GGUF/mtmd unverified|~2–9 /5–25; publisher discourages general out-of-box use; fine-tuning target. current files442/622mb differ from marketing compressed sizes. [selection](https://moondream.ai/models)|
| moondream2, ~2b; **Apache License, Version 2.0** |[ONNX](https://huggingface.co/Xenova/moondream2), [GGUF2025-04-14](https://huggingface.co/ggml-org/moondream2-20250414-GGUF); mtmd yes for that revision, latest2025-06-21 unverified|~6–25 /15–75; caption/query/detect/point API; revisions not interchangeable. [card](https://huggingface.co/vikhyatk/moondream2)|
| moondream3 preview,9b total/2b active; **Business Source License 1.1 + Additional Use Grant** |complete ONNX/GGUF/mtmd unverified|unknown; **excluded**. active2b does not mean2b residency. 3.1 separate **Moondream Model License 1.0**, also excluded. [preview terms](https://huggingface.co/moondream/moondream3-preview/blob/main/LICENSE.md), [3.1](https://huggingface.co/moondream/moondream3.1-9B-A2B)|
| Florence-2-base/base-ft,0.23b; **MIT License** |[ONNX base-ft](https://huggingface.co/onnx-community/Florence-2-base-ft/tree/main/onnx), int8/q4 modules; GGUF/mtmd unverified|~2–9 /5–25; task caption/OCR/grounding; base-ft COCO CIDEr140.0. [publisher](https://huggingface.co/microsoft/Florence-2-base-ft)|
| Florence-2-large/large-ft,0.77b; **MIT License** |[ONNX large-ft](https://huggingface.co/onnx-community/Florence-2-large-ft/tree/main/onnx); GGUF/mtmd unverified|~5–21 /12–60; COCO CIDEr143.3. fine-tuned checkpoint differs from original base/large. [publisher](https://huggingface.co/microsoft/Florence-2-large-ft)|
| Qwen2.5-VL-3B-Instruct; **Qwen RESEARCH LICENSE AGREEMENT** |[GGUF](https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF), mtmd yes; exact complete ONNX unverified|~9–40 /25–120; **excluded non-commercial research**, unlike some sibling sizes. [license](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE)|
| Qwen3-VL-2B-Instruct; **Apache License, Version 2.0** |publisher [GGUF+mmproj](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF), mtmd yes; complete ready ONNX unverified|~7–30 /20–90; optional richer OCR/spatial scenes; q4 language~1.11gb plus projector. [card](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct)|
| Qwen3-VL-4B-Instruct; **Apache License, Version 2.0** |[GGUF+mmproj](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF), mtmd yes; complete ONNX unverified|~11–55 /30–160; q4 language~2.5gb plus projector; choose Instruct over Thinking for bounded captions. [card](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct)|
| newer Ministral-3-3B-Instruct-2512,3.4b language+.4b vision; **Apache License, Version 2.0** |publisher [ONNX cpu example](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-ONNX), [GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF); mtmd artifacts|~10–45 /25–130; multilingual comparator outside compact tier; ggml-org q8 projector alone448mb|

“mtmd yes” means official model list/publisher artifacts, not local test/minimum-version guarantee. **node-llama-cpp vision unverified/pending for every row**. [official mtmd list](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md), [wrapper issue](https://github.com/withcatai/node-llama-cpp/issues/88)

Florence-base-ft is provisional first optional caption test using same ONNX runtime; CAPTION/DETAILED_CAPTION bounded tasks. all components—vision encoder, token embedding, encoder, merged decoder—must load; one decoder file insufficient. test encoder precision carefully; transformers.js supports per-module dtype because Florence/Whisper encoders can be sensitive. no cross-model gallery quality ranking established from task benchmark scores. [dtype guidance](https://huggingface.co/docs/transformers.js/en/guides/dtypes)

## transcript/caption text embedding

| model | total params / dim / context | license / exact recipe |
| --- | --- | --- |
| all-MiniLM-L6-v2 |~22.7m/384/256 wordpieces in sentence-transformers config|**Apache License, Version 2.0**; english, attention-mask mean pooling +l2, no query prefix. default. [card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)|
| bge-small-en-v1.5 |~33.4m/384/512|**MIT License**; english, cls pooling+l2, documented retrieval-query instruction. alternative, not second default model. [card](https://huggingface.co/BAAI/bge-small-en-v1.5)|
| nomic-embed-text-v1.5 |~136.7m/768 native/8192|**Apache License, Version 2.0**; mean pool, layer norm, optional matryoshka truncate, l2; search_query/search_document prefixes. only nomic-vision pair shares image space. [card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5)|
| multilingual-e5-small |~117.7m/384/512|**MIT License**;100 languages, low-resource quality varies; masked mean+l2; query: /passage: prefixes required even non-english. [card](https://huggingface.co/intfloat/multilingual-e5-small)|

all have ONNX. do not use avx512-specific exports as generic arm64/x86 graph. MiniLM q8 graph22.97mb; e5 int8 graph118.05mb +tokenizer17.08mb +optional SentencePiece5.07mb. q4~399mb: use q8. [MiniLM assets](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/main), [e5 assets](https://huggingface.co/Xenova/multilingual-e5-small/tree/main)

english CLIP tower is not multilingual transcript encoder. phase1 original transcript→fts; english segments→MiniLM. phase2 explicit e5 pack embeds **all** passages, including english, plus multilingual queries into same text space; fts retains original text for names/literal words. use suitable lexical tokenizer for language. e5 supplies cross-language semantics, not untranslated fts. attach segment matches to scenes by time overlap; combine ranks across image/text retrieval, not cross-model vector dot products. rebuild replacement text index before switching; image index unchanged. multilingual image-only queries also need SigLIP2; e5 does not align with CLIP images.

## required speech: english first, multilingual next

phase1 base.en q8 via transformers.js cpu utilityProcess; timestamped segments, 30s windows/5s stride. **omit task/language on .en**;4.3.1 rejects them. no word-level timestamp alignment by default; segment timestamps enough initial search signal. tiny.en can be explicit faster/lower-quality choice after own benchmark. [chunk/timestamp API](https://huggingface.co/docs/transformers.js/api/pipelines#module_pipelines.AutomaticSpeechRecognitionPipeline), [prefix validation](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/src/models/whisper/modeling_whisper.js#L46)

measured same m2/node/ORT environment as image test; exact onnx-community/whisper-base.en revision51eefc0af78b103839eda9e7e4f4186acc6517fe, q8 encoder+merged decoder. 11.000s JFK sample from [OpenAI test asset](https://github.com/openai/whisper/blob/main/tests/jfk.flac), speech throughout; no VAD/blank skipping. 16khz mono float waveform via ffmpeg s16 conversion. CPU EP explicitly selected, no CoreML/GPU. one warmup, **five measured runs** per thread setting. full processor+generation included, ffmpeg/model-load excluded; greedy1beam, max128newtokens, timestamps,30s window/5s stride. median third of5, p90 nearest-rank fifth.

| threads | warm median/p90 seconds | RTF median | extrapolated min/audio-hour | session load ms, one observation |
| --- | --- | --- | --- | --- |
|1|1.276/1.330|0.116|6.96|371|
|2|0.878/1.048|0.080|4.79|446|
|4|0.823/1.245|0.075|4.49|388|

**two threads: .88s for11s, RTF.080**, correct transcript and one[0,11] segment. four threads slightly lower median but worse p90; two-thread starting point retained. hourly values are **arithmetic short-sample extrapolation, not hour-long/video throughput**. chunking, speech density, long decoder history, accents/languages, model cold starts, ffmpeg and VAD change end-to-end rate. [raw timing/output](raw/asr-bench.json), [utilityProcess smoke](raw/electron-smoke.json). no word-error-rate dataset evaluation or timestamp-accuracy ground truth.


| speech candidate | params / exact license | runtime / cpu-hour evidence |
| --- | --- | --- |
| Whisper tiny/base/small, including .en |39m/74m/244m; weights/code **MIT License**|ONNX or whisper.cpp; cpp f16 files75/142/466mib; reported memory~273/388/852mb. base.en q8 measured above. [upstream](https://github.com/openai/whisper), [cpp sizes](https://github.com/ggml-org/whisper.cpp)|
| distil-small.en |166m, english; **MIT License**|ONNX / exact cpp conversion needs validation;~332mb raw fp16 arithmetic. no comparable absolute m2 cpu-hour rate verified. [card](https://huggingface.co/distil-whisper/distil-small.en)|
| original Moonshine tiny/base |27m/61m english; **MIT License** weights|ONNX, short/live speech alternative; no target bulk RTF. do not multiply end-of-utterance latency into hour estimate. other/new multilingual releases have release-specific terms. [publisher](https://huggingface.co/UsefulSensors/moonshine), [runtime license distinctions](https://github.com/moonshine-ai/moonshine)|
| Parakeet TDT0.6b v3 |600m,25 european languages; **Creative Commons Attribution 4.0 International**|sherpa-onnx int8; **comparison only**, outside allowed MIT/Apache/BSD weight list. no m2 v3 cpu-hour rate. [card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [runtime](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html)|

external reference: faster-whisper13-minute clip/i7-12700k/8threads/beam5: small int8 102s (RTF.131,7.85min/audio-hour); batch8 51s (.065,3.92min/hour); whisper.cpp fp32 125s (.160,9.62min/hour). different hardware/runtime/decoding, no run-count spread; not m2 or four-core prediction. [benchmark](https://github.com/SYSTRAN/faster-whisper#small-model-on-cpu)

sherpa Parakeet **v2**, not v3, short7.435s/rk3588 cpu test RTF.088 at4threads (~5.28min/hour arithmetic). not v3/m2 claim. no defensible universal hour estimate found for distil/Moonshine; unknown retained rather than using GPU/ANE numbers. [test](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html)

**phase2 detection trap:** pipeline docs say null language auto-detects; installed transformers.js4.3.1 detection TODO instead assigns en, and pipeline does not forward return_language to ASR tokenizer decode. known-language transcription works; omitted language is not detection. [pinned model code](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/src/models/whisper/modeling_whisper.js#L54), [decode call](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/src/pipelines/automatic-speech-recognition.js#L306)

concrete phase2: utilityProcess hosts packaged **cpu-only whisper.cpp v1.9.5 child**, multilingual base-q5_1, -l auto and JSON; small-q5_1 optional accuracy pack. keep source language, window origin, language code. CLI model reload cost belongs in throughput budget; no per32ms-VAD-frame spawning. JSON includes result.language, not calibrated confidence; C API returns language probability array. VAD-empty→no speech; allow undetermined language, no invented universal threshold. [CLI](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/examples/cli/cli.cpp), [C API](https://github.com/ggml-org/whisper.cpp/blob/v1.9.5/include/whisper.h)

~~~sh
whisper-cli -m /models/ggml-base-q5_1.bin -f /work/clip.wav \
  --no-gpu -t 2 -l auto -oj -of /work/result
~~~

build with Metal/Core ML disabled for cpu baseline; --no-gpu alone does not exclude separately built Core ML encoder. phase2 uses GGML, not reusable ONNX files, and was not packaged/run here. same-ORT alternative is custom first decoder step from start-of-transcript, mask non-language logits, softmax language tokens, then transcribe with selected language. reference exists, but validating graph/KV feeds/token map/abstention is new work, not JS switch. [OpenAI detector](https://github.com/openai/whisper/blob/main/whisper/decoding.py#L18), [Core ML distinction](https://github.com/ggml-org/whisper.cpp#core-ml-support)

runtime choice: phase1 transformers.js reuses existing ORT and tested utility host, supplies log-mel/tokenizer/generation/timestamps. direct onnxruntime-node alone lacks those processing/decoder loops; no reason to rewrite them. phase2 sidecar offers supported auto detection at cost of second runtime/model format; low-level detector could later unify runtime after validation. node-llama-cpp is not ASR runtime here.

**VAD/silence skipping:** Silero VAD **MIT License** weights/code, local ONNX in same worker. current wrapper:512 new16khz samples=32ms,64 context→576 graph samples, recurrent state[2,batch,128]; reset across unrelated files, not each frame; right-pad final frame. defaults threshold.5, minimum speech250ms, silence100ms, padding30ms. group voiced spans into bounded ASR windows preserving edge padding/original-time mapping. VAD can miss quiet speech; calibrate. no local VAD speed/accuracy run. [license](https://github.com/snakers4/silero-vad/blob/master/LICENSE), [wrapper](https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/utils_vad.py)

**ffmpeg contract:** first audio stream, mono16khz float32 little-endian PCM stdout. no-audio is handled job outcome. use spawn argument array, stderr separate from bytes.

~~~sh
ffmpeg -nostdin -hide_banner -loglevel error -i INPUT \
  -map 0:a:0 -vn -sn -dn -ac 1 -ar 16000 \
  -c:a pcm_f32le -f f32le pipe:1
~~~

equivalent explicit filter: aresample=16000,aformat=sample_fmts=flt:sample_rates=16000:channel_layouts=mono. float32 is64,000bytes/s,230.4mb/hour; stream bounded buffers, carry partial4-byte samples/VAD frames across reads. CLI work items use pcm_s16le WAV; s16→float divides32768. benchmark used equivalent s16 pipe. [audio options](https://ffmpeg.org/ffmpeg.html#Audio-Options), [raw formats](https://ffmpeg.org/ffmpeg-formats.html#Raw-PCM-muxers), [pipe](https://ffmpeg.org/ffmpeg-protocols.html#pipe), [filters](https://ffmpeg.org/ffmpeg-filters.html#aresample)

media_time = audio_origin + crop_start_sample/16000 + asr_relative_time. concatenating voiced crops requires piecewise reverse mapping; compressed offsets cannot become video timestamps. persist start/end/language/text; scene association by interval overlap. future throughput reports include speech fraction and both whole-media/voiced-only RTF.

## exact preprocessing, pins, and bundling

default is **measured OpenAI B/32 from Xenova**, not an unmeasured LAION export. full selected-file manifest, including every config/tokenizer sha256/byte count/pinned URL/license, is [raw/default-model-pins.json](raw/default-model-pins.json).

| repo / revision / license | exact graph | bytes | sha256 |
| --- | --- | ---: | --- |
|Xenova/clip-vit-base-patch32@d15189d7028b43f1d3e65039190477f6af591c2a; MIT|onnx/text_model_int8.onnx|64070791|18845f2ccc35223bb7fec403383a131154b11ac0918df25cf51986df5efd3a21|
|Xenova/clip-vit-base-patch32@d15189d7028b43f1d3e65039190477f6af591c2a; MIT|onnx/vision_model_int8.onnx|88648877|0ab0c1b3ace708e539633af1744d5a95247fe4e14d3e08ff197ef82a6cb9bd93|
|onnx-community/whisper-base.en@51eefc0af78b103839eda9e7e4f4186acc6517fe; MIT|onnx/decoder_model_merged_quantized.onnx|53692803|dd4761a3f7add26afda3512abff4706920404c2517e85a9f2ff090b0c0987909|
|onnx-community/whisper-base.en@51eefc0af78b103839eda9e7e4f4186acc6517fe; MIT|onnx/encoder_model_quantized.onnx|23201320|6e8001198c490bbae018c0044f630c2915efb826bad957006ce36152d0ab2a10|
|Xenova/all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9; Apache-2.0|onnx/model_quantized.onnx|22972370|afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1|

required assets, all with individual checksums in linked manifest:

- Xenova/clip-vit-base-patch32: config.json, merges.txt, preprocessor_config.json, special_tokens_map.json, tokenizer.json, tokenizer_config.json, vocab.json.
- onnx-community/whisper-base.en: added_tokens.json, config.json, generation_config.json, merges.txt, normalizer.json, preprocessor_config.json, quantize_config.json, special_tokens_map.json, tokenizer.json, tokenizer_config.json, vocab.json.
- Xenova/all-MiniLM-L6-v2: config.json, special_tokens_map.json, tokenizer.json, tokenizer_config.json, vocab.txt.

MiniLM graph/assets downloaded for checksum/provenance; no latency or retrieval benchmark claimed for it. default source of truth is pinned manifest, not changing main-branch listings.


selected graphs already return projected image_embeds/text_embeds. l2-normalize each512-d vector; cosine=dot product. no softmax/logit scale for ranking, no hidden-state pooling in place of projection. [conversion usage](https://huggingface.co/Xenova/clip-vit-base-patch32), [upstream](https://github.com/openai/CLIP)

exact default image recipe:

1. decode EXIF orientation; RGB channel order. grayscale repeats channels; RGBA drops alpha in this processor, no implicit white composite.
2. bicubic resize, PIL resample3, shortest edge224 with aspect preserved. processor sizing rounds calculated dimension to2 decimal places then floors.
3. center crop224×224; left/top floor((resized dimension−224)/2).
4. scale uint8 by1/255; channel means[0.48145466,0.4578275,0.40821073], stds[0.26862954,0.26130258,0.27577711].
5. float32 NCHW[batch,3,224,224]→pixel_values; image_embeds[batch,512]→unit l2.

use pinned AutoProcessor for exact implementation. node uses sharp affine bicubic; browser canvas ignores requested interpolation, so renderer migration needs parity check. full Python-PIL bitwise equivalence and browser parity were not tested. [config](https://huggingface.co/Xenova/clip-vit-base-patch32/blob/d15189d7028b43f1d3e65039190477f6af591c2a/preprocessor_config.json), [sizing](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/src/image_processors_utils.js), [decode/crop](https://github.com/huggingface/transformers.js/blob/4.3.1/packages/transformers/src/utils/image.js)

exact text: CLIPTokenizer byte-level BPE, pinned tokenizer.json plus serialized config/vocab/merges. normalization/lowercasing from tokenizer data; do not replace with generic split/BERT/Gemma tokenizer. context77 total including BOS49406/EOS49407, truncation retaining EOS, right-pad EOS49407 per converter. selected text_model_int8 takes **input_ids int64[batch,77] only**, no attention_mask input. tokenizer may return extra tensors; feed session.inputNames only. output text_embeds[batch,512], l2. no forced “a photo of” prefix for arbitrary queries. [config](https://huggingface.co/Xenova/clip-vit-base-patch32/blob/d15189d7028b43f1d3e65039190477f6af591c2a/tokenizer_config.json), [tokenizer](https://huggingface.co/Xenova/clip-vit-base-patch32/blob/d15189d7028b43f1d3e65039190477f6af591c2a/tokenizer.json)

quality-pack difference: SigLIP2 stretches224×224, **bilinear resample2**, mean/std[.5,.5,.5],1/255, no CLIP crop. Gemma vocab256000, no BOS, append EOS, pad token; explicitly max_length64 +padding/truncation. tokenizer model_max_length is huge sentinel, not allocation size. take projected pooler_output, l2 768-d. original SigLIP instead uses bicubic3/different32k tokenizer. [quality preprocessor](https://huggingface.co/google/siglip2-base-patch16-224/blob/main/preprocessor_config.json), [quality tokenizer](https://huggingface.co/google/siglip2-base-patch16-224/blob/main/tokenizer_config.json), [original config](https://huggingface.co/google/siglip-base-patch16-224/blob/main/preprocessor_config.json)

installed layout, outside asar for model/native filesystem access:

~~~text
models/
  clip-b32-openai-int8/<revision>/
    config.json
    preprocessor_config.json
    tokenizer.json
    tokenizer_config.json
    special_tokens_map.json
    vocab.json
    merges.txt
    onnx/vision_model_int8.onnx
    onnx/text_model_int8.onnx
    LICENSE.upstream.txt
    manifest.json
  whisper-base-en-q8/<revision>/
    config.json
    generation_config.json
    preprocessor_config.json
    tokenizer.json
    tokenizer_config.json
    special_tokens_map.json
    normalizer.json
    vocab.json
    merges.txt
    onnx/encoder_model_quantized.onnx
    onnx/decoder_model_merged_quantized.onnx
    LICENSE.upstream.txt
    manifest.json
  minilm-l6-q8/<revision>/
    config.json
    tokenizer.json
    tokenizer_config.json
    special_tokens_map.json
    vocab.txt
    onnx/model_quantized.onnx
    LICENSE.upstream.txt
    manifest.json
  silero-vad/<revision>/
    silero_vad.onnx
    LICENSE.txt
    manifest.json
~~~

layout is recommendation, not implementation. adapt env.localModelPath/model identifiers or retain HF organization/repo folders as bench does. exact default manifest supersedes illustrative tree for any additional required asset. select files, not entire repositories/all precisions. bundles can live under app resources; explicit user-installed packs under app data. disable network after install.

manifest: repo/revision, per-file sha256/bytes, upstream license/conversion provenance, tensor names/dtypes/shapes, vector dims, processor/tokenizer fingerprint and index version. preserve model notices independently from app MIT. MIT permits redistribution with copyright/license notice; Apache2 requires license/notices/modification attribution. conversion labels do not erase upstream terms. full inspected terms in raw/licenses; missing repo LICENSE files recorded, card SPDX and canonical Apache text retained. [MIT grant](https://github.com/openai/CLIP/blob/main/LICENSE), [Apache exact text](https://www.apache.org/licenses/LICENSE-2.0.txt)

## reproduction and limits

scripts bench/, downloads/evidence gitignored raw/. dependencies installed only bench/. no commit.

~~~sh
cd research/bench
/opt/homebrew/bin/npm ci --no-audit --no-fund
python3 catalog.py
python3 download.py
python3 fixtures.py
/opt/homebrew/bin/node bench.mjs clip-vit-base-patch32
/opt/homebrew/bin/node bench.mjs siglip-base
/opt/homebrew/bin/node bench.mjs siglip2-base
python3 asr-download.py
/opt/homebrew/bin/node asr-bench.mjs
python3 default-pins.py
/opt/homebrew/bin/node runtime-audit.mjs
~~~

run benchmarks serially. catalog/export-audit/sources/licenses scripts refresh live evidence; actual benchmark pins/checksums retained in manifests. bench.mjs4warmup+20runs; asr-bench.mjs1warmup+5runs/thread. electron-smoke.cjs/electron-worker.cjs reproduce utilityProcess check with an existing electron executable.

unvalidated: four-core x86/windows/linux timing; native WebGPU/DML/CUDA/fp16; signed/asar/intel-mac packaging; coreml node assignment; large-gallery/hard-negative/multilingual retrieval; event chronology; actual captions; VAD gating; packaged multilingual whisper.cpp/detection; sustained hour-long ASR, energy/thermals/peak memory. next validation should target these gaps.





