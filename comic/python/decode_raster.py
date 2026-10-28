"""Write a native-canvas-compatible PNG copy of a raster image."""
import argparse
from pathlib import Path
from PIL import Image, ImageOps

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
source, target = Path(args.input), Path(args.output)
if source.resolve() == target.resolve():
    raise ValueError('不能覆盖原文件')
with Image.open(source) as image:
    if image.format not in ('PNG', 'JPEG', 'WEBP', 'GIF'):
        raise ValueError('只支持位图兼容解码')
    if image.width * image.height > 100_000_000:
        raise ValueError('图片超过一亿像素')
    image.load()
    ImageOps.exif_transpose(image).convert('RGBA').save(target, format='PNG')
