"""Verified chapter selection; EPUB catalogs are read before selected bodies."""
from __future__ import annotations

from html.parser import HTMLParser
import posixpath
import re
from urllib.parse import urlsplit


class ChapterImportError(ValueError):
    pass


_NUMBER = r"[0-9０-９零〇一二两三四五六七八九十百千万]+"
_HEADING = re.compile(r"^(?:第\s*(" + _NUMBER + r")\s*([章回话集节])|(?:chapter|episode|ep)\s*[._ -]*(\d+))(?=$|\s|[:：.、—-])", re.I)


def chapter_number(value):
    value = value.strip().lstrip("# ").replace("\u3000", " ")
    match = _HEADING.match(value)
    if not match or len(value) > 180:
        return None
    token = match[1] or match[3]
    if token.isdecimal():
        return int(token)
    digits = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
    total, section, current = 0, 0, 0
    for character in token:
        if character in digits:
            current = digits[character]
        elif character == "万":
            total += (section + current or 1) * 10000
            section, current = 0, 0
        else:
            section += (current or 1) * {"十": 10, "百": 100, "千": 1000}[character]
            current = 0
    return total + section + current


def validate_range(chapter_range):
    if (not isinstance(chapter_range, (tuple, list)) or len(chapter_range) != 2
            or any(not isinstance(value, int) or isinstance(value, bool) for value in chapter_range)
            or not 1 <= chapter_range[0] <= chapter_range[1] <= 100000
            or chapter_range[1] - chapter_range[0] >= 1000):
        raise ChapterImportError("章节范围格式不正确，请选择正整数起止章节，一批最多1000章。")
    return tuple(chapter_range)


def make_chapter(number, title, body, member=""):
    paragraphs = [{"id": f"C{number:02d}-P{index:03d}", "index": index, "text": line.strip()}
                  for index, line in enumerate((line for line in body.splitlines() if line.strip()), 1)]
    if not paragraphs:
        raise ChapterImportError(f"第{number}章只有标题，没有可读取正文。")
    return {"chapter": number, "title": title, "text": title + "\n\n" + body.strip(),
            "member": member, "paragraphs": paragraphs}


def split_chapters(text, member="", chapter_range=None):
    """Only recognizable standalone headings establish a chapter boundary."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").splitlines()
    headings = [(index, chapter_number(line), line.strip().lstrip("# "))
                for index, line in enumerate(lines) if chapter_number(line) is not None]
    if not headings:
        raise ChapterImportError("未找到可核对的章节标题，无法验证所选范围；没有把全篇当成目标章节。")
    numbers = [number for _, number, _ in headings]
    if len(set(numbers)) != len(numbers):
        raise ChapterImportError("正文存在重复章节编号（可能含目录或多卷重编号），需先分卷或去除重复目录后再读。")
    selected = []
    available = [{"chapter": number, "title": title, "member": member} for _, number, title in headings]
    for position, (start, number, title) in enumerate(headings):
        end = headings[position + 1][0] if position + 1 < len(headings) else len(lines)
        if chapter_range is not None and not chapter_range[0] <= number <= chapter_range[1]:
            continue
        selected.append(make_chapter(number, title, "\n".join(lines[start + 1:end]), member))
    return {"chapters": selected, "availableChapters": available}


class _NavReader(HTMLParser):
    """Read only chapter links in EPUB3 TOC nav; no body extraction/execution."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.links, self.active_link = [], [], None

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        parent = self.stack[-1][1] if self.stack else False
        toc = parent or (tag.rsplit(":", 1)[-1] == "nav" and
                         ("toc" in (values.get("epub:type") or values.get("type") or "").split()
                          or values.get("role") == "doc-toc"))
        self.stack.append((tag, toc))
        if toc and tag == "a" and values.get("href"):
            self.active_link = {"href": values["href"], "parts": []}

    def handle_data(self, data):
        if self.active_link is not None:
            self.active_link["parts"].append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.active_link is not None:
            self.links.append(("".join(self.active_link["parts"]).strip(), self.active_link["href"]))
            self.active_link = None
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break


def _epub_catalog(package):
    from ebook_import import (_child, _decode_html, _encrypted_paths, _local, _resolve, _xml, HTML_TYPES)
    if "mimetype" in package.members and package.read("mimetype").strip() != b"application/epub+zip":
        raise ChapterImportError("该文件不是有效EPUB电子书。")
    container = _xml(package.read("META-INF/container.xml"), "EPUB容器")
    rootfiles = [element for element in container.iter() if _local(element.tag) == "rootfile" and element.get("full-path")]
    if not rootfiles:
        raise ChapterImportError("EPUB缺少书目位置，无法按章节定位。")
    rootfile = next((item for item in rootfiles if item.get("media-type") == "application/oebps-package+xml"), rootfiles[0])
    opf_path = _resolve("", rootfile.get("full-path"))
    encrypted = _encrypted_paths(package)
    if opf_path in encrypted:
        raise ChapterImportError("EPUB书目已加密，请提供未加密版本。")
    opf = _xml(package.read(opf_path), "EPUB书目")
    metadata, manifest_node, spine = _child(opf, "metadata"), _child(opf, "manifest"), _child(opf, "spine")
    if manifest_node is None or spine is None:
        raise ChapterImportError("EPUB缺少manifest或spine，无法按章节定位。")
    title = next(("".join(item.itertext()).strip() for item in metadata if _local(item.tag) == "title"), "") if metadata is not None else ""
    manifest = {}
    for item in manifest_node:
        if _local(item.tag) != "item":
            continue
        if not item.get("id") or item.get("id") in manifest or not item.get("href"):
            raise ChapterImportError("EPUB资源清单编号缺失或重复。")
        manifest[item.get("id")] = item
    paths, spine_position = [], {}
    for itemref in spine:
        if _local(itemref.tag) != "itemref" or itemref.get("linear", "yes").lower() == "no":
            continue
        item = manifest.get(itemref.get("idref"))
        if item is None:
            raise ChapterImportError("EPUB阅读顺序指向不存在的正文。")
        seen_fallbacks = set()
        while item.get("media-type") not in HTML_TYPES and posixpath.splitext(urlsplit(item.get("href")).path)[1].lower() not in {".html", ".htm", ".xhtml"}:
            fallback = item.get("fallback")
            if not fallback:
                break
            if fallback in seen_fallbacks or fallback not in manifest:
                raise ChapterImportError("EPUB正文回退链损坏。")
            seen_fallbacks.add(fallback)
            item = manifest[fallback]
        if "nav" in item.get("properties", "").split():
            continue
        path = _resolve(opf_path, item.get("href"))
        if item.get("media-type") not in HTML_TYPES and posixpath.splitext(path)[1].lower() not in {".html", ".htm", ".xhtml"}:
            continue
        if path not in spine_position:
            spine_position[path] = len(paths)
            paths.append(path)
    if not paths:
        raise ChapterImportError("EPUB没有可定位的正文阅读顺序。")
    entries = []
    # Prefer EPUB3 TOC. The NCX is a fallback, not an additional body.
    for item in manifest.values():
        if "nav" not in item.get("properties", "").split():
            continue
        path = _resolve(opf_path, item.get("href"))
        if path in encrypted:
            raise ChapterImportError("EPUB目录已加密，无法定位所选章节。")
        reader = _NavReader()
        reader.feed(_decode_html(package.read(path)))
        reader.close()
        entries.extend((label, href, path) for label, href in reader.links if chapter_number(label) is not None)
    if not entries:
        ncx_id = spine.get("toc")
        ncx_items = ([manifest[ncx_id]] if ncx_id in manifest else []) + [item for item in manifest.values() if item.get("media-type") == "application/x-dtbncx+xml" and item.get("id") != ncx_id]
        for item in ncx_items:
            path = _resolve(opf_path, item.get("href"))
            if path in encrypted:
                raise ChapterImportError("EPUB目录已加密，无法定位所选章节。")
            ncx = _xml(package.read(path), "EPUB章节目录")
            for point in ncx.iter():
                if _local(point.tag) != "navPoint":
                    continue
                label, content = _child(point, "navLabel"), _child(point, "content")
                text = "".join(label.itertext()).strip() if label is not None else ""
                if content is not None and content.get("src") and chapter_number(text) is not None:
                    entries.append((text, content.get("src"), path))
    catalog = []
    for label, href, origin in entries:
        member = _resolve(origin, href)
        if member not in spine_position:
            continue
        catalog.append({"chapter": chapter_number(label), "title": label, "member": member,
                        "fragment": urlsplit(href).fragment, "position": spine_position[member]})
    if not catalog:
        # An explicit chapter number in OPF item id/href is a bounded fallback;
        # generic numeric filenames or bare spine position do not establish it.
        for item in manifest.values():
            if item.get("media-type") not in HTML_TYPES and posixpath.splitext(urlsplit(item.get("href")).path)[1].lower() not in {".html", ".htm", ".xhtml"}:
                continue
            path = _resolve(opf_path, item.get("href"))
            if path not in spine_position:
                continue
            candidates = (item.get("id", ""), posixpath.splitext(posixpath.basename(path))[0])
            number = next((chapter_number(value.replace("_", " ")) for value in candidates if chapter_number(value.replace("_", " ")) is not None), None)
            if number is not None:
                catalog.append({"chapter": number, "title": f"第{number}章", "member": path,
                                "fragment": "", "position": spine_position[path]})
    if not catalog:
        raise ChapterImportError("EPUB章节目录未提供明确编号，无法只定位所选章节；没有读取全书正文。")
    unique, seen = [], set()
    for item in sorted(catalog, key=lambda value: (value["position"], value["chapter"])):
        key = (item["chapter"], item["member"], item["fragment"])
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return {"title": title, "catalog": unique, "spinePaths": paths, "encrypted": encrypted}


def extract_epub_range(raw, chapter_range):
    from ebook_import import _Package, _html_text, MAX_TEXT, MAX_FILE
    selected_range = validate_range(chapter_range)
    package = _Package(raw, "EPUB")
    try:
        info = _epub_catalog(package)
        selected = [item for item in info["catalog"] if selected_range[0] <= item["chapter"] <= selected_range[1]]
        if not selected:
            raise ChapterImportError("所选范围没有可定位的EPUB章节；未读取全书正文。")
        numbers = [entry['chapter'] for entry in selected]
        if len(numbers) != len(set(numbers)):
            raise ChapterImportError("所选范围在EPUB目录中有重复章节编号，请先分卷；未猜测选取。")
        cached, chapters, warnings = {}, [], []
        for entry in selected:
            member = entry["member"]
            if member in info["encrypted"]:
                raise ChapterImportError("所选EPUB正文已加密：" + member)
            if member not in cached:
                text = _html_text(package.read(member), max_text=MAX_FILE)
                try:
                    split = split_chapters(text, member, selected_range)
                except ChapterImportError:
                    if any(chapter_number(line) is not None for line in text.splitlines()):
                        raise
                    in_member = [item for item in info["catalog"] if item["member"] == member]
                    if len(in_member) != 1:
                        raise
                    split = {"chapters": [make_chapter(entry["chapter"], entry["title"], text, member)],
                             "availableChapters": [{"chapter": entry["chapter"]}]}
                cached[member] = {chapter["chapter"]: chapter for chapter in split["chapters"]}
                if len(split["availableChapters"]) > 1:
                    warnings.append("多个章节共用正文成员 " + member + "，已读取该成员再切取目标章节；无法只解压成员内的部分文字。")
            chapter = cached[member].get(entry["chapter"])
            if chapter is None:
                raise ChapterImportError(f"目录第{entry['chapter']}章与正文标题不符，所选范围未通过核对。")
            same_member = [item for item in info['catalog'] if item['member'] == member]
            # A chapter may span several HTML files. Its spine interval ends
            # before the next cataloged chapter, not at an arbitrary filename.
            if entry is same_member[-1]:
                next_position = min((item['position'] for item in info['catalog'] if item['position'] > entry['position']),
                                    default=len(info['spinePaths']))
                continuations = info['spinePaths'][entry['position'] + 1:next_position]
                if continuations:
                    pieces = [chapter['text'].split('\n\n', 1)[1]]
                    for extra_member in continuations:
                        if extra_member in info['encrypted']:
                            raise ChapterImportError('所选章节后续正文已加密：' + extra_member)
                        extra = _html_text(package.read(extra_member), max_text=MAX_FILE)
                        if any(chapter_number(line) is not None and chapter_number(line) != entry['chapter'] for line in extra.splitlines()):
                            raise ChapterImportError('目录缺少后续正文的章节边界，无法核对范围；没有将未索引章节并入目标。')
                        if extra:
                            pieces.append(extra)
                    chapter = make_chapter(entry['chapter'], chapter['title'], '\n\n'.join(pieces), member)
                    chapter['members'] = [member, *continuations]
                    warnings.append(f"第{entry['chapter']}章跨多个正文成员，已按目录与阅读顺序读取至下一章之前。")
            chapters.append(chapter)
        chapters.sort(key=lambda value: value["chapter"])
        text = "\n\n".join(item["text"] for item in chapters)
        if len(text) > MAX_TEXT:
            raise ChapterImportError("所选章节正文超过100万字，请缩小范围；未截断文字。")
        got = {item["chapter"] for item in chapters}
        missing = sorted(set(range(selected_range[0], selected_range[1] + 1)) - got)
        if missing:
            warnings.append("目录中缺少所选章节：" + "、".join(map(str, missing)) + "；范围未完整验证。")
        available = [{key: item[key] for key in ("chapter", "title", "member")} for item in info["catalog"]]
        return {"title": info["title"], "text": text, "chapters": chapters, "availableChapters": available,
                "readRange": list(selected_range), "rangeVerified": not missing, "warnings": warnings}
    finally:
        package.close()
