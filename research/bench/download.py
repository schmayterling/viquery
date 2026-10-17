"""download pinned benchmark files; all generated/downloaded data stays in raw."""
import pathlib, json, urllib.request, hashlib, concurrent.futures
root = pathlib.Path(__file__).resolve().parents[1] / "raw"
catalog=json.loads((root/"hub-catalog.json").read_text())
repos=["Xenova/clip-vit-base-patch32","Xenova/siglip-base-patch16-224","onnx-community/siglip2-base-patch16-224-ONNX"]
manifest=[]
def download(item):
    repo,sha,f=item
    rel=f["rfilename"]
    path=root/"models"/repo/rel
    path.parent.mkdir(parents=True,exist_ok=True)
    url=f"https://huggingface.co/{repo}/resolve/{sha}/{rel}"
    if not path.exists() or path.stat().st_size!=f["size"]:
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url,timeout=120) as res, path.with_suffix(path.suffix+".part").open("wb") as out:
                    while b:=res.read(1024*1024):out.write(b)
                path.with_suffix(path.suffix+".part").replace(path)
                break
            except Exception:
                if attempt==2:raise
    h=hashlib.sha256()
    with path.open("rb") as inp:
        while b:=inp.read(1024*1024):h.update(b)
    return {"repo":repo,"revision":sha,"file":rel,"bytes":path.stat().st_size,"sha256":h.hexdigest(),"url":url}
jobs=[]
for repo in repos:
    if repo not in catalog:
        catalog[repo]=json.load(urllib.request.urlopen("https://huggingface.co/api/models/"+repo+"?blobs=true",timeout=30))
        (root/"hub-catalog.json").write_text(json.dumps(catalog,indent=2))
    a=catalog[repo]
    if "siblings" not in a:raise RuntimeError((repo,a))
    for f in a["siblings"]:
        p=f["rfilename"]
        if ("/" not in p and p.endswith((".json",".txt",".md"))) or p in [f"onnx/{tower}{suffix}.onnx" for tower in ["vision_model","text_model"] for suffix in ["","_int8","_q4"]]:
            jobs.append((repo,a["sha"],f))
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for record in pool.map(download,jobs):
        manifest.append(record)
        print(record["repo"],record["file"],record["bytes"],flush=True)
(root/"model-manifest.json").write_text(json.dumps(manifest,indent=2))
print("download complete",sum(x["bytes"] for x in manifest),flush=True)
