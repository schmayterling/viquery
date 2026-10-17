import urllib.request,urllib.parse,json,pathlib,concurrent.futures
root=pathlib.Path(__file__).resolve().parents[1]/"raw"
p=root/"hub-catalog.json";catalog=json.loads(p.read_text())
def get(url):
    return json.load(urllib.request.urlopen(url,timeout=30))
repos=set()
for author in ["onnx-community","Xenova","immich-app"]:
    for q in ["MobileCLIP","siglip","nomic","jina-clip","PE-Core"]:
        for a in get("https://huggingface.co/api/models?author="+author+"&search="+urllib.parse.quote(q)+"&limit=100"):
            repos.add(a["id"])
def one(repo):
    try:return repo,get("https://huggingface.co/api/models/"+repo+"?blobs=true")
    except Exception as e:return repo,{"error":str(e)}
with concurrent.futures.ThreadPoolExecutor(3) as pool:
    for repo,a in pool.map(one,sorted(repos)):
        catalog[repo]=a
p.write_text(json.dumps(catalog,indent=2))
lines=[]
for repo,a in sorted(catalog.items()):
    if not repo.startswith(("onnx-community/","Xenova/","immich-app/","nomic-ai/","jinaai/")):continue
    files=[f for f in a.get("siblings",[]) if f["rfilename"].endswith((".onnx",".onnx_data",".onnx.data"))]
    if not files:continue
    lines.append({"repo":repo,"revision":a.get("sha"),"license":a.get("cardData",{}).get("license"),"files":[{"path":f["rfilename"],"bytes":f.get("size")} for f in files]})
(root/"export-audit.json").write_text(json.dumps(lines,indent=2))
print("catalog",len(catalog),"exports",len(lines),flush=True)
