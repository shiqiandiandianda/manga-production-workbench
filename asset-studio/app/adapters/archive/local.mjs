/**
 * 本地内容寻址存储（LocalArchive）。
 *
 * 阶段 2 的文件权威：按 sha256 存字节，路径 `sha256/ab/cd/<sha256>`。
 * 阶段 5 换成 MokuArchive 时，接口不变；本地实现继续用于缓存与离线。
 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fail} from '../../core/errors.mjs';
import {sha256Bytes} from '../../platform/fs/hash.mjs';

export const MAX_BLOB_BYTES = 64 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

export function createLocalArchive({root, maxBytes = MAX_BLOB_BYTES} = {}) {
  if (!root) throw new Error('LocalArchive 需要 root 目录');
  const base = path.resolve(root);
  const blobRoot = path.join(base, 'sha256');
  const tempRoot = path.join(base, 'tmp');
  fs.mkdirSync(blobRoot, {recursive: true});
  fs.mkdirSync(tempRoot, {recursive: true});

  function blobPath(sha256) {
    const value = String(sha256 ?? '').toLowerCase();
    if (!SHA256.test(value)) throw fail.invalid('sha256 格式不正确');
    return path.join(blobRoot, value.slice(0, 2), value.slice(2, 4), value);
  }

  function ensureParent(sha256) {
    fs.mkdirSync(path.dirname(blobPath(sha256)), {recursive: true});
    return blobPath(sha256);
  }

  function finalize(temp, sha256) {
    const target = ensureParent(sha256);
    if (fs.existsSync(target)) {
      fs.unlinkSync(temp);
    } else {
      fs.renameSync(temp, target);
    }
    const stat = fs.statSync(target);
    return {sha256, size: stat.size, path: target};
  }

  return {
    kind: 'local',
    root: base,

    async health() {
      try {
        const probe = path.join(tempRoot, `.probe-${randomUUID()}`);
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return {ok: true};
      } catch (error) {
        return {ok: false, detail: error.message};
      }
    },

    /** 写入字节，返回 {sha256, size, path}。已存在时直接复用。 */
    async put(bytes) {
      if (!Buffer.isBuffer(bytes)) throw fail.invalid('put 需要 Buffer');
      if (!bytes.length) throw fail.invalid('不能写入空文件');
      if (bytes.length > maxBytes) throw fail.invalid(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB`);
      const sha256 = sha256Bytes(bytes);
      const target = ensureParent(sha256);
      if (fs.existsSync(target)) {
        return {sha256, size: fs.statSync(target).size, path: target};
      }
      const temp = path.join(tempRoot, `${randomUUID()}.part`);
      fs.writeFileSync(temp, bytes, {flag: 'wx'});
      return finalize(temp, sha256);
    },

    /** 从磁盘复制一个文件，边读边算 sha256，避免整文件进内存。 */
    async putFile(file) {
      const source = path.resolve(file);
      const stat = fs.statSync(source);
      if (!stat.size) throw fail.invalid('不能写入空文件');
      if (stat.size > maxBytes) throw fail.invalid(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB`);

      const temp = path.join(tempRoot, `${randomUUID()}.part`);
      const hash = createHash('sha256');
      try {
        await pipeline(
          createReadStream(source),
          new Transform({
            transform(chunk, _encoding, callback) {
              hash.update(chunk);
              callback(null, chunk);
            }
          }),
          createWriteStream(temp, {flags: 'wx'})
        );
      } catch (error) {
        try {
          fs.unlinkSync(temp);
        } catch {
          /* 临时文件可能尚未创建 */
        }
        throw error;
      }
      return finalize(temp, hash.digest('hex'));
    },

    /** 读取并校验；缓存损坏时明确报错，不用同名文件顶替。 */
    async get(sha256) {
      const file = blobPath(sha256);
      if (!fs.existsSync(file)) throw fail.notFound('文件不存在');
      const bytes = fs.readFileSync(file);
      if (sha256Bytes(bytes) !== String(sha256).toLowerCase()) {
        throw fail.internal('缓存文件校验失败');
      }
      return bytes;
    },

    async stat(sha256) {
      const file = blobPath(sha256);
      try {
        const stat = fs.statSync(file);
        return stat.isFile() ? {size: stat.size, path: file} : null;
      } catch {
        return null;
      }
    },

    pathFor(sha256) {
      return blobPath(sha256);
    }
  };
}
