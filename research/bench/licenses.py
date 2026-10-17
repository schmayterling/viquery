import pathlib,urllib.request,json
root=pathlib.Path(__file__).resolve().parents[1]/"raw"/"licenses"
root.mkdir(parents=True,exist_ok=True)
sources={
"openai-clip-MIT.txt":"https://raw.githubusercontent.com/openai/CLIP/main/LICENSE",
"siglip-Apache-2.0.txt":"https://www.apache.org/licenses/LICENSE-2.0.txt",
"mobileclip-research-only.txt":"https://raw.githubusercontent.com/apple/ml-mobileclip/main/LICENSE_MODELS",
"tinyclip-MIT.txt":"https://raw.githubusercontent.com/wkcn/TinyCLIP/main/LICENSE",
"florence2-MIT.txt":"https://huggingface.co/microsoft/Florence-2-base-ft/resolve/main/LICENSE",
"smolvlm2-Apache-2.0.txt":"https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct/resolve/main/LICENSE",
"whisper-MIT.txt":"https://raw.githubusercontent.com/openai/whisper/main/LICENSE",
"qwen25vl3b-research.txt":"https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/resolve/main/LICENSE",
"qwen3vl2b-Apache-2.0.txt":"https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct/resolve/main/LICENSE",
"moondream3-BSL.txt":"https://huggingface.co/moondream/moondream3-preview/resolve/main/LICENSE.md",
}
manifest=[]
for file,url in sources.items():
    try:
        data=urllib.request.urlopen(url,timeout=30).read();(root/file).write_bytes(data)
        manifest.append({"file":file,"url":url,"bytes":len(data)});print(file,len(data),flush=True)
    except Exception as e:print(file,str(e),flush=True)
(root/"manifest.json").write_text(json.dumps(manifest,indent=2))
