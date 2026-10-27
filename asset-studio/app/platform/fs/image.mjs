/**
 * 不做完整解码，只根据文件头判断图片类型。
 *
 * 迁移器与预览接口用它给缓存文件一个可靠的 Content-Type；
 * 尺寸、像素校验仍由上游（墨库/旧工程记录）负责。
 */
import fs from 'node:fs';

const EXTENSION_MIME = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
});

export function mimeForExtension(extension) {
  return EXTENSION_MIME[String(extension ?? '').toLowerCase()] ?? 'application/octet-stream';
}

export function sniffImageMime(bytes, fallbackExtension = '') {
  if (Buffer.isBuffer(bytes) && bytes.length >= 12) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
      return 'image/webp';
    }
  }
  return mimeForExtension(fallbackExtension);
}

/** 只读文件头，避免为了判断类型把整张图读进内存。 */
export function sniffImageMimeOfFile(file, fallbackExtension = '') {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    return sniffImageMime(head.subarray(0, read), fallbackExtension);
  } finally {
    fs.closeSync(fd);
  }
}
