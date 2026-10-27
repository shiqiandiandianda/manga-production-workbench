"""Extract main-story text from Word 97–2003 binary .doc files.

This is a read-only FIB/CLX reader; it does not run Word, WPS, macros or shells.
OLE container support comes from the bundled ``olefile`` package. Structure
definitions follow Microsoft's [MS-DOC] sections 2.5.15, 2.4.1 and 2.9.73:
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/acb08ace-f268-4879-a998-de592103a70e
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01
https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/aa2e55a2-f4f2-4795-bab5-6d9d7a0ed249
"""

import io
import re
import struct


OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_MAX_TEXT_UNITS = 10_000_000
_CLX_PAIR_INDEX = 33
_COMPRESSED_MAP = {
    0x82: "\u201a", 0x83: "\u0192", 0x84: "\u201e", 0x85: "\u2026",
    0x86: "\u2020", 0x87: "\u2021", 0x88: "\u02c6", 0x89: "\u2030",
    0x8A: "\u0160", 0x8B: "\u2039", 0x8C: "\u0152", 0x91: "\u2018",
    0x92: "\u2019", 0x93: "\u201c", 0x94: "\u201d", 0x95: "\u2022",
    0x96: "\u2013", 0x97: "\u2014", 0x98: "\u02dc", 0x99: "\u2122",
    0x9A: "\u0161", 0x9B: "\u203a", 0x9C: "\u0153", 0x9F: "\u0178",
}


class _DocError(ValueError):
    pass


def _invalid(detail):
    raise _DocError("无法读取旧版 Word 文档：" + detail)


def _slice(data, start, length, description):
    if start < 0 or length < 0 or start > len(data) or length > len(data) - start:
        _invalid(description + "不完整或超出文件范围。请重新保存为 DOCX 后上传。")
    return data[start:start + length]


def _u16(data, offset, description="文档头"):
    return struct.unpack("<H", _slice(data, offset, 2, description))[0]


def _u32(data, offset, description="文档头"):
    return struct.unpack("<I", _slice(data, offset, 4, description))[0]


def _read_fib(word):
    _slice(word, 0, 32, "文档头")
    if _u16(word, 0) != 0xA5EC:
        _invalid("该文件不是有效的 Word DOC 文档。")
    if _u16(word, 2) < 0x00C1:
        _invalid("暂不支持 Word 97 以前的格式，请先另存为 DOCX。")
    flags = _u16(word, 10)
    if flags & 0x0100:
        _invalid("文档有打开密码，请先取消密码后重新上传。")
    table_name = "1Table" if flags & 0x0200 else "0Table"

    # The counts are variable even though Word 97 normally uses 14/22/93.
    # Read and skip each complete array instead of assuming offset 0x1A2.
    csw = _u16(word, 32)
    _slice(word, 34, csw * 2, "文档头字段")
    cslw_offset = 34 + csw * 2
    cslw = _u16(word, cslw_offset)
    lw_start = cslw_offset + 2
    _slice(word, lw_start, cslw * 4, "文档头字段")
    if cslw < 4:
        _invalid("文档缺少正文长度信息。")
    cb_mac = _u32(word, lw_start)
    main_units = _u32(word, lw_start + 12)
    if main_units > _MAX_TEXT_UNITS:
        _invalid("正文长度过大或文档已损坏，请分拆为多个文件上传。")
    if cb_mac and (cb_mac > len(word) or cb_mac < lw_start + cslw * 4):
        _invalid("正文数据不完整，请重新保存为 DOCX 后上传。")
    pairs_offset = lw_start + cslw * 4
    pair_count = _u16(word, pairs_offset)
    pairs_start = pairs_offset + 2
    _slice(word, pairs_start, pair_count * 8, "正文索引")
    if pair_count <= _CLX_PAIR_INDEX:
        _invalid("文档缺少正文索引。")
    clx_pair = pairs_start + _CLX_PAIR_INDEX * 8
    clx_start = _u32(word, clx_pair)
    clx_length = _u32(word, clx_pair + 4)
    return table_name, main_units, clx_start, clx_length, cb_mac


def _piece_table(clx):
    position = 0
    # CLX consists of zero or more Prc records, followed by one Pcdt.
    while position < len(clx) and clx[position] == 0x01:
        record_size = _u16(clx, position + 1, "正文索引")
        _slice(clx, position + 3, record_size, "正文索引")
        position += 3 + record_size
    if position >= len(clx) or clx[position] != 0x02:
        _invalid("无法找到正文分段索引。")
    length = _u32(clx, position + 1, "正文分段索引")
    plc = _slice(clx, position + 5, length, "正文分段索引")
    if position + 5 + length != len(clx) or length < 4 or (length - 4) % 12:
        _invalid("正文分段索引已损坏。")
    count = (length - 4) // 12
    if not count:
        _invalid("正文分段索引为空。")
    cps = struct.unpack("<" + "I" * (count + 1), plc[:4 * (count + 1)])
    if cps[0] != 0 or any(a >= b for a, b in zip(cps, cps[1:])):
        _invalid("正文分段顺序已损坏。")
    return plc, cps, 4 * (count + 1)


def _normalize(text):
    # Keep displayed field results, omitting field instructions and markers.
    visible, field_stack = [], []
    for char in text:
        if char == "\x13":
            field_stack.append(False)
        elif char == "\x14":
            if field_stack:
                field_stack[-1] = True
        elif char == "\x15":
            if field_stack:
                field_stack.pop()
        elif all(field_stack):
            visible.append(char)
    text = "".join(visible)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\x07", "\t").replace("\x0b", "\n").replace("\x0c", "\n")
    text = text.replace("\x1e", "\u2011").replace("\x1f", "\u00ad")
    text = re.sub(r"[\x00-\x08\x0e-\x1d\x7f]", "", text)
    return "\n".join(line.rstrip() for line in text.split("\n")).strip()


def _extract_text(word, table, fib):
    _, main_units, clx_start, clx_length, cb_mac = fib
    if main_units == 0:
        return ""
    clx = _slice(table, clx_start, clx_length, "正文索引")
    plc, cps, pcd_start = _piece_table(clx)
    if cps[-1] < main_units:
        _invalid("正文长度与分段索引不符。")
    if cb_mac:
        word = word[:cb_mac]
    chunks = []
    for index, cp in enumerate(cps[:-1]):
        if cp >= main_units:
            break
        units = min(cps[index + 1], main_units) - cp
        encoded_fc = _u32(plc, pcd_start + index * 8 + 2, "正文分段索引")
        compressed = bool(encoded_fc & 0x40000000)
        offset = encoded_fc & 0x3FFFFFFF
        if compressed:
            if offset % 2:
                _invalid("正文分段位置已损坏。")
            raw = _slice(word, offset // 2, units, "正文内容")
            chunks.append("".join(_COMPRESSED_MAP.get(byte, chr(byte)) for byte in raw))
        else:
            raw = _slice(word, offset, units * 2, "正文内容")
            # A Unicode surrogate pair can straddle a piece boundary.
            chunks.append(raw.decode("utf-16-le", errors="surrogatepass"))
    try:
        text = "".join(chunks).encode("utf-16-le", errors="surrogatepass").decode("utf-16-le")
    except UnicodeError:
        _invalid("正文编码已损坏，请重新保存为 DOCX 后上传。")
    return _normalize(text)


def extract_doc(data: bytes) -> str:
    """Return main-document text, or a human-readable Chinese ValueError.

    Header/footer, comments, footnotes and embedded objects are excluded.
    RTF and XML files named .doc must be routed by their real file signatures
    before calling this function.
    """
    if not isinstance(data, bytes) or not data.startswith(OLE_MAGIC):
        raise ValueError("该文件不是有效的旧版 Word DOC 文档，请检查文件格式。")
    try:
        import olefile
    except ImportError as exc:
        raise ValueError("缺少旧版 Word 读取组件，请使用完整的角色工房程序包。") from exc
    ole = None
    try:
        ole = olefile.OleFileIO(io.BytesIO(data))
        if not ole.exists("WordDocument"):
            _invalid("文件中没有 Word 正文，可能是其他类型的文件。")
        word = ole.openstream("WordDocument").read()
        fib = _read_fib(word)
        table_name = fib[0]
        if not ole.exists(table_name):
            _invalid("缺少正文索引数据，请重新保存为 DOCX 后上传。")
        table = ole.openstream(table_name).read()
        return _extract_text(word, table, fib)
    except _DocError as exc:
        raise ValueError(str(exc)) from None
    except Exception as exc:
        raise ValueError("无法读取旧版 Word 文档：文件损坏或格式不受支持，请重新保存为 DOCX 后上传。") from exc
    finally:
        if ole is not None:
            ole.close()
