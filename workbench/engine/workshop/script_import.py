"""Deterministic local document/ZIP ingestion; uploaded files are never executed."""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
from pathlib import Path, PurePosixPath
import re
import stat
import uuid
import xml.etree.ElementTree as ET
import zipfile

MAX_FILE = 20 * 1024 * 1024
MAX_TOTAL = 60 * 1024 * 1024
MAX_UNPACKED = 100 * 1024 * 1024
MAX_FILES = 100
MAX_TEXT = 1_000_000
SCRIPT_EXTENSIONS = {".txt", ".md", ".markdown", ".docx", ".pdf", ".rtf", ".doc",
                     ".epub", ".odt", ".html", ".htm", ".json", ".fountain", ".csv", ".tsv"}


def supported_extensions():
    return sorted(SCRIPT_EXTENSIONS | {'.zip'})


class ScriptImportError(ValueError):
    pass


def normalize_text(text):
    return re.sub(r"\n{4,}", "\n\n\n", text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")).strip()


def decode_text(raw):
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return normalize_text(raw.decode("utf-16"))
    if raw.startswith(b"\xef\xbb\xbf"):
        return normalize_text(raw.decode("utf-8-sig"))
    # BOM-less UTF-16 ASCII text has a distinctive alternating NUL pattern.
    if len(raw) >= 4 and b"\x00" in raw:
        even = raw[0::2].count(0)
        odd = raw[1::2].count(0)
        if len(raw) % 2 == 0 and max(even, odd) >= max(1, len(raw) // 32) and max(even, odd) > 2 * min(even, odd):
            encoding = "utf-16-le" if odd >= even else "utf-16-be"
            candidate = raw.decode(encoding)
            if not any(ord(character) < 32 and character not in "\r\n\t" for character in candidate):
                return normalize_text(candidate)
        raise ValueError("文件含有二进制内容，不能作为普通文本读取")
    for encoding in ("utf-8", "gb18030"):
        try:
            return normalize_text(raw.decode(encoding))
        except UnicodeError:
            pass
    # Never silently replace undecodable bytes in a script.
    raise ValueError("无法确定文字编码，请另存为 UTF-8 文本后重试")


def extract_docx(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        info = archive.getinfo("word/document.xml")
        if info.file_size > 32 * 1024 * 1024 or (info.file_size > 5 * 1024 * 1024 and info.file_size / max(info.compress_size, 1) > 200):
            raise ValueError("DOCX正文解压量过大，请拆分文档")
        xml = archive.read(info)
    if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
        raise ValueError("DOCX包含不支持的XML实体")
    root = ET.fromstring(xml)
    paragraphs = []
    for paragraph in root.iter():
        if paragraph.tag.rsplit("}", 1)[-1] != "p":
            continue
        parts = []
        for element in paragraph.iter():
            tag = element.tag.rsplit("}", 1)[-1]
            if tag == "t":
                parts.append(element.text or "")
            elif tag == "tab":
                parts.append("\t")
            elif tag in {"br", "cr"}:
                parts.append("\n")
        paragraphs.append("".join(parts))
    return normalize_text("\n".join(paragraphs))


def extract_pdf(raw, max_text=None):
    try:
        from pypdf import PdfReader
    except ImportError:
        raise ValueError("本地PDF读取组件缺失，请运行工作台的运行检查")
    try:
        reader = PdfReader(io.BytesIO(raw), strict=False)
    except Exception as exc:
        raise ValueError('PDF文件损坏或格式不完整，请重新导出后上传') from exc
    if reader.is_encrypted:
        if reader.decrypt("") == 0:
            raise ValueError("PDF已加密，请先解除密码后上传")
    if len(reader.pages) > 1000:
        raise ValueError("PDF超过1000页，请按剧集拆分上传")
    parts, length = [], 0
    for page in reader.pages:
        text = page.extract_text() or ""
        length += len(text)
        if length > (MAX_TEXT if max_text is None else max_text):
            raise ValueError("PDF文字超过100万字，请分批上传")
        parts.append(text)
    text = normalize_text("\n\n".join(parts))
    if not text:
        raise ValueError("PDF没有可提取的文字，可能是扫描件；请先转成可复制文字的文档")
    return text


def extract_rtf(raw):
    if not raw.lstrip().startswith(b"{\\rtf"):
        raise ValueError("文件不是有效RTF文档")
    source = raw.decode("latin-1")
    codepage = re.search(r"\\ansicpg(\d+)", source)
    number = int(codepage[1]) if codepage else 1252
    codec = "gb18030" if number == 936 else f"cp{number}"
    try:
        b"".decode(codec)
    except LookupError:
        raise ValueError("RTF使用了不支持的编码")
    hidden = {"fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl", "headerr", "footerl", "footerr", "fldinst", "datastore", "xmlopen", "xmlclose", "generator"}
    control_word = re.compile(r"([A-Za-z]+)(-?\d+)? ?")
    output, pending, stack = [], bytearray(), []
    ignored, uc, skip, i = False, 1, 0, 0
    def flush():
        if pending:
            output.append(bytes(pending).decode(codec, errors="replace"))
            pending.clear()
    def literal(value):
        nonlocal skip
        if ignored:
            return
        if skip:
            skip -= 1
            return
        pending.extend(value)
    while i < len(source):
        ch = source[i]
        if ch == "{":
            flush()
            stack.append((ignored, uc))
            i += 1
        elif ch == "}":
            flush()
            if not stack:
                raise ValueError("RTF括号结构损坏")
            ignored, uc = stack.pop()
            i += 1
        elif ch == "\\":
            i += 1
            if i >= len(source):
                break
            symbol = source[i]
            if symbol in "\\{}":
                literal(symbol.encode("latin-1"))
                i += 1
            elif symbol == "'":
                token = source[i + 1:i + 3]
                if not re.fullmatch(r"[0-9a-fA-F]{2}", token):
                    raise ValueError("RTF字符转义损坏")
                literal(bytes([int(token, 16)]))
                i += 3
            elif not symbol.isalpha():
                if symbol == "*":
                    flush()
                    ignored = True
                elif symbol in "~_":
                    literal(b" " if symbol == "~" else b"-")
                i += 1
            else:
                match = control_word.match(source, i)
                word, value = match[1], int(match[2]) if match[2] else None
                i = match.end()
                if word in hidden:
                    flush()
                    ignored = True
                elif word == "bin" and value is not None:
                    if value < 0 or i + value > len(source):
                        raise ValueError("RTF二进制块损坏")
                    i += value
                elif word == "uc" and value is not None:
                    uc = max(0, min(value, 16))
                elif not ignored and word == "u" and value is not None:
                    flush()
                    output.append(chr(value % 65536))
                    skip = uc
                elif not ignored and word in {"par", "line", "tab"}:
                    flush()
                    output.append("\t" if word == "tab" else "\n")
        else:
            if ch not in "\r\n":
                literal(ch.encode("latin-1"))
            i += 1
    flush()
    if stack:
        raise ValueError("RTF括号结构损坏")
    text = "".join(output).encode("utf-16-le", errors="surrogatepass").decode("utf-16-le", errors="replace")
    return normalize_text(text)


def extract_document(filename, raw):
    extension = Path(filename).suffix.lower()
    if extension in {".txt", ".md", ".markdown", ".fountain"}:
        return decode_text(raw)
    if extension == '.epub':
        from ebook_import import extract_epub
        return extract_epub(raw)
    if extension == '.odt':
        from ebook_import import extract_odt
        return extract_odt(raw)
    if extension in {'.html', '.htm'}:
        from text_import import extract_html
        return extract_html(raw)
    if extension == '.json':
        from text_import import extract_json
        return extract_json(raw)
    if extension in {'.csv', '.tsv'}:
        from text_import import extract_delimited
        return extract_delimited(raw, '\t' if extension == '.tsv' else ',')
    if extension == ".docx":
        return extract_docx(raw)
    if extension == ".pdf":
        return extract_pdf(raw)
    if extension == ".rtf":
        return extract_rtf(raw)
    if extension == ".doc":
        if raw.lstrip().startswith(b"{\\rtf"):
            return extract_rtf(raw)
        if raw.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            try:
                from legacy_doc import extract_doc
            except ImportError:
                raise ValueError("旧版DOC读取组件缺失，请转成DOCX后上传")
            return normalize_text(extract_doc(raw))
        if raw.startswith(b"PK"):
            return extract_docx(raw)
        prefix = raw.lstrip().removeprefix(b"\xef\xbb\xbf").lstrip().lower()
        if prefix.startswith((b"<html", b"<!doctype html")):
            from text_import import extract_html
            return extract_html(raw)
        raise ValueError("无法识别这个旧版DOC文件，请用Word另存为DOCX；未把二进制内容当成文字")
    return ""


def natural_key(value):
    def number(match):
        digits = {"零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
        total, current = 0, 0
        for character in match[1]:
            if character in digits:
                current = digits[character]
            else:
                total += (current or 1) * {"十": 10, "百": 100, "千": 1000}[character]
                current = 0
        return "第" + str(total + current)
    value = re.sub(r"第([零〇一二两三四五六七八九十百千]+)(?=[话集章回])", number, value)
    basename = value.replace("\\", "/").rsplit("/", 1)[-1]
    def parts(text):
        return tuple((0, int(part)) if part.isdigit() else (1, part.casefold()) for part in re.split(r"(\d+)", text))
    episode = re.search(r"第\s*(\d+)\s*[话集章回]|(?:EP|Episode|chapter)[ _-]*(\d+)", basename, re.I)
    # Episode order takes precedence over ZIP folder names and file formats.
    # Use the full path only to resolve otherwise identical filenames.
    if episode:
        return (0, int(episode[1] or episode[2]), parts(basename), parts(value))
    return (1, 0, parts(basename), parts(value))


def meaningful_title(value):
    value = Path(value).stem.strip()
    book = re.search(r"《([^》\n]{2,80})》", value)
    if book:
        return book[1].strip()
    value = re.sub(r"[ _-]*20\d{2}[-_.]?\d{2}[-_.]?\d{2}(?:[-_.]\d{2}){0,3}$", "", value).strip(" _-—.")
    value = re.sub(r"(?:[ _-]*(?:剧本|剧情|正文|完整版|全稿|全集|下载|download|chatgpt|gpt|最终版|修订版|第?[0-9]+[-~至][0-9]+[话集章]?|20\d{6}))+?$", "", value, flags=re.I).strip(" _-—.")
    value = re.sub(r"[ _-]*第?[零〇一二两三四五六七八九十百千\d]+[话集章回].*$", "", value).strip(" _-—.")
    if not value or re.match(r"^(?:第\s*[零〇一二两三四五六七八九十百千\d]+\s*[话集章回]|(?:ep|episode)\s*\d+)", value, re.I):
        return ""
    if value.lower() in {"script", "scripts", "document", "documents", "download", "downloads", "chatgpt", "gpt", "剧本", "剧情", "正文", "文档", "文件", "未命名", "新建文本文档", "对话", "conversation"}:
        return ""
    return value[:120]


def infer_name(sources):
    documents = [item for item in sources if item.get("text")]
    for item in documents:
        for line in item["text"].splitlines()[:15]:
            line = line.strip().lstrip("# ")
            explicit = re.match(r"(?:剧名|剧本标题|剧本名|作品名称|作品名|标题)\s*[:：]\s*(.+)", line)
            book = re.fullmatch(r"(?:剧本\s*[:：]?\s*)?《([^》]{2,80})》", line)
            title = meaningful_title(explicit[1]) if explicit else (book[1] if book else "")
            if title:
                return title
    for item in documents:
        title = meaningful_title(item.get('_title', ''))
        if title: return title
    archive_titles = [meaningful_title(item["name"]) for item in sources if item["format"] == "zip"]
    if any(archive_titles):
        return next(title for title in archive_titles if title)
    stems = [meaningful_title(PurePosixPath(item["name"]).name) for item in documents]
    useful = [stem for stem in stems if stem]
    if useful:
        from os.path import commonprefix
        shared = commonprefix(useful).rstrip(" _-—.")
        shared = re.sub(r"[ _-]+\d+$", "", shared).rstrip(" _-—.")
        if len(useful) > 1 and len(shared) >= 3:
            return shared[:120]
        return useful[0]
    for item in documents:
        lines = [line.strip().lstrip("# ") for line in item["text"].splitlines() if line.strip()]
        if lines and len(lines[0]) <= 40 and not re.search(r"[。！？!?：:]", lines[0]):
            title = meaningful_title(lines[0])
            if title:
                return title
    return "导入剧本"


def _read_document_info(name, raw, chapter_range=None):
    extension = PurePosixPath(name).suffix.lower()
    if extension == '.epub':
        from ebook_import import extract_epub_info
        return extract_epub_info(raw, chapter_range=chapter_range)
    if extension in {'.html', '.htm'}:
        from text_import import html_info
        extracted = html_info(raw)
        text, title = extracted['text'], extracted.get('title', '')
    else:
        text = extract_pdf(raw, max_text=MAX_UNPACKED) if extension == '.pdf' and chapter_range is not None else extract_document(name, raw)
        title = ''
    result = {'text': text, 'title': title, 'warnings': []}
    if chapter_range is not None:
        from chapter_import import split_chapters
        if not title:
            inferred = infer_name([{'text': text, 'name': name, 'format': extension.lstrip('.')}])
            result['title'] = inferred if inferred != '导入剧本' else ''
        indexed = split_chapters(text, chapter_range=chapter_range)
        result.update(indexed)
        result['text'] = '\n\n'.join(chapter['text'] for chapter in indexed['chapters'])
        result.update(readRange=list(chapter_range), rangeVerified=bool(indexed['chapters']))
        result['warnings'].append('此格式需先提取文档文字再筛选章节；仅所选正文保存并用于分析。')
        if not indexed['chapters']:
            result['warnings'].append('文件没有所选范围内的章节；没有把全文当成目标范围。')
    return result


def _attach_read_info(record, extracted, chapter_range=None):
    record.update(text=extracted['text'], textLength=len(extracted['text']))
    record['_title'] = extracted.get('title', '')
    if chapter_range is not None:
        record.update(readRange=list(chapter_range), rangeVerified=bool(extracted.get('rangeVerified')),
                      readChapters=[chapter['chapter'] for chapter in extracted.get('chapters', [])], importError='')
        record['_chapters'] = [dict(chapter, sourceId=record['id'], sourceHash=record['sha256'])
                               for chapter in extracted.get('chapters', [])]
        record['_availableChapters'] = [dict(chapter, sourceId=record['id'], sourceHash=record['sha256'])
                                        for chapter in extracted.get('availableChapters', [])]


def _chapter_result(sources, chapter_range, warnings):
    if chapter_range is None:
        return {}
    chapters = sorted([chapter for item in sources for chapter in item.pop('_chapters', [])],
                      key=lambda chapter: (chapter['chapter'], chapter['sourceId']))
    available = sorted([chapter for item in sources for chapter in item.pop('_availableChapters', [])],
                       key=lambda chapter: (chapter['chapter'], chapter['sourceId']))
    numbers = [chapter['chapter'] for chapter in chapters]
    requested = set(range(chapter_range[0], chapter_range[1] + 1))
    missing = sorted(requested - set(numbers))
    duplicates = sorted({number for number in numbers if numbers.count(number) > 1})
    if missing:
        warnings.append('未读到所选章节：' + '、'.join(map(str, missing)) + '；请补充原件或调整范围。')
    if duplicates:
        warnings.append('不同文件有重复章节编号：' + '、'.join(map(str, duplicates)) + '；范围不能唯一核对，请先选择对应卷。')
    return {'chapters': chapters, 'availableChapters': available, 'readRange': list(chapter_range),
            'rangeVerified': bool(chapters) and not missing and not duplicates}


def import_scripts(files, data_directory, known_hashes=None, chapter_range=None):
    if not isinstance(files, list) or not files or len(files) > MAX_FILES:
        raise ScriptImportError("请选择1至100个剧本文档或ZIP压缩包。")
    assets = Path(data_directory) / "assets"
    sources, warnings, total_input, total_unpacked, total_text = [], [], 0, 0, 0
    if known_hashes is None:
        known_hashes = []
    if not isinstance(known_hashes, list) or len(known_hashes) > 5000 or not all(isinstance(item, str) and re.fullmatch(r"[0-9a-f]{64}", item) for item in known_hashes):
        raise ScriptImportError("已导入文件校验信息格式不正确。")
    if chapter_range is not None:
        from chapter_import import validate_range
        chapter_range = validate_range(chapter_range)
    # A raw-file hash cannot establish that another requested range was read.
    seen_hashes = set() if chapter_range is not None else set(known_hashes)
    def add_source(name, raw, parent_archive=None, zip_depth=0, skip_text_reason=''):
        nonlocal total_unpacked, total_text
        if len(name) > 300:
            raise ScriptImportError("压缩包中的文件路径过长，请缩短后上传。")
        if len(sources) >= MAX_FILES:
            raise ScriptImportError("文件及压缩包成员合计不能超过100个，请分批导入。")
        if len(raw) > MAX_FILE:
            raise ScriptImportError(f"{name}超过20 MB，请拆分文件。")
        extension = PurePosixPath(name).suffix.lower()
        record = {"id": "source_" + uuid.uuid4().hex[:12], "name": name, "size": len(raw),
                  "format": extension.lstrip(".") or "unknown", "textLength": 0,
                  "sha256": hashlib.sha256(raw).hexdigest(), "_raw": raw, "text": ""}
        if chapter_range is not None:
            record.update(readRange=list(chapter_range), rangeVerified=False, readChapters=[], importError='')
        if parent_archive:
            record["archive"] = parent_archive
        sources.append(record)
        if skip_text_reason:
            warnings.append(f'{name}：{skip_text_reason}；原文件仍保留。')
            return record
        if extension == ".zip":
            if zip_depth >= 2:
                raise ScriptImportError("ZIP嵌套不能超过2层，请解压后分批上传。")
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    members = archive.infolist()
                    if len(members) > 2000:
                        raise ScriptImportError("压缩包成员过多，请精简后上传。")
                    def member_key(item):
                        # Read structured conversation exports before the alternate HTML view.
                        html_copy = PurePosixPath(item.filename.replace('\\', '/')).name.lower() == 'chat.html'
                        return (html_copy, natural_key(item.filename))
                    for member in sorted(members, key=member_key):
                        normalized = member.filename.replace("\\", "/")
                        path = PurePosixPath(normalized)
                        mode = member.external_attr >> 16
                        if path.is_absolute() or ".." in path.parts or "\x00" in normalized or re.match(r"^[A-Za-z]:", normalized) or stat.S_ISLNK(mode):
                            raise ScriptImportError("压缩包包含不安全路径或符号链接，未解压。")
                        if member.flag_bits & 1:
                            raise ScriptImportError("压缩包含加密文件，请先解除密码。")
                        if member.is_dir():
                            continue
                        if member.file_size > MAX_FILE:
                            raise ScriptImportError(f"压缩包成员 {normalized}超过20 MB。")
                        if member.file_size > 5 * 1024 * 1024 and member.file_size / max(member.compress_size, 1) > 200:
                            raise ScriptImportError("压缩包膨胀比例异常，请先检查并解压文件。")
                        total_unpacked += member.file_size
                        if total_unpacked > MAX_UNPACKED:
                            raise ScriptImportError("ZIP解压内容合计不能超过100 MB。")
                        child = archive.read(member)
                        if len(child) != member.file_size:
                            raise ScriptImportError("压缩包成员长度异常。")
                        gpt_html = path.name.lower() == 'chat.html'
                        has_gpt_text = any(source.get('archive') == record['id'] and (source.get('text') or source.get('duplicate'))
                                           and re.fullmatch(r'conversations(?:[_-]\d+)?\.json', PurePosixPath(source['name']).name, re.I)
                                           for source in sources)
                        skip = '同包的对话JSON已读取，跳过重复HTML正文' if gpt_html and has_gpt_text else ''
                        add_source(normalized, child, record["id"], zip_depth + 1, skip)
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError) as exc:
                raise ScriptImportError(f"无法打开压缩包 {name}：{exc}") from exc
        elif extension in SCRIPT_EXTENSIONS:
            if record["sha256"] in seen_hashes:
                record["duplicate"] = True
                warnings.append(f"{name}与已导入正文相同，已跳过重复文字；原文件仍保留。")
                return record
            try:
                extracted = _read_document_info(name, raw, chapter_range)
                text = extracted['text']
                warnings.extend(f'{name}：{message}' for message in extracted.get('warnings', []))
                total_text += len(text)
                if total_text > MAX_TEXT:
                    raise ScriptImportError("提取文字总量超过100万字，请按剧集分批导入。")
                _attach_read_info(record, extracted, chapter_range)
                if text: seen_hashes.add(record['sha256'])
                if not text:
                    warnings.append(f"{name}没有可提取的文字；原文件已保留。")
            except ScriptImportError:
                raise
            except Exception as exc:
                if chapter_range is not None:
                    record['importError'] = str(exc)[:300]
                warnings.append(f"{name}未提取正文：{str(exc)[:300]}；原文件已保留。")
        else:
            warnings.append(f"{name}不是支持的剧本文档，原文件已保留在来源包中。")
        return record
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("filename"), str) or not item["filename"].strip() or len(item["filename"]) > 300:
            raise ScriptImportError("上传文件名格式不正确。")
        name = item["filename"].replace("\\", "/").split("/")[-1].strip()
        value = item.get("data")
        if not isinstance(value, str):
            raise ScriptImportError("上传文件内容格式不正确。")
        match = re.fullmatch(r"data:[^,;\r\n]*(?:;[^,\r\n]*)?;base64,([A-Za-z0-9+/=\r\n]*)", value)
        if not match:
            raise ScriptImportError("文件上传数据损坏，请重新选择文件。")
        try:
            raw = base64.b64decode(re.sub(r"\s", "", match[1]), validate=True)
        except (ValueError, binascii.Error):
            raise ScriptImportError("文件上传数据损坏，请重新选择文件。")
        total_input += len(raw)
        if total_input > MAX_TOTAL:
            raise ScriptImportError("一次上传合计不能超过60 MB，请分批导入。")
        add_source(name, raw)
    ordered = sorted(sources, key=lambda item: natural_key(item["name"]))
    name = infer_name(ordered)
    script = "\n\n".join(item["text"] for item in ordered if item["text"])
    chapter_result = _chapter_result(sources, chapter_range, warnings)
    if chapter_range is not None:
        script = '\n\n'.join(chapter['text'] for chapter in chapter_result['chapters'])
    if len(script) > MAX_TEXT:
        raise ScriptImportError("提取文字总量超过100万字，请按剧集分批导入。")
    assets.mkdir(parents=True, exist_ok=True)
    public_sources = []
    for item in sources:
        extension = PurePosixPath(item["name"]).suffix.lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,12}", extension):
            extension = ".bin"
        path = assets / (item["id"] + extension)
        path.write_bytes(item.pop("_raw"))
        item["url"] = "/files/assets/" + path.name
        item.pop('_title', None)
        if len(item["text"]) > 200000:
            item.pop("text")
        public_sources.append(item)
    if not script:
        warnings.append("本批文件没有可读取的剧本文字。请上传有文字的文档；来源文件均已保留。")
    return {"name": name, "script": script, "sourceFiles": public_sources, "warnings": warnings, **chapter_result}


def read_saved_sources(sourceFiles, data_directory, chapter_range):
    """Re-read saved originals in-place; source IDs/URLs and bytes are unchanged."""
    from chapter_import import validate_range
    chapter_range = validate_range(chapter_range)
    if not isinstance(sourceFiles, list) or not sourceFiles or len(sourceFiles) > MAX_FILES:
        raise ScriptImportError('已保存来源文件列表格式不正确。')
    data = Path(data_directory).resolve()
    sources, warnings, total_input, total_text = [], [], 0, 0
    seen = set()
    for original in sourceFiles:
        if not isinstance(original, dict) or not isinstance(original.get('name'), str):
            raise ScriptImportError('已保存来源记录格式不正确。')
        record = {key: value for key, value in original.items() if key not in {'text', 'duplicate'} and not key.startswith('_')}
        record.update(text='', textLength=0, readRange=list(chapter_range), rangeVerified=False,
                      readChapters=[], importError='')
        sources.append(record)
        extension = PurePosixPath(record['name']).suffix.lower()
        # Imported ZIP members are already saved individually. Never expand the
        # parent again, which would double-import members and write duplicates.
        if extension not in SCRIPT_EXTENSIONS:
            continue
        try:
            url = record.get('url', '')
            if not isinstance(url, str) or not re.fullmatch(r'/files/assets/[A-Za-z0-9_.-]+', url):
                raise ScriptImportError('原件路径格式不正确。')
            path = (data / url.removeprefix('/files/')).resolve()
            if not path.is_relative_to(data / 'assets') or not path.is_file():
                raise ScriptImportError('原件不存在或路径越界，请重新上传。')
            if path.stat().st_size > MAX_FILE:
                raise ScriptImportError('原件超过20 MB。')
            raw = path.read_bytes()
            total_input += len(raw)
            if total_input > MAX_TOTAL:
                raise ScriptImportError('本次重读来源合计超过60 MB，请分批选择。')
            digest = hashlib.sha256(raw).hexdigest()
            if digest != record.get('sha256'):
                raise ScriptImportError('原件校验与来源记录不符，请重新上传。')
            if digest in seen:
                record['duplicate'] = True
                continue
            extracted = _read_document_info(record['name'], raw, chapter_range)
            total_text += len(extracted['text'])
            if total_text > MAX_TEXT:
                raise ScriptImportError('目标章节合计超过100万字，请缩小范围。')
            _attach_read_info(record, extracted, chapter_range)
            warnings.extend(f"{record['name']}：{message}" for message in extracted.get('warnings', []))
            if extracted['text']:
                seen.add(digest)
        except Exception as exc:
            record['importError'] = str(exc)[:300]
            warnings.append(f"{record['name']}重读失败：{str(exc)[:300]}；原文件没有改动。")
    name = infer_name(sources)
    chapter_result = _chapter_result(sources, chapter_range, warnings)
    script = '\n\n'.join(chapter['text'] for chapter in chapter_result['chapters'])
    for record in sources:
        record.pop('_title', None)
        if len(record['text']) > 200000:
            record.pop('text')
    return {'name': name, 'script': script, 'sourceFiles': sources, 'warnings': warnings, **chapter_result}
