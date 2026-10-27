#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""场景双图：正视图 + 反打场景图（V0.2 版式）。

场景资产只要两张图，其他一律不要：

    1. 正视图   SCENE_<场景ID>_<场景名>_front_<时间>_<天气>_v<版本>.png
    2. 反打图   SCENE_<场景ID>_<场景名>_ots_reverse_<时间>_<天气>_v<版本>.png

不再输出：平面图、站位图、A/B/C 机位箭头、北向、图例、细节列、拼版卡。
镜头位编号（front / ots_reverse）只进文件名，不画进画面。

脚本只做三件事：

* 裁掉生成图的白边（``--no-trim`` 可关）
* 把两张图规整到同一画布尺寸——同一场景的正视图和反打图必须同尺寸，
  否则并排看对不上、切镜头会跳
* 按上面标准命名落盘

约定：不联网、不调用任何 AI 接口、不生成/修补画面内容、不烧字、不出现人物。

用法::

    # 正式拼版：两张图 → 两个标准命名的 PNG
    python tools/scene-card.py \\
        --front   data/scene-assets/SC003/front.png \\
        --reverse data/scene-assets/SC003/reverse.png \\
        --id SC003 --name 预备杂役宿舍 --time 夜晚 --weather 室内 \\
        --outdir data/scene-assets/SC003

    # 占位图试跑：本地画两张占位图，跑通尺寸/命名
    python tools/scene-card.py --demo --id SC003 --name 预备杂役宿舍 \\
        --time 夜晚 --weather 室内 --outdir data/scene-assets/test

默认画布按原图比例（生成端场景图通常是 1536×1024，3:2），需要统一成别的比例时
加 ``--aspect 16:9``（配合 ``--fit cover`` 裁切或 ``--fit contain`` 留边）。
"""

from __future__ import annotations

import argparse
import math
import os
import re
import sys
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

WHITE = (255, 255, 255)

# 标准里的机位代号（只用于文件名）
ANGLE_FRONT = 'front'
ANGLE_REVERSE = 'ots_reverse'

FONT_REGULAR = ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/simsun.ttc')
FONT_BOLD = ('C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf')

ASPECT_RE = re.compile(r'^\s*(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)\s*$')


# ---------------------------------------------------------------- 基础工具


@lru_cache(maxsize=64)
def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in (FONT_BOLD if bold else FONT_REGULAR):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def load_image(path: str) -> Image.Image:
    image = Image.open(path)
    image.load()
    if image.mode in ('RGBA', 'LA', 'P', 'PA'):
        image = image.convert('RGBA')
        flat = Image.new('RGB', image.size, WHITE)
        flat.paste(image, mask=image.split()[-1])
        return flat
    return image.convert('RGB')


def trim_white(image: Image.Image, pad: int = 8) -> Image.Image:
    """裁掉纯白边（生成图常带白边），没有可裁内容时原样返回。"""
    mask = image.convert('L').point(lambda value: 255 if value < 245 else 0)
    box = mask.getbbox()
    if not box:
        return image
    left, top, right, bottom = box
    return image.crop((
        max(0, left - pad),
        max(0, top - pad),
        min(image.width, right + pad),
        min(image.height, bottom + pad),
    ))


def place(image: Image.Image, size, mode: str):
    """把图片规整到 size，返回 (图片, 缩放比, 留边/裁切说明)。"""
    width, height = size
    scale = max(width / image.width, height / image.height) if mode == 'cover' \
        else min(width / image.width, height / image.height)
    new_w = max(1, int(round(image.width * scale)))
    new_h = max(1, int(round(image.height * scale)))
    resized = image.resize((new_w, new_h), Image.LANCZOS)

    if mode == 'cover':
        left = max(0, (new_w - width) // 2)
        top = max(0, (new_h - height) // 2)
        note = f'裁切 {max(0, new_w - width)}×{max(0, new_h - height)}px'
        return resized.crop((left, top, left + width, top + height)), scale, note

    canvas = Image.new('RGB', (width, height), WHITE)
    canvas.paste(resized, ((width - new_w) // 2, (height - new_h) // 2))
    note = f'留边 {(width - new_w) // 2 * 2}×{(height - new_h) // 2 * 2}px'
    return canvas, scale, note


def sanitize(text: str) -> str:
    """文件名安全化：路径分隔符、冒号、竖线、空白等换成 -。"""
    cleaned = re.sub(r'[\\/:*?"<>|\s｜]+', '-', (text or '').strip())
    return cleaned.strip('-_')


def build_filename(scene_id: str, name: str, angle: str, time_label: str,
                   weather: str, version) -> str:
    parts = ['SCENE']
    for value in (scene_id, name):
        token = sanitize(value)
        if token:
            parts.append(token)
    parts.append(angle)
    for value in (time_label, weather):
        token = sanitize(value)
        if token:
            parts.append(token)
    parts.append(f'v{version}')
    return '_'.join(parts) + '.png'


def parse_aspect(text: str):
    """'source' → None；'16:9' / '3:2' → 宽高比。"""
    if text.strip().lower() in ('source', 'src', '原图'):
        return None
    match = ASPECT_RE.match(text)
    if not match:
        raise ValueError(text)
    numerator, denominator = float(match.group(1)), float(match.group(2))
    if numerator <= 0 or denominator <= 0:
        raise ValueError(text)
    return numerator / denominator


def difference(left: Image.Image, right: Image.Image) -> float:
    """两张图缩略后的灰度差（0..255），用来发现「反打图其实是同一张」。"""
    left_small = left.convert('L').resize((64, 64), Image.BILINEAR)
    right_small = right.convert('L').resize((64, 64), Image.BILINEAR)
    left_px, right_px = left_small.load(), right_small.load()
    total = 0
    for y in range(64):
        for x in range(64):
            total += abs(left_px[x, y] - right_px[x, y])
    return total / (64 * 64)


# ---------------------------------------------------------------- 占位图
# 只在 --demo 时用：按 SC003 的房间（420×340cm，门在西南、窗在东墙）画两张占位。

def _room_shell():
    """正视图/反打图共用的房间外框，保证两张占位图是同一空间。"""
    width, height = 1536, 1024
    image = Image.new('RGB', (width, height), (32, 36, 46))
    draw = ImageDraw.Draw(image)
    bx0, by0, bx1, by1 = 340, 150, 1196, 742

    draw.polygon([(0, 0), (bx0, by0), (bx1, by0), (width, 0)], fill=(44, 48, 58))       # 天花
    draw.polygon([(0, 0), (bx0, by0), (bx0, by1), (0, height)], fill=(62, 66, 76))     # 西墙
    draw.polygon([(width, 0), (bx1, by0), (bx1, by1), (width, height)], fill=(84, 88, 100))  # 东墙
    draw.rectangle([bx0, by0, bx1, by1], fill=(92, 94, 104))                           # 端墙
    draw.polygon([(0, height), (bx0, by1), (bx1, by1), (width, height)], fill=(74, 66, 58))  # 地面
    return image, draw, (bx0, by0, bx1, by1)


def _watermark(draw, text: str):
    draw.rectangle([56, 848, 760, 944], fill=(12, 16, 22))
    draw.text((78, 862), text, font=font(34, True), fill=(240, 244, 248))
    draw.text((78, 906), '无人物 · 仅用于拼版试跑，不是正式场景资产',
              font=font(22), fill=(170, 180, 194))


def draw_front_placeholder(tag: str) -> Image.Image:
    """正视图占位：机位在南侧朝北，画面为北墙（床 + 书架 + 垂旗）+ 东墙窗与书桌。"""
    image, draw, (bx0, by0, bx1, by1) = _room_shell()

    # 东墙 W1 窗（窗台 90，中段）+ 窗下书桌
    draw.polygon([(1300, 250), (1480, 330), (1480, 566), (1300, 470)],
                 fill=(200, 214, 234), outline=(150, 158, 172))
    for t in (0.34, 0.67):
        draw.line([(1300 + 180 * t, 250 + 80 * t), (1300 + 180 * t, 470 + 96 * t)],
                  fill=(150, 158, 172), width=3)
    draw.line([(1300, 360), (1480, 448)], fill=(150, 158, 172), width=3)

    draw.polygon([(1250, 632), (1480, 706), (1480, 760), (1244, 686)],
                 fill=(122, 98, 74), outline=(92, 74, 56))
    draw.polygon([(1244, 686), (1480, 760), (1480, 838), (1240, 764)],
                 fill=(98, 78, 60), outline=(84, 66, 50))
    draw.polygon([(1330, 700), (1392, 720), (1392, 736), (1330, 716)], fill=(236, 228, 210))

    # 北墙：床（西段）+ 书架（东段）+ 垂旗
    draw.rectangle([400, 556, 432, 700], fill=(104, 84, 62))
    draw.rectangle([400, 620, 770, 700], fill=(96, 84, 70), outline=(120, 100, 78))
    draw.rectangle([412, 566, 758, 646], fill=(72, 92, 126), outline=(108, 128, 160))
    draw.rectangle([424, 578, 560, 626], fill=(226, 228, 232), outline=(180, 184, 192))
    draw.rectangle([640, 600, 758, 640], fill=(238, 238, 240), outline=(190, 192, 198))

    draw.rectangle([880, 500, 1130, 742], fill=(106, 82, 58), outline=(132, 104, 74))
    for y in (560, 620, 680):
        draw.line([(882, y), (1128, y)], fill=(140, 112, 80), width=3)
    for x in (960, 1040):
        draw.line([(x, 502), (x, 740)], fill=(140, 112, 80), width=3)

    draw.rectangle([886, 300, 1064, 486], fill=(238, 240, 244), outline=(58, 84, 140), width=6)
    for offset in (0, 46):
        draw.line([(900, 356 + offset), (1000, 340 + offset), (1050, 352 + offset)],
                  fill=(58, 84, 140), width=4)

    # 梁下吊灯
    draw.line([(768, 150), (768, 258)], fill=(120, 104, 84), width=4)
    draw.ellipse([724, 258, 812, 346], fill=(240, 218, 172), outline=(150, 120, 80), width=3)
    for angle in (0, 60, 120):
        rad = math.radians(angle)
        draw.line([(768 - 44 * math.cos(rad), 302 - 44 * math.sin(rad)),
                   (768 + 44 * math.cos(rad), 302 + 44 * math.sin(rad))],
                  fill=(150, 120, 80), width=2)

    _watermark(draw, f'占位图 · 正视图 · {tag}')
    return image


def draw_reverse_placeholder(tag: str) -> Image.Image:
    """反打占位：机位在北侧朝南，画面为南墙（西南木门）+ 东墙窗的背光。"""
    image, draw, (bx0, by0, bx1, by1) = _room_shell()

    # 东墙（画面左侧）窗背面暗光
    draw.polygon([(40, 320), (300, 250), (300, 470), (40, 610)],
                 fill=(132, 146, 166), outline=(104, 114, 130))
    for t in (0.34, 0.67):
        draw.line([(40 + 260 * t, 320 - 70 * t), (40 + 260 * t, 610 - 140 * t)],
                  fill=(104, 114, 130), width=3)

    # 南墙 D1 门（西南侧，面向南时在画面右侧）
    draw.rectangle([860, 250, 1150, 742], fill=(46, 38, 32), outline=(112, 90, 68), width=5)
    draw.rectangle([884, 282, 1126, 716], outline=(112, 90, 68), width=3)
    for y in (360, 440, 520, 600):
        draw.line([(890, y), (1120, y)], fill=(92, 74, 56), width=3)
    draw.ellipse([1090, 470, 1108, 492], fill=(150, 128, 96))       # 门闩

    # 门边净空地面略亮（门缝透光）
    draw.polygon([(880, 742), (1150, 742), (1210, 800), (830, 800)], fill=(96, 86, 74))

    _watermark(draw, f'占位图 · 反打 · {tag}')
    return image


def make_placeholders(folder: str, tag: str) -> dict:
    os.makedirs(folder, exist_ok=True)
    paths = {
        'front': os.path.join(folder, 'front.png'),
        'reverse': os.path.join(folder, 'reverse.png'),
    }
    draw_front_placeholder(tag).save(paths['front'], 'PNG')
    draw_reverse_placeholder(tag).save(paths['reverse'], 'PNG')
    return paths


# ---------------------------------------------------------------- 主流程


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')

    parser = argparse.ArgumentParser(
        description='场景双图：正视图 + 反打场景图（不再输出平面图/站位图/细节/拼版卡）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='出图：两张同尺寸 PNG，文件名按 SCENE_<ID>_<名>_<机位>_<时间>_<天气>_v<版本>.png',
    )
    parser.add_argument('--front', help='正视图（空场景，无人物）')
    parser.add_argument('--reverse', help='反打场景图（同一空间反向机位）')
    parser.add_argument('--id', dest='scene_id', default='', help='场景ID，如 SC003')
    parser.add_argument('--name', default='', help='场景名，如 预备杂役宿舍')
    parser.add_argument('--time', default='', help='时间，如 夜晚')
    parser.add_argument('--weather', default='', help='天气/光线，如 室内')
    parser.add_argument('--version', type=int, default=1, help='版本号，默认 1')
    parser.add_argument('--outdir', default='data/scene-assets', help='输出目录')
    parser.add_argument('--aspect', default='source',
                        help='目标画幅：source（默认，跟随原图）/ 16:9 / 3:2 / 4:3 / W:H')
    parser.add_argument('--fit', choices=('contain', 'cover'), default='contain',
                        help='画幅不匹配时的处理：contain 留边（默认，不裁画面）/ cover 裁切')
    parser.add_argument('--height', type=int, default=0, help='目标高度，默认取两张图中较高者')
    parser.add_argument('--width', type=int, default=0, help='目标宽度，默认按高度与画幅推导')
    parser.add_argument('--no-trim', action='store_true', help='不裁白边')
    parser.add_argument('--demo', nargs='?', const='data/scene-assets/test/placeholder',
                        default=None, help='用本地占位图试跑；可指定占位图目录')
    parser.add_argument('--force', action='store_true', help='两张图几乎相同时也照常输出')
    args = parser.parse_args(argv)

    try:
        aspect = parse_aspect(args.aspect)
    except ValueError:
        parser.error(f'--aspect 无法识别：{args.aspect}（例：source / 16:9 / 3:2）')

    front_path, reverse_path = args.front, args.reverse
    if args.demo is not None and (not front_path or not reverse_path):
        tag = '｜'.join(part for part in (args.scene_id, args.name, args.time, args.weather) if part)
        generated = make_placeholders(args.demo, tag or '场景')
        front_path = front_path or generated['front']
        reverse_path = reverse_path or generated['reverse']
        print(f'占位图目录：{os.path.abspath(args.demo)}')

    missing = [flag for flag, value in (('--front（正视图）', front_path),
                                        ('--reverse（反打图）', reverse_path)) if not value]
    if missing:
        parser.error('缺少输入：' + '；'.join(missing) + '（或用 --demo 跑占位图）')
    for label, path in (('正视图', front_path), ('反打图', reverse_path)):
        if not os.path.isfile(path):
            parser.error(f'{label}文件不存在：{path}')

    front = load_image(front_path)
    reverse = load_image(reverse_path)
    if not args.no_trim:
        front = trim_white(front)
        reverse = trim_white(reverse)

    gap = difference(front, reverse)
    if gap < 2.0 and not args.force:
        parser.error(f'正视图与反打图几乎相同（灰度差 {gap:.1f}），'
                     f'检查是否传了同一张；确认要输出请加 --force')

    if aspect is None:
        aspect = front.width / front.height
        if abs(reverse.width / reverse.height - aspect) > 0.01 * aspect:
            print('提示：两张图比例不一致，按正视图比例统一（反打图会留边或裁切）')

    height = args.height or max(front.height, reverse.height)
    width = args.width or max(1, int(round(height * aspect)))
    size = (width, height)

    card_front, front_scale, front_note = place(front, size, args.fit)
    card_reverse, reverse_scale, reverse_note = place(reverse, size, args.fit)

    os.makedirs(args.outdir, exist_ok=True)
    front_name = build_filename(args.scene_id, args.name, ANGLE_FRONT,
                                args.time, args.weather, args.version)
    reverse_name = build_filename(args.scene_id, args.name, ANGLE_REVERSE,
                                  args.time, args.weather, args.version)
    front_out = os.path.join(args.outdir, front_name)
    reverse_out = os.path.join(args.outdir, reverse_name)
    card_front.save(front_out, 'PNG')
    card_reverse.save(reverse_out, 'PNG')

    print(f'正视图：{front_path}  {front.width}x{front.height}  →  {front_out}  {front_note}')
    print(f'反打图：{reverse_path}  {reverse.width}x{reverse.height}  →  {reverse_out}  {reverse_note}')
    print(f'画布：{width}x{height}（缩放 {front_scale:.3f} / {reverse_scale:.3f}）；'
          f'两张同尺寸；无人物；未调用 AI')
    return 0


if __name__ == '__main__':
    sys.exit(main())
