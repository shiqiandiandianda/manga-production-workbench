"""Bounded-memory local ONNX upscaling. RGB inference; original alpha retained."""
import argparse
import ctypes
import gc
import json
import os
from pathlib import Path
import time
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

def available_memory_bytes():
    """Windows allocations are also bounded by the remaining commit limit."""
    if os.name != 'nt':
        return None
    class MemoryStatus(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong) for name in
            ('totalPhys', 'availPhys', 'totalPageFile', 'availPageFile',
             'totalVirtual', 'availVirtual', 'availExtendedVirtual')]
    status = MemoryStatus()
    status.length = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return None
    return min(status.availPhys, status.availPageFile)

def memory_tile(tile, available):
    if available is None:
        return tile
    ceiling = 64 if available < 2 * 1024**3 else 128 if available < 4 * 1024**3 else 192
    return min(tile, ceiling)

def upscale(source, destination, model, scale, tile=192, overlap=32, provider='auto'):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve():
        raise ValueError('不能覆盖原图')
    image = ImageOps.exif_transpose(Image.open(source)).convert('RGBA')
    if not image.getchannel('A').getbbox():
        raise ValueError('原图全透明，无法高清放大')
    if image.width * image.height * scale * scale > 100_000_000:
        raise ValueError('本次输出超过一亿像素')
    requested_tile = tile
    available = available_memory_bytes()
    tile = memory_tile(tile, available)
    print(json.dumps({'tile': tile, 'requestedTile': requested_tile,
                      'availableMemoryBytes': available}), flush=True)
    options = ort.SessionOptions()
    options.enable_mem_pattern = False
    options.enable_cpu_mem_arena = False
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    # One fixed input shape keeps DirectML from compiling/caching edge shapes
    # throughout a large image. The FDAT model names its free axes height/width.
    padded_size = ((tile + 2 * overlap + 63) // 64) * 64
    options.add_free_dimension_override_by_name('height', padded_size)
    options.add_free_dimension_override_by_name('width', padded_size)
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.log_severity_level = 3
    providers = ['DmlExecutionProvider', 'CPUExecutionProvider'] if provider != 'cpu' and 'DmlExecutionProvider' in ort.get_available_providers() else ['CPUExecutionProvider']
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
            patch = np.pad(patch, ((0,padded_size-h),(0,padded_size-w),(0,0)), mode='edge')
            data = np.ascontiguousarray(patch.transpose(2,0,1)[None],dtype=dtype)/dtype(255)
            result = session.run(None,{inp.name:data})[0]
            if result.shape != (1,3,patch.shape[0]*scale,patch.shape[1]*scale) or not np.isfinite(result).all():
                raise ValueError('高清模型输出尺寸或像素无效')
            crop = result[0,:,(y-top)*scale:(bottom-top)*scale,(x-left)*scale:(right-left)*scale]
            crop = np.rint(np.clip(crop.transpose(1,2,0).astype(np.float32),0,1)*255).astype(np.uint8)
            output.paste(Image.fromarray(crop),(x*scale,y*scale))
            del result, crop, data, patch
            done += 1
            print(json.dumps({'progress':done,'total':total,'percent':round(done*100/total,1)}),flush=True)
            # Bound native-session allocations over long images on small-memory PCs.
            # A finished tile is already in the output; rebuilding cannot alter it.
            if tile <= 64 and done % 16 == 0 and done < total:
                del inp, session
                gc.collect()
                session = ort.InferenceSession(str(model), sess_options=options, providers=providers)
                inp = session.get_inputs()[0]
    if max(high-low for low,high in image.convert('RGB').getextrema())>8 and max(high-low for low,high in output.getextrema())<2:
        raise ValueError('高清结果没有有效画面')
    alpha = image.getchannel('A')
    if alpha.getextrema() != (255,255):
        output.putalpha(alpha.resize(output.size,Image.Resampling.LANCZOS))
    pending = destination.with_name(destination.stem+'.pending.png')
    output.save(pending)
    pending.replace(destination)
    return {'width':output.width,'height':output.height,'seconds':round(time.monotonic()-started,3),'providers':session.get_providers(),'tile':tile}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('input','output','model'):
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--scale',type=int,choices=[2],default=2)
    parser.add_argument('--tile',type=int,default=192)
    parser.add_argument('--overlap',type=int,default=32)
    parser.add_argument('--provider',choices=['auto','cpu'],default='auto')
    args=parser.parse_args()
    if args.tile<32 or args.overlap<0:
        raise ValueError('分块参数无效')
    print(json.dumps(upscale(args.input,args.output,args.model,args.scale,args.tile,args.overlap,args.provider)),flush=True)
