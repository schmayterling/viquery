import pathlib,urllib.request,json,hashlib
root=pathlib.Path(__file__).resolve().parents[1]/"raw"
repo="onnx-community/whisper-base.en"
a=json.load(urllib.request.urlopen("https://huggingface.co/api/models/"+repo+"?blobs=true"))
manifest=[]
for f in a["siblings"]:
    file=f["rfilename"]
    if not (("/" not in file and file.endswith((".json",".txt",".md"))) or file in ["onnx/encoder_model_quantized.onnx","onnx/decoder_model_merged_quantized.onnx"]):continue
    p=root/"models"/repo/file;p.parent.mkdir(parents=True,exist_ok=True)
    url=f"https://huggingface.co/{repo}/resolve/{a['sha']}/{file}"
    with urllib.request.urlopen(url,timeout=90) as res:p.write_bytes(res.read())
    manifest.append({"repo":repo,"revision":a["sha"],"file":file,"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"url":url})
    print(file,p.stat().st_size,flush=True)
audio=root/"audio"/"jfk.flac";audio.parent.mkdir(parents=True,exist_ok=True)
url="https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac"
audio.write_bytes(urllib.request.urlopen(url,timeout=30).read())
manifest.append({"file":"audio/jfk.flac","url":url,"sha256":hashlib.sha256(audio.read_bytes()).hexdigest()})
(root/"asr-model-manifest.json").write_text(json.dumps(manifest,indent=2))
