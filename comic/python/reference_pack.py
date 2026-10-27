"""Native imagegen attachment packing. Original references are never overwritten.

Faction/importance come only from explicit metadata. Unknown character order is
a conservative fallback and does not claim to infer the story's protagonists.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from image_pipeline import open_image

LIMIT = 5
MAX_TILES = 20


def _sha(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def _priority(ref):
    if ref.get('base'):
        return 10000
    if ref.get('keepSeparate'):
        return 900
    if ref.get('characterRole') in ('lead', 'main', 'protagonist'):
        return 800
    value = ref.get('importance')
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return max(0, min(700, value * 100))
    if str(value).lower() in ('main', 'major', 'high', '主角', '主要', '重要'):
        return 800
    if ref.get('characterRole') in ('background', 'extra', 'walkon', 'crowd') or str(value).lower() in ('minor', 'low', '次要', '不重要'):
        return 30
    return {'character': 400, 'style': 450, 'scene': 90, 'prop': 180}.get(ref.get('role'), 250)


def plan_groups(refs, limit=LIMIT):
    if not isinstance(limit, int) or not 1 <= limit <= LIMIT:
        raise ValueError('参考附图上限无效')
    groups = [[i] for i in range(len(refs))]
    if len(refs) <= limit:
        return groups
    protected = {i for i, r in enumerate(refs) if r.get('base')}
    anchors = [i for i, r in enumerate(refs) if r.get('role') == 'character']
    if anchors and len(protected) < limit - 1:
        protected.add(max(anchors, key=lambda i: (_priority(refs[i]), -i)))

    def cost(a, b):
        ids = a + b
        if len(ids) > MAX_TILES or any(i in protected for i in ids):
            return None
        rs = [refs[i] for i in ids]
        roles = {r.get('role') for r in rs}
        factions = {str(r.get('faction') or '').strip() for r in rs}
        if roles == {'scene'}:
            category = -1400
        elif roles == {'character'} and len(factions) == 1 and '' not in factions:
            category = -1300
        elif roles == {'character'} and all(_priority(r) < 100 for r in rs):
            category = -1200
        elif roles == {'prop'}:
            category = -1000
        elif len(roles) == 1:
            category = -700
        else:
            category = 0
        return (max(_priority(r) for r in rs) >= 700, category + max(_priority(r) for r in rs), len(ids), min(ids))

    while len(groups) > limit:
        candidates = [(score, a, b) for a in range(len(groups)) for b in range(a + 1, len(groups)) if (score := cost(groups[a], groups[b])) is not None]
        if not candidates:
            # Greedy merges may leave several almost-full sheets. Rebalance
            # instead of dropping references or exceeding the attachment cap.
            remaining = sorted((i for i in range(len(refs)) if i not in protected), key=lambda i: (refs[i].get('role', ''), refs[i].get('faction', ''), _priority(refs[i]), i))
            slots = limit - len(protected)
            size = math.ceil(len(remaining) / slots) if slots > 0 else MAX_TILES + 1
            if size > MAX_TILES:
                raise ValueError('参考图过多，无法在保留独立主图的同时合为5张；请分批生成')
            groups = [[i] for i in sorted(protected)] + [sorted(remaining[n:n + size]) for n in range(0, len(remaining), size)]
            break
        _, a, b = min(candidates)
        groups[a] = sorted(groups[a] + groups[b])
        groups.pop(b)
    return sorted(groups, key=min)


def _font(size):
    root = Path(__file__).resolve().parents[1]
    candidates = [Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts/msyh.ttc']
    for folder in (root / 'public/fonts', root / '.runtime/fonts'):
        if folder.is_dir():
            candidates = sorted(folder.glob('*Sans*.*')) + candidates
    for file in candidates:
        if file.is_file():
            try:
                return ImageFont.truetype(str(file), size)
            except OSError:
                pass
    return ImageFont.load_default(size=size)


def _sheet(file, records):
    count = len(records)
    cols = 2 if count <= 6 else 3 if count <= 9 else 4
    rows = math.ceil(count / cols)
    width = min(4096, cols * 1280)
    cell_w = width // cols
    ratios = []
    for record in records:
        with Image.open(record['file']) as image:
            ratios.append(image.height / image.width)
    cell_h = min(4096 // rows, max(640, min(1400, round(cell_w * max(ratios)) + 80)))
    height = cell_h * rows
    sheet = Image.new('RGB', (width, height), '#f0f2f5')
    draw, font = ImageDraw.Draw(sheet), _font(28)
    for index, record in enumerate(records):
        x, y = (index % cols) * cell_w, (index // cols) * cell_h
        draw.rectangle((x + 5, y + 5, x + cell_w - 5, y + cell_h - 5), fill='white', outline='#8997a5', width=3)
        label = f"{record['id']} | {record['name']}" + (f" | 阵营：{record['faction']}" if record.get('faction') else '')
        lines, current = [], ''
        for char in label:
            if draw.textlength(current + char, font=font) > cell_w - 32:
                lines.append(current)
                current = ''
            current += char
        lines.append(current)
        for line, text in enumerate(lines[:2]):
            draw.text((x + 16, y + 12 + line * 31), text, font=font, fill='#132b40')
        header = 82
        image = open_image(record['file'])
        try:
            image.thumbnail((cell_w - 32, cell_h - header - 20), Image.Resampling.LANCZOS)
            rect = {'x': x + (cell_w - image.width) // 2, 'y': y + header + (cell_h - header - image.height) // 2, 'w': image.width, 'h': image.height}
            sheet.paste(image, (rect['x'], rect['y']), image)
            record['tile'] = {'column': index % cols + 1, 'row': index // cols + 1, **rect}
        finally:
            image.close()
    try:
        sheet.save(file, 'PNG')
    finally:
        sheet.close()
    return {'width': width, 'height': height}


def pack_references(directory, references, roles, *, edit=False):
    """references includes the current edit base first; it uses one real slot."""
    files = [str(Path(file).resolve()) for file in references]
    if len(files) <= LIMIT:
        return files, '', None
    if len(files) > 61:
        raise ValueError('参考图超过工作台60张上限（另加1张重绘底图）')
    rows = ([{'role': 'base', 'name': '当前重绘底图', 'base': True}] if edit else []) + list(roles)
    refs = []
    for index, file in enumerate(files):
        row = dict(rows[index]) if index < len(rows) else {}
        row.update(file=file, id='B00' if edit and index == 0 else f'R{index if edit else index + 1:02d}')
        row['name'] = str(row.get('name') or Path(file).stem).replace('\n', ' ')[:500]
        refs.append(row)
    groups = plan_groups(refs)
    folder = Path(directory) / 'reference-pack'
    folder.mkdir(exist_ok=True)
    attachments = []
    for number, group in enumerate(groups, 1):
        records = [dict(refs[i]) for i in group]
        for record in records:
            record['sha256'] = _sha(record['file'])
            with Image.open(record['file']) as image:
                record['width'], record['height'] = image.size
        merged = len(records) > 1
        file = folder / f'sheet-{number:02d}.png' if merged else Path(records[0]['file'])
        size = _sheet(file, records) if merged else {'width': records[0]['width'], 'height': records[0]['height']}
        attachments.append({'index': number, 'file': str(file.resolve()), 'sha256': _sha(file), 'merged': merged, 'sources': records, **size})
    receipt = {'version': 1, 'limit': LIMIT, 'sourceCount': len(files), 'attachedCount': len(attachments), 'editBaseKeptSeparate': edit, 'attachments': attachments}
    (Path(directory) / 'reference-pack.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    lines = ['【本次实际附图映射，取代前文清单序号与附图序号的对应关系】', f'原始{len(files)}张参考已自动整理成{len(attachments)}张实际附图，全部参考保留。R编号是原参考清单ID，B00是重绘底图；原文图号指原始参考，不直接指实际附图序号，须按下方映射寻找对应图片或拼图单元；仅将下列实际附图路径传入referenced_image_paths，不再另传原件。']
    lines.append('重绘时图1对应B00，图2对应R01，后续图号依次对应R02、R03等。' if edit else '非重绘时图1对应R01，图2对应R02，后续图号依次类推。')
    for attachment in attachments:
        lines.append(f"实际附图{attachment['index']}：{'带标签参考拼图' if attachment['merged'] else '独立原图'}")
        for record in attachment['sources']:
            tile = record.get('tile')
            position = f"第{tile['row']}行第{tile['column']}列" if tile else '整张'
            lines.append(f"  {position} = {record['id']}，{record.get('role', '参考')}，{record['name']}" + (f"；阵营：{record['faction']}" if record.get('faction') else ''))
    lines.append('每个单元格只对应标签中的独立身份或场景；角色的脸、发型、服装不得串用、混合或平均化。同阵营不代表同一人。拼图标签、分隔线及排版本身不进入生成画面；按原始提示词生成所需的一幅图，不生成参考拼贴。')
    return [a['file'] for a in attachments], '\n'.join(lines), receipt
