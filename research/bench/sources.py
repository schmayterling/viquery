"""save official model/runtime sources alongside research evidence."""
import urllib.request, pathlib, concurrent.futures
root=pathlib.Path(__file__).resolve().parents[1]/"raw"/"sources"
root.mkdir(parents=True,exist_ok=True)
sources={
"mobileclip-readme.md":"https://raw.githubusercontent.com/apple/ml-mobileclip/main/README.md",
"mobileclip-license.txt":"https://raw.githubusercontent.com/apple/ml-mobileclip/main/LICENSE_MODELS",
"mobileclip2-paper.html":"https://arxiv.org/html/2508.20691v1",
"siglip2-paper.html":"https://arxiv.org/html/2502.14786v1",
"tinyclip-readme.md":"https://raw.githubusercontent.com/wkcn/TinyCLIP/main/README.md",
"nomic-vision.md":"https://huggingface.co/nomic-ai/nomic-embed-vision-v1.5/raw/main/README.md",
"jina-clip-v2.md":"https://huggingface.co/jinaai/jina-clip-v2/raw/main/README.md",
"openclip-results.csv":"https://raw.githubusercontent.com/mlfoundations/open_clip/main/docs/openclip_results.csv",
"ort-node-package.json":"https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/js/node/package.json",
"ort-node-install.js":"https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/js/node/script/install.js",
"ort-session-options.cc":"https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/js/node/src/session_options_helper.cc",
"transformers-v4-blog.md":"https://raw.githubusercontent.com/huggingface/blog/main/transformersjs-v4.md",
"skimage-fetchers.py":"https://raw.githubusercontent.com/scikit-image/scikit-image/v0.24.0/skimage/data/_fetchers.py",
"electron-utility-process.md":"https://raw.githubusercontent.com/electron/electron/main/docs/api/utility-process.md",
}
for family in ["MobileCLIP-S0","MobileCLIP-S1","MobileCLIP-S2","MobileCLIP-B","MobileCLIP2-S0","MobileCLIP2-S2","MobileCLIP2-B","MobileCLIP2-S3","MobileCLIP2-S4","MobileCLIP2-L-14"]:
    sources[family+"-config.json"]=f"https://huggingface.co/apple/{family}/resolve/main/config.json"
for family in ["siglip-base-patch16-224","siglip-base-patch16-256","siglip2-base-patch16-224","siglip2-base-patch16-256","siglip-so400m-patch14-384","siglip2-so400m-patch14-384"]:
    sources[family+"-config.json"]=f"https://huggingface.co/google/{family}/resolve/main/config.json"
def one(item):
    file,url=item
    try:
        data=urllib.request.urlopen(url,timeout=30).read();(root/file).write_bytes(data);return file,len(data)
    except Exception as e:return file,str(e)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for x in pool.map(one,sources.items()):print(*x,flush=True)
