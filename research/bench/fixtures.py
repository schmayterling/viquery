"""ten public-domain / cc0 images, licensed as documented by scikit-image."""
import pathlib, urllib.request, json, hashlib
root=pathlib.Path(__file__).resolve().parents[1]/"raw"/"images"
root.mkdir(parents=True,exist_ok=True)
items=[
("astronaut.png","an astronaut in a spacesuit","public domain; NASA"),
("coffee.png","a cup of coffee on a wooden table","CC0; Rachel Michetti"),
("chelsea.png","a close up photo of a cat","CC0; Stefan van der Walt"),
("rocket.jpg","a rocket launching at night","public domain; SpaceX"),
("hubble_deep_field.jpg","distant galaxies and stars in outer space","public domain; NASA"),
("horse.png","a black and white silhouette of a horse","CC0; Andreas Preuss"),
("camera.png","a person taking a photograph with a camera","CC0; Lav Varshney"),
("brick.png","a brick wall","CC0; CC0Textures"),
("grass.png","grass growing on the ground","CC0; linolafett"),
("gravel.png","a pile of rocks and gravel","CC0; CC0Textures")]
manifest=[]
for file,query,license in items:
    for base in ["https://raw.githubusercontent.com/scikit-image/scikit-image/v0.24.0/skimage/data/","https://raw.githubusercontent.com/scikit-image/scikit-image/v0.19.3/skimage/data/","https://raw.githubusercontent.com/scikit-image/scikit-image/data-moved/skimage/data/"]:
        try:
            url=base+file
            data=urllib.request.urlopen(url,timeout=30).read()
            (root/file).write_bytes(data)
            manifest.append({"file":file,"query":query,"license":license,"url":url,"sha256":hashlib.sha256(data).hexdigest()})
            print(file,len(data),flush=True)
            break
        except Exception:continue
    else: raise RuntimeError("image unavailable: "+file)
(root/"manifest.json").write_text(json.dumps(manifest,indent=2))
