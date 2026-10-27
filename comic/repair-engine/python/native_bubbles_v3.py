"""Measure native PNG alpha and package Codex-positioned bubble layers.

V3 sends the selected source directly to native image generation. This module
does not read printed text, locate source bubbles, derive pale masks, or edit
native image content. Native metadata provides text and target boxes. Alpha
measurements only distinguish actual transparent assets, opaque backgrounds,
and visibly clipped output. Raw generated PNGs remain unchanged.
"""

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


VISIBLE_ALPHA = 24


def _image(value):
    if isinstance(value, Image.Image):
        return value.convert('RGBA')
    if isinstance(value, dict):
        value = value.get('image') or value.get('savedPath')
        if isinstance(value, Image.Image):
            return value.convert('RGBA')
    with Image.open(value) as image:
        return image.convert('RGBA')


def _review(reason, instruction, diagnostics=None):
    return {'status': 'needs_review', 'reason': reason, 'instruction': instruction,
            'sheet': None, 'pieces': [], 'bubbles': [], 'positioned': [],
            'report': {'workflowVersion': 3, 'assetSource': 'native-image-generation',
                       'usesLocalOCR': False, 'usesSourcePaleMask': False,
                       'diagnostics': diagnostics or []}}


def _alpha_stats(image):
    alpha = np.asarray(image.getchannel('A'))
    return {'width': image.width, 'height': image.height,
            'transparentPixels': int((alpha == 0).sum()),
            'nearTransparentPixels': int((alpha < VISIBLE_ALPHA).sum()),
            'opaquePixels': int((alpha >= 240).sum()),
            'transparentFraction': float(np.mean(alpha < VISIBLE_ALPHA)),
            'opaqueFraction': float(np.mean(alpha >= 240)),
            'minimumAlpha': int(alpha.min()), 'maximumAlpha': int(alpha.max())}


def pick_native_roles(images, original_selection):
    """Classify exactly two native images by real alpha, never event order.

    Images can be PIL objects, file paths, or collected savedPath records.
    Ambiguous transparent source selections require review instead of a role
    guess. The collector remains responsible for PNG provenance and freshness.
    """
    if not isinstance(images, (list, tuple)) or len(images) != 2:
        return _review('native_image_count', '气泡分离需要两张真实原生 PNG：透明气泡和完整背景')
    try:
        prepared = [_image(value) for value in images]
        reference = _alpha_stats(_image(original_selection))
    except (OSError, TypeError, ValueError):
        return _review('native_image_unreadable', '原生图片或原始选区无法读取，请检查返回图片')
    diagnostics = [{'nativeIndex': index, **_alpha_stats(image)} for index, image in enumerate(prepared)]
    transparent = [index for index, record in enumerate(diagnostics)
                   if record['transparentPixels'] >= 16
                   and record['opaquePixels'] >= 16
                   and record['transparentFraction'] >= max(0.005, reference['transparentFraction'] + 0.05)]
    background = [index for index, record in enumerate(diagnostics)
                  if record['opaqueFraction'] >= max(0.0, reference['opaqueFraction'] - 0.025)
                  and record['transparentFraction'] <= reference['transparentFraction'] + 0.025]
    if (len(transparent) != 1 or len(background) != 1
            or transparent[0] == background[0]):
        result = _review('native_roles_ambiguous',
                         '两张 PNG 的透明度不能明确区分透明气泡与完整背景，请检查原生返回图后重试', diagnostics)
        result['report']['originalSelectionAlpha'] = reference
        return result
    return {'status': 'ready', 'transparentIndex': transparent[0], 'backgroundIndex': background[0],
            'report': {'workflowVersion': 3, 'method': 'actual-native-alpha',
                       'usesLocalOCR': False, 'usesSourcePaleMask': False,
                       'originalSelectionAlpha': reference, 'diagnostics': diagnostics}}


def classify_native_pair(images, original_selection):
    """Pipeline tuple API: background index, bubble index, alpha report."""
    result = pick_native_roles(images, original_selection)
    if result['status'] != 'ready':
        from codex_client import CodexError
        raise CodexError(result['instruction'])
    return result['backgroundIndex'], result['transparentIndex'], result['report']


def _pixel_box(value, size):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError('missing normalized XYWH box')
    x, y, w, h = [float(number) for number in value]
    if (not all(math.isfinite(number) for number in (x, y, w, h))
            or min(x, y) < 0 or min(w, h) <= 0
            or x + w > 1000.001 or y + h > 1000.001):
        raise ValueError('invalid normalized XYWH box')
    return (max(0, math.floor(x * size[0] / 1000)), max(0, math.floor(y * size[1] / 1000)),
            min(size[0], math.ceil((x + w) * size[0] / 1000)),
            min(size[1], math.ceil((y + h) * size[1] / 1000)))


def _normalize(bounds, size):
    left, top, right, bottom = bounds
    return [left * 1000 / size[0], top * 1000 / size[1],
            (right - left) * 1000 / size[0], (bottom - top) * 1000 / size[1]]


def _runs(row):
    transitions = np.flatnonzero(np.diff(np.r_[False, row, False].astype(np.int8)))
    return [(int(left), int(right)) for left, right in zip(transitions[::2], transitions[1::2])]


def native_edge_diagnostics(image):
    """Report broad opaque cut lines while accepting faint noise and tips.

    A short tail tip or an oval tangent at a canvas edge is not proof of
    clipping. A long opaque light-filled straight edge indicates a clipped
    bubble interior. An observable dark boundary can be a tight, complete
    rectangular outline; it is allowed but flagged for human visual review.
    This test cannot establish the semantic completeness of generated artwork.
    """
    rgba = np.asarray(image.convert('RGBA'))
    edges = [('left', rgba[:, 0]), ('right', rgba[:, -1]),
             ('top', rgba[0]), ('bottom', rgba[-1])]
    result = []
    for side, values in edges:
        alpha = values[:, 3]
        visible = alpha >= VISIBLE_ALPHA
        solid = alpha >= 128
        spans = _runs(solid)
        minimum_cut_length = max(12, math.ceil(len(alpha) * 0.04))
        suspicious = []
        dark_outlines = []
        for start, end in spans:
            if end - start < minimum_cut_length:
                continue
            colors = values[start:end, :3].mean(axis=1)
            dark_fraction = float(np.mean(colors < 90))
            strong_fraction = float(np.mean(alpha[start:end] >= 240))
            if dark_fraction >= 0.70:
                dark_outlines.append([start, end])
            elif strong_fraction >= 0.70:
                suspicious.append([start, end])
        result.append({'side': side, 'maximumAlpha': int(alpha.max()),
                       'visibleEdgePixels': int(visible.sum()),
                       'faintEdgePixels': int(((alpha > 0) & ~visible).sum()),
                       'longestSolidRun': max((end - start for start, end in spans), default=0),
                       'minimumCutLength': minimum_cut_length,
                       'possibleClippedInteriorRuns': suspicious,
                       'observableDarkBoundaryRuns': dark_outlines})
    return result


def _interior_alpha_holes(image, visible):
    """Measure enclosed transparent output holes; no OCR or source inference.

    A bubble can intentionally be hollow, so this is a review diagnostic,
    not an automatic content rewrite. Generated opaque fills with accidental
    transparent centers must never be silently filled by this module.
    """
    # Run union is a simple alpha measurement, not a source-bubble locator.
    from bubble_geometry import _components
    width, height = image.size
    holes = [part for part in _components(~visible)
             if part['area'] >= max(64, width * height * 0.002)
             and part['box'][0] > 0 and part['box'][1] > 0
             and part['box'][2] < width and part['box'][3] < height]
    return [{'box': part['box'], 'pixels': part['area']} for part in holes]


def prepare_native_bubbles(sheet, request, bubbles, output_dir=None):
    """Package an already normalized full-crop native A using Codex boxes.

    ``bubbleBox`` and ``box`` metadata are crop-normalized XYWH. The root
    pipeline handles selection/crop scaling and placement before this call.
    No source pale mask, OCR, background inference or automatic retouch runs.
    Pieces receive true transparent padding rather than a blanket edge veto.
    """
    try:
        sheet = _image(sheet)
    except (OSError, TypeError, ValueError):
        return _review('native_bubble_unreadable', '透明气泡原生 PNG 无法读取')
    crop = request.get('crop') or {}
    if (crop.get('width') != sheet.width or crop.get('height') != sheet.height
            or not all(isinstance(crop.get(key), (int, float))
                       and math.isfinite(crop[key]) for key in ('x', 'y'))):
        return _review('native_canvas_mismatch', '透明气泡画布与原始局部尺寸或坐标不一致，请检查原生返回位置')
    if not isinstance(bubbles, list) or not bubbles or len(bubbles) > 64:
        return _review('native_metadata_missing', 'Codex 没有返回可用的气泡位置与文字，请检查返回信息')
    stats = _alpha_stats(sheet)
    if stats['transparentPixels'] < 16 or stats['opaquePixels'] < 16:
        return _review('native_alpha_missing', '气泡 PNG 缺少真实透明背景或不透明泡体，请重新生成', [stats])
    edges = native_edge_diagnostics(sheet)
    if any(edge['possibleClippedInteriorRuns'] for edge in edges):
        return _review('native_bubble_clipped', '原生气泡存在大段不透明平直截边，请查看边框和尾巴完整性后重试', edges)

    alpha = np.asarray(sheet.getchannel('A'))
    visible = alpha >= VISIBLE_ALPHA
    height, width = visible.shape
    rects = []
    for index, bubble in enumerate(bubbles):
        if not isinstance(bubble, dict):
            return _review('native_metadata_invalid', 'Codex 气泡位置信息无效')
        try:
            rects.append(_pixel_box(bubble.get('bubbleBox'), sheet.size))
            _pixel_box(bubble.get('box'), sheet.size)
        except (TypeError, ValueError, OverflowError):
            return _review('native_metadata_invalid', 'Codex 返回的气泡框或文字框无效，请校对返回位置',
                           [{'bubbleIndex': index, 'bubbleBox': bubble.get('bubbleBox'), 'box': bubble.get('box')}])
    for first in range(len(rects)):
        for second in range(first + 1, len(rects)):
            if _iou(rects[first], rects[second]) > 0.8:
                return _review('native_bubble_overlap', 'Codex 返回了两个几乎相同的气泡框，请校对气泡位置',
                               [{'bubbleIndexes': [first, second]}])

    owner, assignment = _assign_alpha(visible, rects)
    if assignment['unassigned']:
        return _review('native_unassigned_content', '气泡图中有远离所有气泡框的大块可见内容，请校对全部气泡与尾巴',
                       [{'unassignedComponents': assignment['unassigned']}])
    positioned, pieces, diagnostics = [], [], []
    rim = 2
    job_id = request.get('id', 'native')
    others = owner >= 0
    for index, bubble in enumerate(bubbles):
        mine = owner == index
        ys, xs = np.nonzero(mine)
        if not len(xs):
            return _review('native_bubble_empty', '返回的气泡位置没有可见透明素材，请校对气泡坐标', [{'bubbleIndex': index}])
        tight = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        # Antialiased alpha just outside the visible footprint belongs to the same
        # bubble; pixels assigned to another bubble or dropped as noise never do.
        asset_bounds = (max(0, tight[0] - 2), max(0, tight[1] - 2),
                        min(width, tight[2] + 2), min(height, tight[3] + 2))
        left, top, right, bottom = asset_bounds
        keep = Image.fromarray(np.uint8(mine[top:bottom, left:right]) * 255).filter(ImageFilter.MaxFilter(5))
        keep = np.asarray(keep) > 0
        keep &= ~(others[top:bottom, left:right] & ~mine[top:bottom, left:right])
        keep &= ~assignment['dropped'][top:bottom, left:right]
        region = np.array(sheet.crop(asset_bounds))
        region[..., 3] = np.where(keep, region[..., 3], 0)
        piece = Image.new('RGBA', (right - left + rim * 2, bottom - top + rim * 2))
        piece.paste(Image.fromarray(region, 'RGBA'), (rim, rim))
        layer = {
            'id': f'bubble-{job_id}-{index + 1}', 'type': 'image',
            'name': f"气泡框 {index + 1} · {' '.join(str(bubble.get('text', '')).split())[:24]}",
            'x': crop['x'] + left - rim, 'y': crop['y'] + top - rim,
            'imageWidth': piece.width, 'imageHeight': piece.height,
            'coordinateSpace': request.get('coordinateSpace', 'source'),
            'scale': 1, 'angle': 0, 'opacity': 1, 'visible': True, 'locked': False,
            'imported': True, 'originJobId': job_id, 'originRegionId': request.get('regionId'),
            'jobOrder': request.get('orderAt') or request.get('createdAt'),
            'linkGroupId': f'bubble-link-{job_id}-{index + 1}',
            'imageFile': f'bubble-{index + 1}.png',
            'assetSource': 'native-image-generation', 'semanticReview': 'manual',
        }
        positioned.append({**bubble, 'bubbleBox': _normalize(tight, sheet.size),
                           'geometrySource': 'codex-metadata-and-native-alpha', 'empty': True})
        pieces.append((layer, piece))
        diagnostics.append({'bubbleIndex': index, 'visibleBounds': list(tight),
                            'assetBounds': list(asset_bounds), 'transparentPaddingPixels': rim,
                            'nativeAlphaPreserved': True, **assignment['perBubble'][index]})
    holes = _interior_alpha_holes(sheet, visible)
    split = any(item['splitComponents'] for item in assignment['perBubble'])
    report = {'workflowVersion': 3, 'assetSource': 'native-image-generation',
              'method': 'codex-metadata-and-native-alpha-components', 'visibleAlphaThreshold': VISIBLE_ALPHA,
              'usesLocalOCR': False, 'usesSourcePaleMask': False,
              'nativeAlphaPreserved': True, 'semanticReview': 'manual',
              'edgeDiagnostics': edges, 'interiorTransparentHoles': holes,
              'droppedNoise': assignment['droppedComponents'], 'joinedBubblesSplit': split,
              'visualReviewRequired': bool(holes) or split or any(edge['visibleEdgePixels'] for edge in edges),
              'shapeReviewRequired': bool(holes) or split or any(edge['visibleEdgePixels'] for edge in edges),
              'alphaStats': stats, 'diagnostics': diagnostics}
    if output_dir is not None:
        directory = Path(output_dir)
        directory.mkdir(parents=True, exist_ok=True)
        for layer, piece in pieces:
            target = directory / layer['imageFile']
            temporary = target.with_suffix('.tmp.png')
            piece.save(temporary, format='PNG')
            from repair_pipeline import replace_file
            replace_file(temporary, target)
    return {'status': 'ready', 'sheet': sheet, 'pieces': pieces,
            'bubbles': positioned, 'positioned': positioned, 'report': report}


def _iou(first, second):
    left, top = max(first[0], second[0]), max(first[1], second[1])
    right, bottom = min(first[2], second[2]), min(first[3], second[3])
    shared = max(0, right - left) * max(0, bottom - top)
    total = ((first[2] - first[0]) * (first[3] - first[1]) + (second[2] - second[0]) * (second[3] - second[1]) - shared)
    return shared / total if total else 0


def _gap(box, rect):
    """Distance between two pixel rectangles (left, top, right, bottom); 0 when they touch."""
    dx = max(rect[0] - box[2], box[0] - rect[2], 0)
    dy = max(rect[1] - box[3], box[1] - rect[3], 0)
    return math.hypot(dx, dy)


def _assign_alpha(visible, rects):
    """Give every visible alpha component to one Codex bubble box.

    A component goes to the box it overlaps most; a component that clearly
    overlaps several boxes (joined bubbles) is split pixel by pixel to the nearest
    box. A component touching no box goes to the nearest box within reach (a tail
    or thought dot the model's box missed). Small far-away specks are dropped as
    generation noise. Only a large far-away component needs human review.
    """
    from bubble_geometry import _components
    height, width = visible.shape
    owner = np.full(visible.shape, -1, dtype=np.int16)
    dropped = np.zeros(visible.shape, dtype=bool)
    per_bubble = [{'components': 0, 'splitComponents': 0, 'reachedComponents': 0} for _ in rects]
    unassigned, dropped_components = [], []
    noise_limit = max(64, round(width * height * 0.0005))
    for component in _components(visible):
        left, top, right, bottom = component['box']
        local = np.zeros((bottom - top, right - left), dtype=bool)
        for row, start, end in component['runs']:
            local[row - top, start - left:end - left] = True
        overlaps = []
        for rect in rects:
            l, t, r, b = max(left, rect[0]), max(top, rect[1]), min(right, rect[2]), min(bottom, rect[3])
            overlaps.append(int(local[t - top:b - top, l - left:r - left].sum()) if l < r and t < b else 0)
        # Joined bubbles: one alpha shape fills a large part of two or more boxes. A
        # neighbour's box that merely clips the edge of this shape does not count.
        strong = [index for index, value in enumerate(overlaps)
                  if value >= max(1, 0.3 * (rects[index][2] - rects[index][0]) * (rects[index][3] - rects[index][1]))]
        window = owner[top:bottom, left:right]
        if len(strong) >= 2:
            ys, xs = np.nonzero(local)
            px, py = xs + left, ys + top
            scores = []
            for index in strong:
                l, t, r, b = rects[index]
                dx = np.maximum(np.maximum(l - px, px - (r - 1)), 0)
                dy = np.maximum(np.maximum(t - py, py - (b - 1)), 0)
                cx, cy, w, h = (l + r) / 2, (t + b) / 2, max(1, r - l), max(1, b - t)
                scores.append(np.hypot(dx, dy) + 1e-3 * (((px - cx) / w) ** 2 + ((py - cy) / h) ** 2))
            chosen = np.asarray(strong)[np.argmin(np.stack(scores), axis=0)]
            window[ys, xs] = chosen
            for index in set(chosen.tolist()):
                per_bubble[index]['components'] += 1
                per_bubble[index]['splitComponents'] += 1
            continue
        if max(overlaps, default=0) > 0:
            index = int(np.argmax(overlaps))
            window[local] = index
            per_bubble[index]['components'] += 1
            continue
        gaps = [_gap(component['box'], rect) for rect in rects]
        index = int(np.argmin(gaps))
        rect = rects[index]
        reach = max(24, 0.15 * max(rect[2] - rect[0], rect[3] - rect[1]))
        if gaps[index] <= reach:
            window[local] = index
            per_bubble[index]['components'] += 1
            per_bubble[index]['reachedComponents'] += 1
        elif component['area'] < noise_limit:
            dropped[top:bottom, left:right] |= local
            dropped_components.append({'box': component['box'], 'pixels': component['area']})
        else:
            unassigned.append({'box': component['box'], 'pixels': component['area']})
    return owner, {'perBubble': per_bubble, 'unassigned': unassigned,
                   'dropped': dropped, 'droppedComponents': dropped_components}


prepare_native_bubble_assets = prepare_native_bubbles
