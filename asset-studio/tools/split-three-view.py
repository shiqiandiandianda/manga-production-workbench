import argparse
import os
import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sheet', required=True)
    parser.add_argument('--outdir', required=True)
    args = parser.parse_args()

    image = Image.open(args.sheet).convert('RGB')
    arr = np.array(image)
    mask = (arr < 245).any(axis=2)
    ys, xs = np.where(mask)
    if not len(xs):
        raise SystemExit('empty sheet')
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    image = image.crop((x0, y0, x1, y1))
    mask = mask[y0:y1, x0:x1]

    cols = mask.any(axis=0)
    runs = []
    start = None
    for index, occupied in enumerate(cols):
        if occupied and start is None:
            start = index
        elif not occupied and start is not None:
            runs.append([start, index])
            start = None
    if start is not None:
        runs.append([start, len(cols)])

    merged = []
    for run in runs:
        if merged and run[0] - merged[-1][1] < 30:
            merged[-1][1] = run[1]
        else:
            merged.append(run)
    merged = [run for run in merged if run[1] - run[0] > 40]
    print('column runs', merged)
    if len(merged) != 3:
        raise SystemExit(f'expected 3 figures, got {len(merged)}')

    os.makedirs(args.outdir, exist_ok=True)
    names = ['front', 'side', 'back']
    pad = 12
    for name, (left, right) in zip(names, merged):
        part = mask[:, left:right]
        rows = np.where(part.any(axis=1))[0]
        top, bottom = int(rows.min()), int(rows.max()) + 1
        box = (
            max(0, left - pad),
            max(0, top - pad),
            min(image.width, right + pad),
            min(image.height, bottom + pad)
        )
        crop = image.crop(box)
        path = os.path.join(args.outdir, f'{name}.png')
        crop.save(path, 'PNG')
        print(name, box, crop.size, path)


if __name__ == '__main__':
    main()
