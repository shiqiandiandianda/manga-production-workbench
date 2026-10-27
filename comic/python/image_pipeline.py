"""Deterministic crop / ratio check / masked paste. Original files are retained."""
from __future__ import annotations
from pathlib import Path
import math
from PIL import Image, ImageDraw, ImageFilter, ImageOps


def open_image(path: str | Path) -> Image.Image:
    with Image.open(path) as source:
        if source.width * source.height > 100_000_000:
            raise ValueError("图片像素过多")
        source.load()
        return ImageOps.exif_transpose(source).convert("RGBA")


def validate_box(box, image_size):
    if not isinstance(box, list) or len(box) != 4 or any(not isinstance(v, int) for v in box):
        raise ValueError("裁切区域需要四个整数：x, y, width, height")
    x, y, width, height = box
    if x < 0 or y < 0 or width < 1 or height < 1 or x + width > image_size[0] or y + height > image_size[1]:
        raise ValueError("裁切区域超出原图范围")
    return x, y, width, height


def crop_page(base_path, box, destination):
    image = open_image(base_path)
    x, y, width, height = validate_box(box, image.size)
    image.crop((x, y, x + width, y + height)).save(destination, "PNG")
    return (width, height)


def align_patch(patch_path, target_size, destination, tolerance=0.02):
    patch = open_image(patch_path)
    width, height = target_size
    if width < 1 or height < 1:
        raise ValueError("目标格子尺寸无效")
    deviation = abs((patch.width / patch.height) / (width / height) - 1)
    if deviation > tolerance:
        raise ValueError(f"生成图 {patch.width}×{patch.height} 与格子 {width}×{height} 的宽高比相差 {deviation:.1%}；原图与生成图均已保留，请调整提示词后重绘。")
    patch.resize((width, height), Image.Resampling.LANCZOS).save(destination, "PNG")
    return {"sourceWidth": patch.width, "sourceHeight": patch.height, "targetWidth": width, "targetHeight": height, "ratioDeviation": deviation}


def paste_patch(base_path, aligned_path, box, polygon, destination, feather=0, border=0):
    base = open_image(base_path)
    x, y, width, height = validate_box(box, base.size)
    patch = open_image(aligned_path)
    if patch.size != (width, height):
        raise ValueError("贴回图片尺寸不等于目标区域尺寸")
    # Four-times supersampling keeps diagonal mask edges smooth.
    supersample = 4
    mask = Image.new("L", (width * supersample, height * supersample), 0)
    if polygon:
        if len(polygon) < 3 or any(len(p) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in p) for p in polygon):
            raise ValueError("蒙版节点无效")
        coordinates = [((p[0] - x) * supersample, (p[1] - y) * supersample) for p in polygon]
        ImageDraw.Draw(mask).polygon(coordinates, fill=255)
    else:
        mask.paste(255, (0, 0, width * supersample, height * supersample))
    mask = mask.resize((width, height), Image.Resampling.LANCZOS)
    if border > 0:
        radius = min(10, max(1, math.ceil(border / 2)))
        padded = ImageOps.expand(mask, border=radius, fill=0)
        mask = padded.filter(ImageFilter.MinFilter(radius * 2 + 1)).crop((radius, radius, radius + width, radius + height))
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(min(feather, min(width, height) / 3)))
    original_region = base.crop((x, y, x + width, y + height))
    composited = Image.alpha_composite(original_region, patch)
    base.paste(composited, (x, y), mask)
    base.save(destination, "PNG")
    return {"width": base.width, "height": base.height, "pasteX": x, "pasteY": y}
