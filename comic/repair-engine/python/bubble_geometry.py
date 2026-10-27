"""Locate observable pale bubble interiors without flooding white page gutters.

``locate_bubble_geometry(image, text_box, frame_box, margin=4)`` takes pixel
boxes in [left, top, right, bottom] coordinates.  It returns ``interior`` and
``coverage`` components (8-connected horizontal ``runs``, exclusive ``box``,
and ``area``), plus JSON-safe diagnostic metadata.  The caller may dilate the
coverage by ``margin``; the returned geometry already verifies that margin.

Ordinary closed interiors retain the original connected-pale path.  Open
spike outlines are located only when bounded dilation of observed strokes
closes a local interior containing the OCR anchor.  Short, straight, narrow
dark strokes then extend the coverage to observed spike tips.  No oval,
rectangle, reconstructed outline, generated image, or inferred artwork is
used as a cutout.  A frame-clipped or substantially missing outline fails.
This is a conservative pixel footprint, not semantic validation of artwork.
"""

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from codex_client import CodexError


def _components(mask):
    """Run-based union, independent of separation/text modules."""
    parents = []
    runs = []
    previous = []

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    for y, row in enumerate(mask):
        changes = np.flatnonzero(np.diff(np.r_[False, row, False].astype(np.int8)))
        current = []
        for start, end in zip(changes[::2], changes[1::2]):
            i = len(parents)
            parents.append(i)
            runs.append((y, int(start), int(end)))
            current.append(i)
            for p in previous:
                _, left, right = runs[p]
                if right < start:
                    continue
                if left > end:
                    break
                parents[root(i)] = root(p)
        previous = current
    groups = {}
    for i, run in enumerate(runs):
        groups.setdefault(root(i), []).append(run)
    return [_component(items) for items in groups.values()]


def _component(runs):
    return {'runs': runs,
            'box': [min(r[1] for r in runs), min(r[0] for r in runs),
                    max(r[2] for r in runs), max(r[0] for r in runs) + 1],
            'area': sum(r[2] - r[1] for r in runs)}


def _mask(component, size):
    image = Image.new('L', size)
    draw = ImageDraw.Draw(image)
    for row, start, end in component['runs']:
        draw.line((start, row, end - 1, row), fill=255)
    return image


def _as_component(mask):
    runs = []
    for y, row in enumerate(mask):
        changes = np.flatnonzero(np.diff(np.r_[False, row, False].astype(np.int8)))
        runs.extend((y, int(a), int(b)) for a, b in zip(changes[::2], changes[1::2]))
    if not runs:
        raise CodexError('气泡没有可验证的完整边界，已保留原图')
    return _component(runs)


def _sum_neighborhood(values, radius):
    """Integral-window sum: no large Pillow morphology kernels."""
    radius = int(radius)
    values = np.pad(values, ((radius, radius), (radius, radius)), mode='constant')
    integral = np.pad(np.cumsum(np.cumsum(values, axis=0), axis=1), ((1, 0), (1, 0)))
    width = radius * 2 + 1
    return (integral[width:, width:] - integral[:-width, width:]
            - integral[width:, :-width] + integral[:-width, :-width])


def _fill_holes(mask):
    """Fill glyph holes only; exterior white remains outside the component."""
    height, width = mask.shape
    result = mask.copy()
    for part in _components(~mask):
        left, top, right, bottom = part['box']
        if left == 0 or top == 0 or right == width or bottom == height:
            continue
        for row, start, end in part['runs']:
            result[row, start:end] = True
    return result


def _fits_frame(box, frame, margin):
    left, top, right, bottom = box
    return (left - margin >= frame[0] and top - margin >= frame[1]
            and right + margin <= frame[2] and bottom + margin <= frame[3])


def _anchor_match(component, text_box, require_bounds):
    left, top, right, bottom = component['box']
    a, b, c, d = text_box
    if require_bounds:
        return left <= a and top <= b and right >= c and bottom >= d
    cx, cy = (a + c) / 2, (b + d) / 2
    return left <= cx < right and top <= cy < bottom


def _outline_evidence(interior, ink, anchor, close_radius):
    """Confirm an observed stroke ring in every quadrant, not just a white blob."""
    cx, cy = anchor
    height, width = interior.shape
    bins = 96
    angles = np.arange(bins) * math.tau / bins
    radii = np.arange(1, math.ceil(math.hypot(width, height)))
    xs = np.rint(cx + np.cos(angles[:, None]) * radii).astype(np.int32)
    ys = np.rint(cy + np.sin(angles[:, None]) * radii).astype(np.int32)
    valid = (xs >= 0) & (ys >= 0) & (xs < width) & (ys < height)
    xs = np.clip(xs, 0, width - 1)
    ys = np.clip(ys, 0, height - 1)
    inside = interior[ys, xs] & valid
    edge = np.max(np.where(inside, radii, 0), axis=1)
    tolerance = max(3, close_radius * 2 + 3)
    around = (np.abs(radii[None, :] - edge[:, None]) <= tolerance) & valid
    # Small near-edge dilation covers antialiasing and the verified short gaps.
    nearby = _sum_neighborhood(ink.astype(np.int32), max(1, close_radius)) > 0
    seen = np.any(nearby[ys, xs] & around, axis=1)
    quadrants = [float(seen[i:i + bins // 4].mean()) for i in range(0, bins, bins // 4)]
    return {'angularStrokeSupport': float(seen.mean()), 'quadrantStrokeSupport': quadrants,
            'angularSamples': bins, 'boundaryTolerancePixels': int(tolerance)}


def _trace_spikes(interior, pixels, anchor, close_radius):
    """Keep line fitting local even when the reference crop is very large."""
    height, width = interior.shape
    ys, xs = np.nonzero(interior)
    left, top, right, bottom = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    padding = max(24, math.ceil(min(right - left, bottom - top) * 0.25))
    a, b = max(0, left - padding), max(0, top - padding)
    c, d = min(width, right + padding), min(height, bottom + padding)
    local, evidence = _trace_local_spikes(interior[b:d, a:c], pixels[b:d, a:c],
                                          (anchor[0] - a, anchor[1] - b), close_radius)
    traced = np.zeros_like(interior)
    traced[b:d, a:c] = local
    return traced, evidence


def _trace_local_spikes(interior, pixels, anchor, close_radius):
    """Follow measured thin ink strokes; stop at gaps, turns, and dark fills.

    An ellipse-like normal is only a direction prior derived from the measured
    interior bounds.  Coverage pixels are always actual source ink.  Local
    covariance selects the stroke's real direction; no ellipse is painted.
    """
    height, width = interior.shape
    rgb = pixels[:, :, :3].astype(np.float64)
    gray = rgb.mean(axis=2)
    ink = ((gray < 110) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 40)
           & (pixels[:, :, 3] >= 240))
    ys, xs = np.nonzero(interior)
    left, top, right, bottom = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    # All distances scale from local bubble size, not a global page crop.
    scale = max(0.5, min(right - left, bottom - top) / 365.0)
    half_width = max(1, round(2 * scale))
    side_step = max(3, round(6 * scale))
    neighborhood = max(3, round(5 * scale))
    max_length = max(12, math.ceil(min(right - left, bottom - top) * 0.22))
    xx, yy = np.meshgrid(np.arange(width, dtype=np.float64),
                         np.arange(height, dtype=np.float64))
    cx, cy = anchor
    rx = max(1, (right - left) / 2)
    ry = max(1, (bottom - top) / 2)
    dx, dy = (xx - cx) / rx ** 2, (yy - cy) / ry ** 2
    normal = np.sqrt(dx * dx + dy * dy)
    normal_safe = np.maximum(1e-8, normal)
    tangent_x, tangent_y = -dy / normal_safe, dx / normal_safe

    def sample_gray(sx, sy):
        sx = np.clip(np.rint(sx).astype(np.int32), 0, width - 1)
        sy = np.clip(np.rint(sy).astype(np.int32), 0, height - 1)
        return gray[sy, sx]

    contrast = np.minimum(sample_gray(xx + tangent_x * side_step, yy + tangent_y * side_step),
                          sample_gray(xx - tangent_x * side_step, yy - tangent_y * side_step)) - gray
    line = ink & (contrast > 12) & ~interior
    # A filled dark patch cannot have two brighter sides and a long, narrow axis.
    weights = line.astype(np.float64)
    count = _sum_neighborhood(weights, neighborhood)
    count_safe = np.maximum(1, count)
    sx = _sum_neighborhood(weights * xx, neighborhood)
    sy = _sum_neighborhood(weights * yy, neighborhood)
    vx = _sum_neighborhood(weights * xx * xx, neighborhood) / count_safe - (sx / count_safe) ** 2
    vy = _sum_neighborhood(weights * yy * yy, neighborhood) / count_safe - (sy / count_safe) ** 2
    covariance = (_sum_neighborhood(weights * xx * yy, neighborhood) / count_safe
                  - sx * sy / count_safe ** 2)
    delta = np.sqrt((vx - vy) ** 2 + 4 * covariance ** 2)
    ratio = (vx + vy + delta) / np.maximum(0.01, vx + vy - delta)
    theta = 0.5 * np.arctan2(2 * covariance, vx - vy)
    ux, uy = np.cos(theta), np.sin(theta)
    flip = ux * dx + uy * dy < 0
    ux[flip] *= -1
    uy[flip] *= -1
    alignment = np.abs(ux * dx + uy * dy) / normal_safe
    near = _sum_neighborhood(interior.astype(np.int32), max(neighborhood, close_radius + 1)) > 0
    roots = line & (ratio > 2) & (alignment > 0.75) & near
    root_y, root_x = np.nonzero(roots)
    traced = np.zeros_like(interior)
    accepted = 0
    capped_paths = 0
    lengths = []
    radii = np.arange(max_length + 1)
    offsets = np.arange(-half_width, half_width + 1)
    # Neighboring roots redundantly trace the same source stroke; every second
    # root keeps the subpixel edge coverage while bounding local CPU work.
    stride = max(1, round(2 * scale))
    for y, x in zip(root_y[::stride], root_x[::stride]):
        ax, ay = ux[y, x], uy[y, x]
        path_x = np.rint(x + ax * radii[:, None] - ay * offsets).astype(np.int32)
        path_y = np.rint(y + ay * radii[:, None] + ax * offsets).astype(np.int32)
        valid = (path_x >= 0) & (path_y >= 0) & (path_x < width) & (path_y < height)
        path_x = np.clip(path_x, 0, width - 1)
        path_y = np.clip(path_y, 0, height - 1)
        hits = ink[path_y, path_x] & valid
        low = np.min(np.where(hits, gray[path_y, path_x], 255), axis=1)
        side_a = sample_gray(x + ax * radii - ay * side_step, y + ay * radii + ax * side_step)
        side_b = sample_gray(x + ax * radii + ay * side_step, y + ay * radii - ax * side_step)
        supported = np.any(hits, axis=1) & (np.minimum(side_a, side_b) - low > 10)
        gap = 0
        end = 0
        for step, okay in enumerate(supported):
            gap = 0 if okay else gap + 1
            if gap >= max(3, round(3 * scale)):
                break
            if okay:
                end = step + 1
        if end < max(4, round(8 * scale)):
            continue
        if end == len(radii) and np.any(supported[-max(3, round(3 * scale)):]):
            # The stroke kept going at the local bound; its tip was not seen.
            # Do not turn a background hair/garment line into a chopped spike.
            capped_paths += 1
            continue
        observed = hits[:end]
        traced[path_y[:end][observed], path_x[:end][observed]] = True
        accepted += 1
        lengths.append(end)
    return traced, {'tracedStrokePaths': int(accepted), 'maximumTracePixels': int(max_length),
                    'maximumAcceptedTracePixels': int(max(lengths, default=0)),
                    'unboundedStrokePathsSkipped': int(capped_paths),
                    'strokeScale': round(float(scale), 4), 'coverageUsesSourceInkOnly': True}


def locate_bubble_geometry(image, text_box, frame_box=None, margin=4, require_text_bounds=True):
    """Return conservative pixel geometry or raise ``CodexError``.

    ``require_text_bounds=False`` anchors a cleaned/resized bubble by the old
    text center; it does not treat old OCR bounds as the new bubble outline.
    Multiple bubbles must still be checked for duplicate geometry by callers.
    Returned components contain only Python ints/tuples and metadata is JSON-safe.
    """
    image = image.convert('RGBA')
    width, height = image.size
    text_box = [float(n) for n in text_box]
    if (len(text_box) != 4 or not all(math.isfinite(n) for n in text_box)
            or text_box[2] <= text_box[0] or text_box[3] <= text_box[1]):
        raise CodexError('原文位置无效，气泡没有可验证的完整边界')
    frame = list(frame_box or (0, 0, width, height))
    frame = [max(0, frame[0]), max(0, frame[1]), min(width, frame[2]), min(height, frame[3])]
    anchor = ((text_box[0] + text_box[2]) / 2, (text_box[1] + text_box[3]) / 2)
    if not (frame[0] < anchor[0] < frame[2] and frame[1] < anchor[1] < frame[3]):
        raise CodexError('原文位置跨出选区，气泡没有可验证的完整边界')
    pixels = np.asarray(image)
    rgb = pixels[:, :, :3].astype(np.int16)
    pale = (rgb.min(axis=2) >= 150) & (pixels[:, :, 3] >= 240)
    ink = ((rgb.mean(axis=2) < 110) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 40)
           & (pixels[:, :, 3] >= 240))
    source = Image.fromarray(np.uint8(pale) * 255)
    max_close = max(3, min(16, round(min(width, height) * 0.015)))
    candidate = None
    radius = None
    for close in range(max_close + 1):
        closed = source if close == 0 else source.filter(ImageFilter.MinFilter(close * 2 + 1))
        matches = [part for part in _components(np.asarray(closed) > 0)
                   if part['area'] >= 64 and _anchor_match(part, text_box, require_text_bounds)
                   and _fits_frame(part['box'], frame, margin + close)]
        if len(matches) == 1:
            candidate = matches[0]
            radius = close
            break
        if len(matches) > 1:
            raise CodexError('原图气泡内部不能唯一匹配原文，请逐个完整气泡框选')
    if candidate is None:
        raise CodexError('原气泡缺少可验证的完整边界和余量，请完整框选气泡后重试')
    # Reverse only the bounded locating dilation.  Closing did not supply ink.
    interior_image = _mask(candidate, image.size)
    if radius:
        interior_image = interior_image.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    interior = _fill_holes(np.asarray(interior_image) > 0)
    component = _as_component(interior)
    cx, cy = int(round(anchor[0])), int(round(anchor[1]))
    cx, cy = min(width - 1, max(0, cx)), min(height - 1, max(0, cy))
    if not interior[cy, cx]:
        raise CodexError('原文中心不能匹配气泡的完整内部边界，请重新完整框选')
    if require_text_bounds:
        l, t, r, b = text_box
        corners = [(math.floor(l), math.floor(t)), (math.ceil(r) - 1, math.floor(t)),
                   (math.floor(l), math.ceil(b) - 1), (math.ceil(r) - 1, math.ceil(b) - 1)]
        if any(not (0 <= x < width and 0 <= y < height and interior[y, x]) for x, y in corners):
            raise CodexError('完整原文不能安全放入气泡内部边界，请逐个完整气泡框选')
    evidence = _outline_evidence(interior, ink, anchor, radius)
    if evidence['angularStrokeSupport'] < 0.80 or min(evidence['quadrantStrokeSupport']) < 0.67:
        raise CodexError('原气泡轮廓缺失，无法验证完整边界，已保留原图')
    if radius:
        spikes, trace_evidence = _trace_spikes(interior, pixels, anchor, radius)
        coverage = interior | spikes
        evidence.update(trace_evidence)
    else:
        coverage = interior
        evidence.update({'tracedStrokePaths': 0, 'coverageUsesSourceInkOnly': True})
    cover_component = _as_component(coverage)
    if not _fits_frame(cover_component['box'], frame, margin):
        raise CodexError('原气泡尖刺或边框跨出选区，缺少可验证的完整边界和余量，请扩大选区后重试')
    samples = pixels[interior & pale, :3]
    if len(samples) < 64 or len(samples) < component['area'] * 0.65:
        raise CodexError('原气泡内部填充复杂，无法验证完整边界，已保留原图')
    return {'interior': component, 'coverage': cover_component,
            'method': 'original-pale-connected-interior' if radius == 0 else 'bounded-stroke-gap-closure-and-source-spike-trace',
            'gapCloseRadiusPixels': int(radius), 'outlineEvidence': evidence,
            'fillColor': [int(n) for n in np.median(samples, axis=0)]}
