"""Bounded-memory local ONNX upscaling. RGB inference; original alpha retained."""
import argparse
import json
from pathlib import Path
import time
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

def upscale(source, destination, model, scale, tile=192, overlap=32):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve():
        raise ValueError('不能覆盖原图')
    image = ImageOps.exif_transpose(Image.open(source)).convert('RGBA')
    if not image.getchannel('A').getbbox():
        raise ValueError('原图全透明，无法高清放大')
    if image.width * image.height * scale * scale > 100_000_000:
        raise ValueError('本次输出超过一亿像素')
    options = ort.SessionOptions()
    options.enable_mem_pattern = False
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.log_severity_level = 3
    providers = ['DmlExecutionProvider', 'CPUExecutionProvider'] if 'DmlExecutionProvider' in ort.get_available_providers() else ['CPUExecutionProvider']
    session = ort.InferenceSession(str(model), sess_options=options, providers=providers)
    inp = session.get_inputs()[0]
    if inp.type not in ('tensor(float)', 'tensor(float16)'):
        raise ValueError('模型输入精度不兼容')
    dtype = np.float16 if inp.type == 'tensor(float16)' else np.float32
    original = np.asarray(image.convert('RGB'))
    output = Image.new('RGB', (image.width*scale, image.height*scale))
    total = ((image.width+tile-1)//tile)*((image.height+tile-1)//tile)
    started = time.monotonic()
    done = 0
    print(json.dumps({'providers':session.get_providers(), 'tiles':total}), flush=True)
    for y in range(0, image.height, tile):
        for x in range(0, image.width, tile):
            right, bottom = min(x+tile,image.width), min(y+tile,image.height)
            left, top = max(0,x-overlap), max(0,y-overlap)
            far_right, far_bottom = min(image.width,right+overlap), min(image.height,bottom+overlap)
            patch = original[top:far_bottom,left:far_right]
            h,w = patch.shape[:2]
            # FDAT attention/unshuffle windows require a multiple of 64.
            patch = np.pad(patch, ((0,(-h)%64),(0,(-w)%64),(0,0)), mode='edge')
            data = np.ascontiguousarray(patch.transpose(2,0,1)[None],dtype=dtype)/dtype(255)
            result = session.run(None,{inp.name:data})[0]
            if result.shape != (1,3,patch.shape[0]*scale,patch.shape[1]*scale) or not np.isfinite(result).all():
                raise ValueError('高清模型输出尺寸或像素无效')
            crop = result[0,:,(y-top)*scale:(bottom-top)*scale,(x-left)*scale:(right-left)*scale]
            crop = np.rint(np.clip(crop.transpose(1,2,0).astype(np.float32),0,1)*255).astype(np.uint8)
            output.paste(Image.fromarray(crop),(x*scale,y*scale))
            done += 1
            print(json.dumps({'progress':done,'total':total,'percent':round(done*100/total,1)}),flush=True)
    if max(high-low for low,high in image.convert('RGB').getextrema())>8 and max(high-low for low,high in output.getextrema())<2:
        raise ValueError('高清结果没有有效画面')
    alpha = image.getchannel('A')
    if alpha.getextrema() != (255,255):
        output.putalpha(alpha.resize(output.size,Image.Resampling.LANCZOS))
    pending = destination.with_name(destination.stem+'.pending.png')
    output.save(pending)
    pending.replace(destination)
    return {'width':output.width,'height':output.height,'seconds':round(time.monotonic()-started,3),'providers':session.get_providers()}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('input','output','model'):
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--scale',type=int,choices=[2],default=2)
    parser.add_argument('--tile',type=int,default=192)
    parser.add_argument('--overlap',type=int,default=32)
    args=parser.parse_args()
    if args.tile<32 or args.overlap<0:
        raise ValueError('分块参数无效')
    print(json.dumps(upscale(args.input,args.output,args.model,args.scale,args.tile,args.overlap)),flush=True)
