"""Local, text-only readers for HTML, conversation JSON and delimited scripts."""
import csv
from html.parser import HTMLParser
import io
import json
import re
import threading

_CSV_LOCK = threading.Lock()


def _decode(raw):
    from script_import import decode_text
    return decode_text(raw)


def _normalize(text):
    from script_import import normalize_text
    return normalize_text(text)


class VisibleHTML(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
    HIDDEN = {'head', 'script', 'style', 'template', 'noscript', 'iframe', 'object', 'canvas', 'svg', 'math'}
    BLOCK = {'p', 'div', 'section', 'article', 'blockquote', 'pre', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.stack, self.title_parts = [], [], []

    def hidden(self):
        return bool(self.stack and self.stack[-1][1])

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        hidden = (self.hidden() or tag in self.HIDDEN or 'hidden' in attrs
                  or str(attrs.get('aria-hidden', '')).lower() == 'true'
                  or re.search(r'(?:display\s*:\s*none|visibility\s*:\s*hidden)', attrs.get('style') or '', re.I) is not None)
        if not hidden and (tag in self.BLOCK or tag in {'br', 'hr'}):
            self.parts.append('\n')
        if tag not in self.VOID:
            self.stack.append((tag, hidden))

    def handle_startendtag(self, tag, attributes):
        self.handle_starttag(tag, attributes)
        if tag not in self.VOID: self.handle_endtag(tag)

    def handle_endtag(self, tag):
        was_hidden = self.hidden()
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break
        if not was_hidden:
            if tag in self.BLOCK: self.parts.append('\n')
            elif tag in {'td', 'th'}: self.parts.append('\t')

    def handle_data(self, data):
        if any(tag == 'title' for tag, hidden in self.stack):
            self.title_parts.append(data)
        if not self.hidden():
            in_pre = any(tag == 'pre' for tag, hidden in self.stack)
            self.parts.append(data if in_pre else re.sub(r'\s+', ' ', data))


def html_info(raw):
    if raw.startswith((b'\xff\xfe', b'\xfe\xff', b'\xef\xbb\xbf')):
        source = _decode(raw)
    else:
        declared = re.search(br'charset\s*=\s*[\"\x27]?([A-Za-z0-9_-]{1,40})', raw[:8192], re.I)
        if declared:
            try:
                source = raw.decode(declared[1].decode('ascii'))
            except (LookupError, UnicodeError) as exc:
                raise ValueError('HTML声明的文字编码无效，请另存为UTF-8后上传') from exc
        else:
            source = _decode(raw)
    parser = VisibleHTML()
    parser.feed(source); parser.close()
    text, title = _normalize(''.join(parser.parts)), _normalize(''.join(parser.title_parts))[:120]
    if text and title and not text.startswith(title): text = title + '\n\n' + text
    return {'text': text, 'title': title}


def extract_html(raw):
    return html_info(raw)['text']


def extract_delimited(raw, delimiter=','):
    source = _decode(raw)
    with _CSV_LOCK:
        previous_limit = csv.field_size_limit()
        try:
            csv.field_size_limit(max(previous_limit, 1_000_000))
            rows = csv.reader(io.StringIO(source, newline=''), delimiter=delimiter, strict=True)
            return _normalize('\n'.join('\t'.join(cell for cell in row) for row in rows if any(cell.strip() for cell in row)))
        except csv.Error as exc:
            raise ValueError('表格文字格式不完整，请检查引号或重新导出CSV/TSV') from exc
        finally:
            csv.field_size_limit(previous_limit)


def _parts_text(content):
    if isinstance(content, str): return content
    if isinstance(content, list): parts = content
    elif isinstance(content, dict):
        if content.get('content_type', content.get('type', 'text')) not in {'text', 'multimodal_text', 'input_text', 'output_text'}:
            return ''
        parts = content.get('parts', [content.get('text', '')])
    else: return ''
    if not isinstance(parts, list): return ''
    result = []
    for part in parts:
        if isinstance(part, str): result.append(part)
        elif isinstance(part, dict):
            kind = part.get('content_type', part.get('type', 'text'))
            if kind in {'text', 'input_text', 'output_text'} and not any(key in part for key in ('asset_pointer', 'image_url', 'audio', 'mime_type')):
                if isinstance(part.get('text'), str): result.append(part['text'])
    return '\n'.join(result)


def _message_text(message):
    if not isinstance(message, dict): return ''
    author = message.get('author', {})
    role = message.get('role') or (author.get('role') if isinstance(author, dict) else '')
    if not isinstance(role, str) or role.lower() not in {'user', 'assistant'}: return ''
    return _parts_text(message.get('content', message.get('text', '')))


def _conversation(value):
    mapping = value.get('mapping')
    if not isinstance(mapping, dict) or not mapping:
        raise ValueError('JSON对话没有有效消息结构')
    current = value.get('current_node')
    if not current:
        parent_ids = {node.get('parent') for node in mapping.values() if isinstance(node, dict) and isinstance(node.get('parent'), str)}
        leaves = [(key, node) for key, node in mapping.items() if key not in parent_ids and isinstance(node, dict)]
        if not leaves: raise ValueError('JSON对话分支结构损坏')
        def created(entry):
            message = entry[1].get('message') or {}
            try: return float(message.get('create_time') or 0)
            except (TypeError, ValueError): return 0
        current = max(enumerate(leaves), key=lambda pair: (created(pair[1]), pair[0]))[1][0]
    if not isinstance(current, str) or current not in mapping:
        raise ValueError('JSON当前对话分支不存在，请重新导出')
    chain, seen = [], set()
    while current:
        if current in seen: raise ValueError('JSON对话分支包含循环，无法读取')
        seen.add(current)
        node = mapping.get(current)
        if not isinstance(node, dict): raise ValueError('JSON对话消息链不完整')
        text = _message_text(node.get('message'))
        if text: chain.append(text)
        parent = node.get('parent')
        if parent is not None and not isinstance(parent, str): raise ValueError('JSON对话消息链格式无效')
        current = parent
    text = '\n\n'.join(reversed(chain))
    if not text: return ''
    title = value.get('title')
    return (title + '\n\n' if isinstance(title, str) and title.strip() else '') + text


_CONTAINERS = ('conversations', 'messages', 'episodes', 'chapters', 'scenes', 'sections', 'items', 'dialogues', 'dialogue',
               '章节', '剧集', '场景', '对白')
_TEXT_FIELDS = ('script', 'text', 'content', 'body', 'story', 'narrative', 'dialogue', '台词', '正文', '内容', '剧本', '剧情')


def _json_text(value, depth=0, chapter_kind='话'):
    if depth > 80: raise ValueError('JSON结构层级过深，请导出简单文字结构')
    if isinstance(value, str): return value
    if isinstance(value, list):
        return '\n\n'.join(part for item in value if (part := _json_text(item, depth + 1, chapter_kind)))
    if not isinstance(value, dict): return ''
    if 'mapping' in value: return _conversation(value)
    if 'role' in value or 'author' in value: return _message_text(value)
    if 'message' in value: return _message_text(value['message'])
    parts = []
    for key in _CONTAINERS:
        if isinstance(value.get(key), (list, dict)):
            parts.append(_json_text(value[key], depth + 1, '章' if key in {'chapters', '章节'} else chapter_kind))
            break
    if not any(parts):
        for key in _TEXT_FIELDS:
            if key in value:
                child = value[key]
                if isinstance(child, str): parts.append(child)
                elif key == 'content' and isinstance(child, dict) and ('parts' in child or 'content_type' in child): parts.append(_parts_text(child))
                elif isinstance(child, (dict, list)): parts.append(_json_text(child, depth + 1, chapter_kind))
                if any(parts): break
    body = '\n\n'.join(part for part in parts if part.strip())
    if not body: return ''
    title = next((value[key] for key in ('title', 'name', '标题', '剧名', '章节名') if isinstance(value.get(key), str) and value[key].strip()), '')
    number = next((value[key] for key in ('number', 'episode', 'chapter', 'index', '话数', '章数', '序号')
                   if isinstance(value.get(key), (int, str)) and not isinstance(value[key], bool)), None)
    header = []
    if number is not None and str(number).isdigit() and not re.match(r'第\s*\d+\s*[话章集回]', title):
        header.append(f'第{number}{"章" if "chapter" in value or "章数" in value else chapter_kind}')
    if title: header.append(title)
    speaker = value.get('speaker') or value.get('人物')
    if isinstance(speaker, str) and speaker.strip(): body = speaker.strip() + '：' + body
    return '\n'.join(header + [body])


def extract_json(raw):
    try:
        value = json.loads(_decode(raw))
        text = _normalize(_json_text(value))
    except (json.JSONDecodeError, RecursionError) as exc:
        raise ValueError('JSON文件损坏或结构过深，请重新导出文字剧本') from exc
    if not text:
        raise ValueError('JSON中没有可识别的文字剧本或对话；支持script/text/content、章节列表和ChatGPT消息导出')
    return text
