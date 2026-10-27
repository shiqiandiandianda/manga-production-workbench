"""Local U2-Net CPU inference; preprocessing follows rembg's U2netSession.
No rembg or PyTorch dependency. Output is always a new PNG.
"""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/".runtime/image-tools/extras"))
import numpy as np
from PIL import Image,ImageOps,ImageChops
import onnxruntime as ort

def cutout(source,target,model):
    original=ImageOps.exif_transpose(Image.open(source)).convert('RGBA')
    image=original.convert('RGB').resize((320,320),Image.Resampling.LANCZOS)
    array=np.asarray(image).astype(np.float32)
    array/=max(float(array.max()),1e-6)
    array=(array-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)
    tensor=array.transpose(2,0,1)[None].astype(np.float32)
    options=ort.SessionOptions();options.intra_op_num_threads=4
    session=ort.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider'])
    prediction=session.run(None,{session.get_inputs()[0].name:tensor})[0][0,0]
    lo,hi=float(prediction.min()),float(prediction.max())
    prediction=(prediction-lo)/max(hi-lo,1e-8)
    mask=Image.fromarray((prediction.clip(0,1)*255).astype(np.uint8)).resize(original.size,Image.Resampling.LANCZOS)
    original.putalpha(ImageChops.multiply(original.getchannel('A'),mask))
    original.save(target)
    return {'width':original.width,'height':original.height,'provider':session.get_providers(),'alphaRange':list(original.getchannel('A').getextrema())}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);parser.add_argument('--model',required=True)
    args=parser.parse_args();Path(args.output).parent.mkdir(parents=True,exist_ok=True)
    print(json.dumps(cutout(args.input,args.output,args.model)))
