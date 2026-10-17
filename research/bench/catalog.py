"""record hub metadata, exact files, sizes, revisions; no weights downloaded."""
import json, urllib.request, pathlib, concurrent.futures
root = pathlib.Path(__file__).resolve().parents[1] / "raw"
root.mkdir(exist_ok=True)
queries = ["mobileclip", "siglip2-base-patch16", "siglip-base-patch16", "TinyCLIP", "ViT-B-32", "nomic-embed-vision-v1.5", "jina-clip-v2", "PE-Core-T16", "FastVLM", "LITE"]
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent":"viquery-research/1"}), timeout=60) as r:
        return json.load(r)
repos = set(["google/siglip2-base-patch16-224", "google/siglip2-base-patch16-256", "google/siglip-base-patch16-224", "google/siglip-base-patch16-256", "google/siglip-so400m-patch14-384", "google/siglip2-so400m-patch14-384", "nomic-ai/nomic-embed-vision-v1.5", "jinaai/jina-clip-v2", "laion/CLIP-ViT-B-32-laion2B-s34B-b79K", "laion/CLIP-ViT-B-32-DataComp.XL-s13B-b90K", "openai/clip-vit-base-patch32"])
for q in queries:
    found=get("https://huggingface.co/api/models?search="+urllib.parse.quote(q)+"&limit=100")
    for x in found:
        if x["id"].split("/")[0] in ["onnx-community","Xenova","immich-app","apple","wkcn","timm","facebook"]:
            repos.add(x["id"])
def one(repo):
    try: return repo,get("https://huggingface.co/api/models/"+repo+"?blobs=true")
    except Exception as e: return repo,{"error":str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    catalog=dict(pool.map(one, sorted(repos)))
(root/"hub-catalog.json").write_text(json.dumps(catalog,indent=2))
for repo,x in catalog.items():
    files=[f for f in x.get("siblings",[]) if f["rfilename"].endswith(".onnx")]
    if files:
        print(repo,x.get("sha"),"license="+str(x.get("cardData",{}).get("license")),[(f["rfilename"],round(f["size"]/1e6,2)) for f in files if f["rfilename"].startswith(("onnx/vision","onnx/text")) or len(files)<10],flush=True)
print("catalog",len(catalog),flush=True)
