/**
 * 最小可用的 ZIP 读取器（只读，够解析 docx / epub 用）。
 *
 * 为什么自己写：工作台要零第三方依赖，而 Node 没有内置解压 API。
 * 这里只实现"按中央目录定位、按条目解压"这一条路径，不支持 ZIP64、不支持加密。
 *
 * 用法：
 *   const entries = listZipEntries(buffer);          // [{name, method, compressedSize, offset}]
 *   const bytes = readZipEntry(buffer, 'word/document.xml');
 */
import {inflateRawSync} from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** 从末尾往前找中央目录结束记录（EOCD），注释最多 64KB */
function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD) return offset;
  }
  return -1;
}

/**
 * 列出压缩包里所有条目（不读取内容）。
 * @returns {Array<{name:string, method:number, compressedSize:number, uncompressedSize:number, dataOffset:number}>}
 */
export function listZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw Object.assign(new Error('这不是有效的压缩包文件。'), {code: 'zip_invalid'});
  }
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) {
    throw Object.assign(new Error('压缩包结构无法识别（可能不是 ZIP/docx/epub）。'), {code: 'zip_no_eocd'});
  }
  const total = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (total === 0xffff || directoryOffset === 0xffffffff) {
    throw Object.assign(new Error('暂不支持 ZIP64 格式的压缩包。'), {code: 'zip64_unsupported'});
  }

  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < total; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    // 通用标志位 11 表示文件名是 UTF-8；这里统一按 UTF-8 解，失败再退回 latin1
    let name;
    try {
      name = rawName.toString('utf8');
    } catch {
      name = rawName.toString('latin1');
    }

    // 本地文件头里才有扩展字段长度，数据起点要按它算
    if (localOffset + 30 <= buffer.length && buffer.readUInt32LE(localOffset) === LOCAL) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      entries.push({name, method, compressedSize, uncompressedSize, dataOffset});
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 解压单个条目，返回 Buffer */
export function readZipEntry(buffer, entry) {
  const start = entry.dataOffset;
  const end = start + entry.compressedSize;
  if (end > buffer.length) {
    throw Object.assign(new Error(`压缩包条目损坏：${entry.name}`), {code: 'zip_entry_truncated'});
  }
  const payload = buffer.subarray(start, end);
  if (entry.method === 0) return Buffer.from(payload);
  if (entry.method === 8) {
    try {
      return inflateRawSync(payload, {maxOutputLength: 64 * 1024 * 1024});
    } catch (error) {
      throw Object.assign(new Error(`压缩包条目解压失败：${entry.name}`), {code: 'zip_inflate_failed', cause: error});
    }
  }
  throw Object.assign(new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`), {code: 'zip_method_unsupported'});
}

/** 按名字直接取一个条目的内容；不存在返回 null */
export function readZipFile(buffer, name, {caseInsensitive = true} = {}) {
  const entries = listZipEntries(buffer);
  const target = caseInsensitive ? String(name).toLowerCase() : name;
  const entry = entries.find(item => (caseInsensitive ? item.name.toLowerCase() : item.name) === target);
  if (!entry) return null;
  return readZipEntry(buffer, entry);
}
