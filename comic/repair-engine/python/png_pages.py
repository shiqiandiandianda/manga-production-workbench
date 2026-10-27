"""Read and write long 8-bit PNG pages in small bands, with bounded RAM."""
from __future__ import annotations

import io
import json
import uuid
from pathlib import Path
import struct
import zlib
import numpy as np

from PIL import Image

SIGNATURE = b'\x89PNG\r\n\x1a\n'
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
MODES = {0: 'L', 2: 'RGB', 3: 'P', 4: 'LA', 6: 'RGBA'}
BAND_ROWS = 256


def _chunk(kind: bytes, data: bytes):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def page_info(path: Path):
    with path.open('rb') as file:
        if file.read(8) != SIGNATURE:
            raise ValueError('不是 PNG 图片')
        if file.read(8) != b'\x00\x00\x00\rIHDR':
            raise ValueError('PNG 文件头不正确')
        header = file.read(13)
        width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', header)
        if not width or not height or compression or filtering:
            raise ValueError('PNG 图片尺寸或编码无效')
        return {'width': width, 'height': height, 'depth': depth, 'color': color, 'interlace': interlace}


def streamable(path: Path):
    info = page_info(path)
    return info['depth'] == 8 and info['color'] in CHANNELS and info['interlace'] == 0


def _scan(path: Path):
    info = page_info(path)
    extras, ranges = [], []
    with path.open('rb') as file:
        file.seek(8)
        while True:
            header = file.read(8)
            if len(header) != 8:
                raise ValueError('PNG 文件未完整写入')
            length, kind = struct.unpack('>I4s', header)
            start = file.tell()
            if kind == b'IDAT':
                ranges.append((start, length))
                file.seek(length, 1)
            elif kind in [b'PLTE', b'tRNS', b'iCCP', b'gAMA', b'sRGB', b'cHRM',b'pHYs']:
                if length > 4 * 1024 * 1024:
                    raise ValueError('PNG 色彩信息太大')
                extras.append(_chunk(kind, file.read(length)))
            else:
                file.seek(length, 1)
            if len(file.read(4)) != 4:
                raise ValueError('PNG 文件未完整写入')
            if kind == b'IEND':
                break
    if not ranges:
        raise ValueError('PNG 缺少像素数据')
    return info, extras, ranges


def bands(path: Path, row_count: int = BAND_ROWS):
    """Use Pillow's C PNG decoder on bounded bands, seeding prior-row filters."""
    info, extras, ranges = _scan(path)
    if info['depth'] != 8 or info['color'] not in CHANNELS or info['interlace']:
        raise ValueError('长页分段读取需要非交错的 8 位 PNG；导入时会转换其他编码')
    width, height, color = info['width'], info['height'], info['color']
    stride = width * CHANNELS[color]
    row_bytes = stride + 1
    target_bytes = min(row_count, height) * row_bytes
    decompressor = zlib.decompressobj()
    pending = bytearray()
    prior_row = None
    top = 0

    def decode(raw: bytes, count: int):
        nonlocal prior_row, top
        prefix = b'\x00' + prior_row if prior_row is not None else b''
        extra_row = 1 if prior_row is not None else 0
        header = struct.pack('>IIBBBBB', width, count + extra_row, 8, color, 0, 0, 0)
        encoded = SIGNATURE + _chunk(b'IHDR', header) + b''.join(extras) + _chunk(b'IDAT', zlib.compress(prefix + raw, 1)) + _chunk(b'IEND', b'')
        with Image.open(io.BytesIO(encoded)) as decoded:
            decoded.load()
            if decoded.mode != MODES[color]:
                raise ValueError('PNG 颜色编码不匹配')
            prior_row = decoded.crop((0, decoded.height - 1, width, decoded.height)).tobytes()
            result = decoded.crop((0, extra_row, width, count + extra_row)).convert('RGBA')
        offset = top
        top += count
        return offset, result

    with path.open('rb') as file:
        for start, length in ranges:
            file.seek(start)
            left = length
            while left:
                compressed = file.read(min(65536, left))
                if not compressed:
                    raise ValueError('PNG 像素数据不完整')
                left -= len(compressed)
                while compressed:
                    decoded = decompressor.decompress(compressed, max(1, target_bytes - len(pending)))
                    compressed = decompressor.unconsumed_tail
                    pending.extend(decoded)
                    if len(pending) == target_bytes:
                        count = target_bytes // row_bytes
                        yield decode(bytes(pending), count)
                        pending.clear()
                        if top < height:
                            target_bytes = min(row_count, height - top) * row_bytes
                        else:
                            target_bytes = row_bytes
                    elif not compressed:
                        break
    if top != height or pending or not decompressor.eof:
        raise ValueError('PNG 高度与像素数据不一致')


def write_page(path: Path, width: int, height: int, image_bands, extras=(),compress_level=3):
    compressor = zlib.compressobj(compress_level)
    rows = 0;previous_row=None
    with path.open('wb') as file:
        file.write(SIGNATURE + _chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)))
        for item in extras:
            if item[4:8] in [b'iCCP', b'gAMA', b'sRGB', b'cHRM',b'pHYs']:
                file.write(item)
        for top, image in image_bands:
            if top != rows or image.width != width:
                raise ValueError('漫画分段顺序或宽度不正确')
            pixels = image.convert('RGBA').tobytes()
            stride = width * 4
            if compress_level:
                raw=np.frombuffer(pixels,dtype=np.uint8).reshape(image.height,stride)
                sub=raw.copy();sub[:,4:]=np.subtract(raw[:,4:],raw[:,:-4],dtype=np.uint8)
                up=raw.copy()
                if previous_row is not None:up[0]=np.subtract(raw[0],previous_row,dtype=np.uint8)
                up[1:]=np.subtract(raw[1:],raw[:-1],dtype=np.uint8)
                sub_score=np.minimum(sub,np.subtract(0,sub,dtype=np.uint8)).sum(axis=1,dtype=np.uint64)
                up_score=np.minimum(up,np.subtract(0,up,dtype=np.uint8)).sum(axis=1,dtype=np.uint64)
                previous_row=raw[-1].copy()
            for row in range(image.height):
                filtered=(b'\x01'+sub[row].tobytes() if sub_score[row]<=up_score[row] else b'\x02'+up[row].tobytes()) if compress_level else b'\x00'+pixels[row*stride:(row+1)*stride]
                data = compressor.compress(filtered)
                if data:
                    file.write(_chunk(b'IDAT', data))
            rows += image.height
        if rows != height:
            raise ValueError('输出页高不正确')
        tail = compressor.flush()
        if tail:
            file.write(_chunk(b'IDAT', tail))
        file.write(_chunk(b'IEND', b''))


DISPLAY_ROWS = 1024


def display_tile(path: Path, revision: int, top: int, width: int, height: int):
    return path.parent / f'region-{revision}-0-{top}-{width}-{height}.png'


def display_revision(path: Path):
    if path.name == 'original.png':
        return 0
    if path.stem.startswith('revision-') and path.stem[9:].isdigit():
        return int(path.stem[9:])
    return None


def build_display_cache(path: Path):
    revision = display_revision(path)
    if revision is None:
        raise ValueError('显示缓存需要漫画原图或固定版本')
    info = page_info(path)
    metadata = path.stat()
    stamp = {'size': metadata.st_size, 'mtimeNs': metadata.st_mtime_ns, 'rows': DISPLAY_ROWS}
    manifest = path.parent / f'display-cache-{revision}.json'
    expected = [display_tile(path, revision, top, info['width'], min(DISPLAY_ROWS, info['height']-top)) for top in range(0, info['height'], DISPLAY_ROWS)]
    if manifest.exists():
        try:
            saved = json.loads(manifest.read_text('utf-8'))
            if saved.get('stamp') == stamp and all(tile.exists() for tile in expected):
                return {'cached': True, 'tiles': len(expected)}
        except (ValueError, OSError):
            pass
    for top, band in bands(path, DISPLAY_ROWS):
        file = display_tile(path, revision, top, band.width, band.height)
        temporary = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            band.save(temporary, 'PNG', compress_level=1)
            temporary.replace(file)
        finally:
            temporary.unlink(missing_ok=True)
    temporary = manifest.with_name(manifest.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps({'stamp': stamp, 'width': info['width'], 'height': info['height'], 'tiles': len(expected)}), encoding='utf-8')
    temporary.replace(manifest)
    return {'cached': False, 'tiles': len(expected)}


def extract(path: Path, crop: dict):
    info = page_info(path)
    x, y, width, height = (crop[key] for key in ['x', 'y', 'width', 'height'])
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > info['width'] or y + height > info['height']:
        raise ValueError('局部超出漫画原图')
    if width * height > 16_000_000:
        raise ValueError('单个修复区域最多支持 1600 万像素')
    result = Image.new('RGBA', (width, height))
    revision = display_revision(path)
    positions = list(range((y // DISPLAY_ROWS) * DISPLAY_ROWS, y + height, DISPLAY_ROWS))
    files = [display_tile(path, revision, top, info['width'], min(DISPLAY_ROWS, info['height']-top)) for top in positions] if revision is not None else []
    if files and all(file.exists() for file in files):
        for top, file in zip(positions, files):
            with Image.open(file) as tile:
                if tile.size != (info['width'], min(DISPLAY_ROWS, info['height']-top)):
                    break
                begin, end = max(top, y), min(top+tile.height, y+height)
                result.paste(tile.crop((x, begin-top, x+width, end-top)).convert('RGBA'), (0, begin-y))
        else:
            return result
    for top, band in bands(path):
        start, end = max(top, y), min(top + band.height, y + height)
        if start < end:
            result.paste(band.crop((x, start - top, x + width, end - top)), (0, start - y))
        if top + band.height >= y + height:
            break
    return result


def make_preview(path: Path, output: Path, max_edge: int = 4096, prepare_display: bool = False):
    info = page_info(path)
    scale = min(1, max_edge / max(info['width'], info['height']))
    width, height = max(1, round(info['width'] * scale)), max(1, round(info['height'] * scale))
    result = Image.new('RGBA', (width, height))
    for top, band in bands(path, DISPLAY_ROWS if prepare_display else BAND_ROWS):
        if prepare_display:
            file = display_tile(path, display_revision(path), top, band.width, band.height)
            temporary = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
            try:
                band.save(temporary, 'PNG', compress_level=1)
                temporary.replace(file)
            finally:
                temporary.unlink(missing_ok=True)
        begin = round(top * scale)
        end = min(height, round((top + band.height) * scale))
        if end > begin:
            result.paste(band.resize((width, end - begin), Image.Resampling.LANCZOS), (0, begin))
    result.save(output, 'PNG')
    if prepare_display:
        metadata = path.stat()
        manifest = path.parent / f'display-cache-{display_revision(path)}.json'
        temporary = manifest.with_name(manifest.name + '.' + uuid.uuid4().hex + '.tmp')
        temporary.write_text(json.dumps({'stamp': {'size': metadata.st_size, 'mtimeNs': metadata.st_mtime_ns, 'rows': DISPLAY_ROWS}, 'width': info['width'], 'height': info['height'], 'tiles': (info['height']+DISPLAY_ROWS-1)//DISPLAY_ROWS}), encoding='utf-8')
        temporary.replace(manifest)
    return width, height


def paste_page(base_path: Path, output_path: Path, patch: Image.Image, crop: dict, mask: Image.Image, feather: int = 0, feather_mode: str = 'gaussian'):
    from repair_pipeline import paste_patch
    info, extras, _ = _scan(base_path)
    original_crop = extract(base_path, crop)
    local = {'x': 0, 'y': 0, 'width': crop['width'], 'height': crop['height']}
    repaired_crop = paste_patch(original_crop, patch, local, mask, feather, feather_mode)

    def replaced():
        for top, band in bands(base_path):
            begin = max(top, crop['y'])
            end = min(top + band.height, crop['y'] + crop['height'])
            if begin < end:
                piece = repaired_crop.crop((0, begin - crop['y'], crop['width'], end - crop['y']))
                band.paste(piece, (crop['x'], begin - top))
            yield top, band
    write_page(output_path, info['width'], info['height'], replaced(), extras)
