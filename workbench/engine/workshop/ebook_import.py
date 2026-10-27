"""Local EPUB/ODT text readers. Resources remain inside the in-memory package.

EPUB ordering follows W3C EPUB 3.3 container/manifest/spine semantics; ODT
whitespace follows OASIS OpenDocument 1.3 text:p/h/s/tab/line-break elements.
No resources, stylesheets, scripts, entities or remote URLs are executed.
"""
from __future__ import annotations

from html.parser import HTMLParser
import io
import posixpath
import re
import stat
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
import zipfile

MAX_FILE = 20 * 1024 * 1024
MAX_UNPACKED = 100 * 1024 * 1024
MAX_ENTRIES = 2000
MAX_TEXT = 1_000_000
HTML_TYPES = {"application/xhtml+xml", "text/html"}
FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2"}


class EbookImportError(ValueError):
    pass


def _local(tag):
    return tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1]


def _normalize(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _member_name(value):
    name = value.replace("\\", "/")
    decoded = unquote(name)
    if (len(name) > 500 or not name or name.startswith("/") or "\x00" in name
            or decoded.startswith("/") or re.match(r"^[A-Za-z]:", decoded)
            or ".." in name.split("/") or ".." in decoded.split("/")):
        raise EbookImportError("电子书压缩包包含不安全的内部路径，未读取。")
    return name.rstrip("/")


def _resolve(base_file, href):
    try:
        parsed = urlsplit(href)
    except ValueError as exc:
        raise EbookImportError("电子书中的资源路径格式不正确。") from exc
    if parsed.scheme or parsed.netloc:
        raise EbookImportError("电子书正文引用了外部资源；本工具不会联网读取。")
    path = unquote(parsed.path).replace("\\", "/")
    if "\x00" in path or path.startswith("/") or re.match(r"^[A-Za-z]:", path):
        raise EbookImportError("电子书资源路径越过压缩包边界，未读取。")
    combined = posixpath.normpath(posixpath.join(posixpath.dirname(base_file), path))
    if combined in {"", ".", ".."} or combined.startswith("../"):
        raise EbookImportError("电子书资源路径越过压缩包边界，未读取。")
    return combined


class _Package:
    def __init__(self, raw, label):
        self.label = label
        if not isinstance(raw, (bytes, bytearray)) or not raw:
            raise EbookImportError(label + "文件内容为空或格式不正确。")
        if len(raw) > MAX_FILE:
            raise EbookImportError(label + "文件超过20 MB，请按章节拆分后导入。")
        try:
            self.archive = zipfile.ZipFile(io.BytesIO(raw))
        except (zipfile.BadZipFile, OSError) as exc:
            raise EbookImportError(label + "压缩包已损坏或不是有效电子书。") from exc
        self.members = {}
        try:
            infos = self.archive.infolist()
            if len(infos) > MAX_ENTRIES:
                raise EbookImportError(label + "包内文件超过2000个，请拆分后导入。")
            unpacked = 0
            for info in infos:
                name = _member_name(info.filename)
                if stat.S_ISLNK(info.external_attr >> 16):
                    raise EbookImportError(label + "包包含符号链接，未读取。")
                if info.flag_bits & 1:
                    raise EbookImportError(label + "压缩包已加密，请先解除密码。")
                if info.is_dir():
                    continue
                if name in self.members:
                    raise EbookImportError(label + "包包含重名文件，阅读顺序无法确定。")
                if info.file_size > MAX_FILE:
                    raise EbookImportError(label + "内部单个文件超过20 MB，请拆分后导入。")
                if info.file_size > 5 * 1024 * 1024 and info.file_size / max(info.compress_size, 1) > 200:
                    raise EbookImportError(label + "压缩膨胀比例异常，未读取。")
                unpacked += info.file_size
                if unpacked > MAX_UNPACKED:
                    raise EbookImportError(label + "解压总量超过100 MB，请拆分后导入。")
                self.members[name] = info
        except Exception:
            self.archive.close()
            raise

    def read(self, name):
        if name not in self.members:
            raise EbookImportError(self.label + "缺少内部文件：" + name)
        try:
            raw = self.archive.read(self.members[name])
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError) as exc:
            raise EbookImportError(self.label + "内部文件损坏或使用不支持的压缩方式：" + name) from exc
        if len(raw) != self.members[name].file_size:
            raise EbookImportError(self.label + "内部文件解压长度异常。")
        return raw

    def close(self):
        self.archive.close()


def _xml(raw, label):
    inspected = raw.replace(b"\x00", b"").upper()
    if b"<!DOCTYPE" in inspected or b"<!ENTITY" in inspected:
        raise EbookImportError(label + "包含不支持的XML实体或外部定义，未执行。")
    try:
        return ET.fromstring(raw)
    except (ET.ParseError, ValueError) as exc:
        raise EbookImportError(label + "XML结构损坏，无法读取。") from exc


def _child(element, name):
    return next((child for child in element if _local(child.tag) == name), None)


def _decode_html(raw):
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    match = re.search(br"(?:encoding|charset)\s*=\s*['\"]?([A-Za-z0-9_-]+)", raw[:4096], re.I)
    if match:
        try:
            return raw.decode(match[1].decode("ascii"))
        except (LookupError, UnicodeError) as exc:
            raise EbookImportError("EPUB正文章节文字编码无效。") from exc
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeError:
            pass
    raise EbookImportError("EPUB正文章节无法解码，请重新导出为UTF-8电子书。")


class _BodyReader(HTMLParser):
    void = {"br", "hr", "img", "input", "link", "meta", "area", "base", "col", "embed", "param", "source", "track", "wbr"}
    blocks = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "blockquote", "pre", "tr", "br", "hr"}
    hidden_tags = {"head", "script", "style", "nav", "noscript", "template", "svg", "canvas", "math", "rt", "rp"}

    def __init__(self, max_text=None):
        super().__init__(convert_charrefs=True)
        self.parts, self.stack, self.length = [], [], 0
        self.max_text = MAX_TEXT if max_text is None else max_text

    def emit(self, text):
        if text == "\n" and self.parts and self.parts[-1].endswith("\n"):
            return
        self.length += len(text)
        if self.length > self.max_text:
            raise EbookImportError("EPUB正文超过100万字，请按章节分批导入；未截断文字。")
        self.parts.append(text)

    def handle_starttag(self, tag, attrs):
        tag = _local(tag)
        values = dict(attrs)
        parent_hidden = self.stack[-1][1] if self.stack else False
        semantics = set((values.get("epub:type") or values.get("type") or "").split())
        hidden = (parent_hidden or tag in self.hidden_tags or "hidden" in values or values.get("aria-hidden") == "true"
                  or bool(semantics & {"toc", "landmarks", "page-list", "cover", "footnote", "endnote", "rearnote"})
                  or bool(re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", values.get("style") or "", re.I)))
        if not hidden:
            if tag in self.blocks:
                self.emit("\n")
            elif tag in {"td", "th"}:
                self.emit("\t")
        if tag not in self.void:
            self.stack.append((tag, hidden))

    def handle_endtag(self, tag):
        tag = _local(tag)
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                hidden = self.stack[index][1]
                del self.stack[index:]
                if not hidden and tag in self.blocks:
                    self.emit("\n")
                return

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if _local(tag) not in self.void:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if not self.stack or not self.stack[-1][1]:
            self.emit(re.sub(r"\s+", " ", data))


def _html_text(raw, max_text=None):
    text = _decode_html(raw)
    # Ordinary EPUB2 XHTML DTD declarations are safe with HTMLParser, which
    # never loads DTDs; custom entity declarations are explicitly rejected.
    if re.search(r"<!\s*ENTITY\b", text, re.I):
        raise EbookImportError("EPUB正文章节含自定义XML实体，未执行。")
    if not re.search(r"<(?:[A-Za-z_][\w.-]*:)?(?:html|body|p|div|span|h[1-6]|section|article|pre)\b", text, re.I):
        raise EbookImportError("EPUB正文章节不是可读取的HTML，可能已损坏或加密。")
    if "\x00" in text or sum(ord(character) < 32 and character not in "\r\n\t\f" for character in text) > max(2, len(text) // 50):
        raise EbookImportError("EPUB正文章节含有二进制数据，可能已损坏或加密。")
    parser = _BodyReader(max_text=max_text)
    try:
        parser.feed(text)
        parser.close()
    except EbookImportError:
        raise
    except Exception as exc:
        raise EbookImportError("EPUB正文章节HTML结构无法读取。") from exc
    return _normalize("".join(parser.parts))


def _encrypted_paths(package):
    if "META-INF/encryption.xml" not in package.members:
        return set()
    root = _xml(package.read("META-INF/encryption.xml"), "EPUB加密说明")
    paths = set()
    for element in root.iter():
        if _local(element.tag) == "CipherReference":
            uri = element.get("URI")
            if not uri:
                raise EbookImportError("EPUB加密说明缺少资源路径。")
            paths.add(_resolve("", uri))
    return paths


def extract_epub_info(raw, chapter_range=None):
    """Return text/title/warnings in spine order; non-linear extras are skipped."""
    if chapter_range is not None:
        from chapter_import import extract_epub_range
        return extract_epub_range(raw, chapter_range)
    package = _Package(raw, "EPUB")
    try:
        if "mimetype" in package.members and package.read("mimetype").strip() != b"application/epub+zip":
            raise EbookImportError("该文件不是有效EPUB电子书。")
        container = _xml(package.read("META-INF/container.xml"), "EPUB容器")
        rootfiles = [element for element in container.iter() if _local(element.tag) == "rootfile" and element.get("full-path")]
        if not rootfiles:
            raise EbookImportError("EPUB缺少书目文件位置，无法确定正文。")
        rootfile = next((item for item in rootfiles if item.get("media-type") == "application/oebps-package+xml"), rootfiles[0])
        opf_path = _resolve("", rootfile.get("full-path"))
        encrypted = _encrypted_paths(package)
        if opf_path in encrypted:
            raise EbookImportError("EPUB书目或正文已加密（DRM），请提供未加密的电子书。")
        opf = _xml(package.read(opf_path), "EPUB书目")
        if _local(opf.tag) != "package":
            raise EbookImportError("EPUB书目结构无效，缺少package。")
        metadata, manifest_node, spine = _child(opf, "metadata"), _child(opf, "manifest"), _child(opf, "spine")
        if manifest_node is None or spine is None:
            raise EbookImportError("EPUB缺少manifest或spine阅读顺序，不能按文件名猜测正文。")
        title = ""
        if metadata is not None:
            title = next(("".join(item.itertext()).strip() for item in metadata if _local(item.tag) == "title"), "")
        manifest = {}
        for item in manifest_node:
            if _local(item.tag) != "item":
                continue
            item_id = item.get("id")
            if not item_id or item_id in manifest or not item.get("href"):
                raise EbookImportError("EPUB资源清单存在缺失或重复编号。")
            manifest[item_id] = item
        auxiliary_paths = set()
        guide = _child(opf, "guide")
        if guide is not None:
            for reference in guide:
                if set(reference.get("type", "").split()) & {"cover", "toc"} and reference.get("href"):
                    auxiliary_paths.add(_resolve(opf_path, reference.get("href")))
        parts, seen, warnings, total = [], set(), [], 0
        itemrefs = [item for item in spine if _local(item.tag) == "itemref"]
        if not itemrefs:
            raise EbookImportError("EPUB的spine没有正文章节。")
        for itemref in itemrefs:
            if itemref.get("linear", "yes").lower() == "no":
                continue
            item_id = itemref.get("idref")
            if item_id not in manifest:
                raise EbookImportError("EPUB阅读顺序指向不存在的章节：" + str(item_id))
            item, fallback_seen = manifest[item_id], set()
            while item.get("media-type", "") not in HTML_TYPES and posixpath.splitext(urlsplit(item.get("href")).path)[1].lower() not in {".html", ".htm", ".xhtml"}:
                fallback = item.get("fallback")
                if not fallback:
                    break
                if fallback in fallback_seen or fallback not in manifest:
                    raise EbookImportError("EPUB章节的正文回退链损坏。")
                fallback_seen.add(fallback)
                item = manifest[fallback]
            if "nav" in item.get("properties", "").split():
                continue
            path = _resolve(opf_path, item.get("href"))
            stem = posixpath.splitext(posixpath.basename(path))[0].casefold()
            auxiliary_names = {"cover", "coverpage", "cover-page", "titlepage", "title-page", "封面", "toc", "contents", "table-of-contents", "目录"}
            if path in auxiliary_paths or stem in auxiliary_names or item.get("id", "").casefold() in auxiliary_names:
                continue
            if item.get("media-type", "") not in HTML_TYPES and posixpath.splitext(path)[1].lower() not in {".html", ".htm", ".xhtml"}:
                warnings.append("已跳过非文字章节：" + path)
                continue
            if path in encrypted:
                raise EbookImportError("EPUB正文已加密（DRM）：" + path + "；请提供未加密版本。")
            if path in seen:
                continue
            seen.add(path)
            text = _html_text(package.read(path))
            if text:
                total += len(text) + (2 if parts else 0)
                if total > MAX_TEXT:
                    raise EbookImportError("EPUB正文合计超过100万字，请按章节分批导入；未截断文字。")
                parts.append(text)
        if not parts:
            raise EbookImportError("EPUB没有可读取的正文章节；目录、封面或图片不能代替正文。")
        if any(posixpath.splitext(path)[1].lower() in FONT_EXTENSIONS for path in encrypted):
            warnings.append("已忽略字体加密或混淆信息，不影响正文提取。")
        return {"text": "\n\n".join(parts), "title": title, "warnings": warnings}
    finally:
        package.close()


def extract_epub(raw):
    return extract_epub_info(raw)["text"]


def epub_title(raw):
    return extract_epub_info(raw)["title"]


def extract_odt(raw):
    package = _Package(raw, "ODT")
    try:
        if "mimetype" in package.members and package.read("mimetype").strip() != b"application/vnd.oasis.opendocument.text":
            raise EbookImportError("该文件不是有效ODT文本文档。")
        if "META-INF/manifest.xml" in package.members:
            manifest = _xml(package.read("META-INF/manifest.xml"), "ODT清单")
            for entry in manifest.iter():
                path = next((value for key, value in entry.attrib.items() if _local(key) == "full-path"), "")
                if path == "content.xml" and any(_local(element.tag) == "encryption-data" for element in entry.iter()):
                    raise EbookImportError("ODT正文已加密，请先解除文档密码。")
        root = _xml(package.read("content.xml"), "ODT正文")
        body = _child(root, "body")
        text_node = _child(body, "text") if body is not None else None
        if text_node is None:
            raise EbookImportError("ODT没有找到正文office:text。")
        excluded = {"annotation", "annotation-end", "tracked-changes", "binary-data", "scripts", "script", "styles", "automatic-styles", "master-styles", "header", "footer", "header-left", "footer-left", "note", "table-of-content", "alphabetical-index", "illustration-index", "bibliography", "ruby-text"}
        paragraphs, total = [], 0
        def inline(element):
            if _local(element.tag) in excluded:
                return ""
            name = _local(element.tag)
            if name == "s":
                count = next((value for key, value in element.attrib.items() if _local(key) == "c"), "1")
                try:
                    count = int(count)
                except ValueError as exc:
                    raise EbookImportError("ODT空格数量格式损坏。") from exc
                if not 1 <= count <= MAX_TEXT:
                    raise EbookImportError("ODT空格数量异常或超过文字上限。")
                return " " * count
            if name == "tab":
                return "\t"
            if name == "line-break":
                return "\n"
            result = [element.text or ""]
            for child in element:
                result.append(inline(child))
                result.append(child.tail or "")
            value = "".join(result)
            if len(value) > MAX_TEXT:
                raise EbookImportError("ODT正文超过100万字，请拆分文档；未截断文字。")
            return value
        def walk(element):
            nonlocal total
            name = _local(element.tag)
            if name in excluded:
                return
            if name in {"p", "h"}:
                value = inline(element)
                total += len(value) + 1
                if total > MAX_TEXT:
                    raise EbookImportError("ODT正文合计超过100万字，请拆分文档；未截断文字。")
                paragraphs.append(value)
                return
            for child in element:
                walk(child)
        walk(text_node)
        text = _normalize("\n".join(paragraphs))
        if not text:
            raise EbookImportError("ODT没有可提取的正文文字。")
        return text
    finally:
        package.close()
