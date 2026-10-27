/**
 * 内容哈希工具。
 */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';

export function sha256Bytes(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('sha256Bytes 需要 Buffer');
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Text(text) {
  return sha256Bytes(Buffer.from(String(text), 'utf8'));
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}
