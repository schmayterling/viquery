import json,pathlib,urllib.request,hashlib
root=pathlib.Path(__file__).resolve().parents[1]/"raw"
source=json.loads((root/"model-manifest.json").read_text())+json.loads((root/"asr-model-manifest.json").read_text())
repos={
"Xenova/clip-vit-base-patch32":{"license":"MIT","weights":["onnx/vision_model_int8.onnx","onnx/text_model_int8.onnx"],"license_source":"https://raw.githubusercontent.com/openai/CLIP/main/LICENSE"},
"onnx-community/whisper-base.en":{"license":"MIT","weights":["onnx/encoder_model_quantized.onnx","onnx/decoder_model_merged_quantized.onnx"],"license_source":"https://raw.githubusercontent.com/openai/whisper/main/LICENSE"},
"Xenova/all-MiniLM-L6-v2":{"license":"Apache-2.0","weights":["onnx/model_quantized.onnx"],"license_source":"https://www.apache.org/licenses/LICENSE-2.0.txt"}}
out={}
for repo,info in repos.items():
    existing=[r for r in source if r.get("repo")==repo]
    if not existing:
        a=json.load(urllib.request.urlopen("https://huggingface.co/api/models/"+repo+"?blobs=true",timeout=30))
        existing=[]
        for f in a["siblings"]:
            file=f["rfilename"]
            if not (file in info["weights"] or ("/" not in file and file.endswith((".json",".txt")))):continue
            p=root/"models"/repo/file;p.parent.mkdir(parents=True,exist_ok=True)
            url=f"https://huggingface.co/{repo}/resolve/{a['sha']}/{file}"
            p.write_bytes(urllib.request.urlopen(url,timeout=90).read())
            existing.append({"repo":repo,"revision":a["sha"],"file":file,"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"url":url})
    selected=[r for r in existing if r["file"] in info["weights"] or ("/" not in r["file"] and r["file"].endswith((".json",".txt")))]
    out[repo]={**info,"revision":selected[0]["revision"],"files":[{k:r[k] for k in ["file","bytes","sha256","url"]} for r in selected]}
    print(repo,out[repo]["revision"],sum(f["bytes"] for f in out[repo]["files"]),flush=True)
(root/"default-model-pins.json").write_text(json.dumps(out,indent=2))
