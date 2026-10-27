"""Keep alpha out of Vulkan inference and validate new upscale output before use."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageOps


def validate(source, result, scale=None, opaque=False):
    original = ImageOps.exif_transpose(Image.open(source)).convert('RGBA')
    image = Image.open(result).convert('RGBA')
    image.load()
    if scale and image.size != (original.width * scale, original.height * scale):
        raise ValueError('高清结果尺寸不正确，未应用结果，原图保留')
    alpha = image.getchannel('A')
    if not alpha.getbbox():
        raise ValueError('高清结果全透明，未应用结果，原图保留')
    if opaque and alpha.getextrema() != (255, 255):
        raise ValueError('高清模型返回了异常透明通道，未应用结果，原图保留')
    before = original.convert('RGB').getextrema()
    after = image.convert('RGB').getextrema()
    if max(hi - lo for lo, hi in before) > 8 and max(hi - lo for lo, hi in after) < 2:
        raise ValueError('高清结果没有有效画面，未应用结果，原图保留')
    return original, image


def process(phase, source, output, scale=None, model_output=None):
    if phase == 'prepare':
        image = ImageOps.exif_transpose(Image.open(source)).convert('RGBA')
        if not image.getchannel('A').getbbox():
            raise ValueError('原图全透明，无法高清放大')
        image.convert('RGB').save(output)
        return {'width': image.width, 'height': image.height}
    if phase == 'finish':
        original, result = validate(source, model_output, scale, opaque=True)
        # Only resample the original alpha; inference never invents an alpha channel.
        alpha = original.getchannel('A')
        if alpha.getextrema() != (255, 255):
            result.putalpha(alpha.resize(result.size, Image.Resampling.LANCZOS))
        else:
            result = result.convert('RGB')
        result.save(output)
    else:
        _, result = validate(source, output, scale)
    return {'width': result.width, 'height': result.height}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['prepare', 'finish', 'validate'], required=True)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--model-output')
    parser.add_argument('--scale', type=int)
    args = parser.parse_args()
    print(json.dumps(process(args.phase, args.input, args.output, args.scale, args.model_output)))
