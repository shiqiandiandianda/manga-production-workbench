/**
 * 编号生成与校验。
 *
 * 纯领域模块：不 import node:*，Node 与浏览器都能用。
 * 所有 ID 由服务端生成，格式 `前缀_<uuid v4>`；禁止用文件名、标题、序号当主键。
 */
const PREFIX = /^[a-z][a-z0-9]{0,15}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ID_PREFIXES = Object.freeze({
  project: 'proj',
  episode: 'ep',
  document: 'doc',
  asset: 'asset',
  assetRevision: 'rev',
  task: 'task',
  attempt: 'att',
  lease: 'lease',
  worker: 'worker',
  event: 'evt'
});

export function newId(prefix) {
  if (!PREFIX.test(String(prefix ?? ''))) {
    throw new Error('ID 前缀必须是小写字母开头的小写字母数字');
  }
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.randomUUID !== 'function') {
    throw new Error('当前运行时缺少 crypto.randomUUID，需要 Node 19+ 或现代浏览器');
  }
  // 必须作为方法调用：WebCrypto 的 randomUUID 校验 this。
  return `${prefix}_${crypto.randomUUID()}`;
}

export function isId(value, prefix) {
  if (typeof value !== 'string') return false;
  const head = prefix ? `${prefix}_` : '';
  if (prefix && !value.startsWith(head)) return false;
  const rest = value.slice(head.length);
  return UUID_V4.test(rest);
}

export function assertId(value, prefix, label = '编号') {
  if (!isId(value, prefix)) {
    throw new Error(`${label}无效`);
  }
  return value;
}
