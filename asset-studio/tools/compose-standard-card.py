import argparse
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 3840, 1890
WHITE = (255, 255, 255)

# x, y, w, h
CELLS = {
    'face': (32, 96, 900, 1762),
    'front': (960, 96, 700, 1680),
    'side': (1680, 96, 700, 1680),
    'back': (2400, 96, 700, 1680),
    'hands': (3140, 96, 668, 1200),
    'prop': (3140, 1320, 668, 538)
}
LABELS = [('front', '正面'), ('side', '四分之三侧面'), ('back', '背面')]


def trim(image):
    image = image.convert('RGB')
    pixels = image.load()
    width, height = image.size
    left, top, right, bottom = width, height, 0, 0
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            if r < 245 or g < 245 or b < 245:
                if x < left:
                    left = x
                if x > right:
                    right = x
                if y < top:
                    top = y
                if y > bottom:
                    bottom = y
    if right <= left or bottom <= top:
        return image
    pad = 8
    return image.crop((max(0, left - pad), max(0, top - pad), min(width, right + pad), min(height, bottom + pad)))


def fit(image, box):
    x, y, w, h = box
    image = trim(image)
    scale = min(w / image.width, h / image.height)
    return place(image, box, scale)


def place(image, box, scale):
    x, y, w, h = box
    width = max(1, round(image.width * scale))
    height = max(1, round(image.height * scale))
    image = image.resize((width, height), Image.LANCZOS)
    return image, (x + (w - width) // 2, y + (h - height) // 2)


def font(size):
    for path in ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf'):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--face', required=True)
    parser.add_argument('--front', required=True)
    parser.add_argument('--side', required=True)
    parser.add_argument('--back', required=True)
    parser.add_argument('--hands', required=True)
    parser.add_argument('--prop', default='')
    parser.add_argument('--name', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    canvas = Image.new('RGB', (W, H), WHITE)
    draw = ImageDraw.Draw(canvas)
    draw.text((48, 18), args.name, fill=(28, 42, 58), font=font(56))

    for key in ('face', 'hands'):
        image = Image.open(getattr(args, key))
        fitted, position = fit(image, CELLS[key])
        canvas.paste(fitted, position)

    views = [trim(Image.open(getattr(args, key))) for key in ('front', 'side', 'back')]
    max_w = max(view.width for view in views)
    max_h = max(view.height for view in views)
    view_scale = min(CELLS['front'][2] / max_w, CELLS['front'][3] / max_h)
    for key, view in zip(('front', 'side', 'back'), views):
        fitted, position = place(view, CELLS[key], view_scale)
        canvas.paste(fitted, position)

    if args.prop:
        image = Image.open(args.prop)
        fitted, position = fit(image, CELLS['prop'])
        canvas.paste(fitted, position)

    for key, label in LABELS:
        x, y, w, h = CELLS[key]
        text_font = font(34)
        bbox = draw.textbbox((0, 0), label, font=text_font)
        text_w = bbox[2] - bbox[0]
        draw.text((x + (w - text_w) // 2, 1800), label, fill=(60, 70, 78), font=text_font)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    canvas.save(args.out, 'PNG')
    print(args.out, canvas.size)


if __name__ == '__main__':
    main()
