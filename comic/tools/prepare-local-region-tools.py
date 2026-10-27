"""Install only task-specific wheels/models inside the D-drive portable runtime."""
import json,hashlib,urllib.request,zipfile,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
runtime=root/'.runtime/image-tools';cache=runtime/'cache';extras=runtime/'extras';models=runtime/'AI工具/models'
for p in [cache,extras,models]: p.mkdir(parents=True,exist_ok=True)
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def download(url,target,sha):
 if target.exists() and digest(target)==sha:return
 temp=target.with_suffix(target.suffix+'.download')
 with urllib.request.urlopen(url,timeout=60) as response,temp.open('wb') as f:
  size=0
  while b:=response.read(1024*1024):
   f.write(b);size+=len(b)
   if size%(25*1024*1024)<1024*1024:print(target.name,size//(1024*1024),'MB',flush=True)
 if digest(temp)!=sha:raise ValueError('Downloaded file SHA256 mismatch')
 temp.replace(target)
metadata=json.load(urllib.request.urlopen('https://pypi.org/pypi/opencv-python-headless/4.12.0.88/json',timeout=30))
wheel=next(f for f in metadata['urls'] if 'cp37-abi3-win_amd64' in f['filename']);package=cache/wheel['filename'];download(wheel['url'],package,wheel['digests']['sha256'])
with zipfile.ZipFile(package) as z:
 for n in z.namelist():
  if not (extras/n).resolve().is_relative_to(extras.resolve()):raise ValueError('Invalid wheel path')
 z.extractall(extras)
tree=json.load(urllib.request.urlopen('https://huggingface.co/api/models/Carve/LaMa-ONNX/tree/main?expand=true',timeout=30));record=next(f for f in tree if f['path']=='lama_fp32.onnx');url='https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx?download=true';target=models/'lama_fp32.onnx';download(url,target,record['lfs']['oid'])
info={'model':'LaMa ONNX FP32','source':url,'sha256':digest(target),'bytes':target.stat().st_size,'license':'Apache-2.0','opencv':{'version':'4.12.0.88','sha256':wheel['digests']['sha256'],'source':wheel['url']}}
(models/'local-region-tools-source.json').write_text(json.dumps(info,indent=2),encoding='utf-8');sys.path.insert(0,str(extras));import cv2,onnxruntime as ort
session=ort.InferenceSession(str(target),providers=['CPUExecutionProvider']);print(json.dumps({'ready':True,'cv2':cv2.__version__,'inputs':[(i.name,i.shape,i.type) for i in session.get_inputs()],'outputs':[(i.name,i.shape,i.type) for i in session.get_outputs()],'provenance':info}),flush=True)
