// 局域网协作协议共享模块：中控、节点、测试共用。只依赖 node: 内置模块，不新增 npm 依赖。
// 本文件是「协议与设计.md」的可执行部分；改动常量/状态机必须同步文档与测试。
import {createHash, randomUUID, randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PROTOCOL_VERSION = '1.0.0';
export const HUB_APPLICATION = 'photocraft-collab-hub';
export const NODE_APPLICATION = 'photocraft-collab-node';
export const CLIENT_APPLICATION = 'photocraft-collab-client';
export const HUB_VERSION = '1.0.0';
export const NODE_VERSION = '1.0.0';

export const TASK_TYPES = ['panel-generation', 'asset-generation'];
export const TASK_STATUSES = ['queued', 'running', 'uploading', 'done', 'failed', 'verifying', 'cancelled'];
export const TASK_ACTIVE_STATUSES = ['queued', 'running', 'uploading', 'verifying'];
export const TASK_TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];
export const ATTEMPT_STATUSES = ['claimed', 'generating', 'uploading', 'upload_failed', 'unknown', 'succeeded', 'failed', 'abandoned'];
export const APPLY_STATUSES = ['pending', 'applied', 'conflict', 'candidate', 'failed', 'skipped'];
export const ASSET_STATUSES = ['available', 'pending', 'failed'];
export const ASSET_KINDS = ['character', 'prop', 'scene', 'style', 'panel', 'other'];
export const NODE_ROLES = ['node', 'client'];
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

export const PHASE = Object.freeze({
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  GENERATING: 'generating',
  UPLOADING: 'uploading',
  VERIFYING: 'verifying',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

// 任务主状态机：中控只按这里允许的迁移改状态，避免并发写坏。
// verifying → queued：人工核实后允许重新派单（协议 §4.3 retry / §5.4）。
const TASK_TRANSITIONS = {
  queued: ['running', 'cancelled'],
  running: ['uploading', 'done', 'failed', 'verifying', 'cancelled'],
  uploading: ['done', 'failed', 'verifying', 'cancelled'],
  verifying: ['done', 'failed', 'cancelled', 'queued'],
  done: [],
  failed: ['queued', 'cancelled'],
  cancelled: ['queued'],
};

export const TASK_TRANSITION_TABLE = TASK_TRANSITIONS;

export class CollabError extends Error {
  constructor(message, {status = 400, code = 'collab_error', details = null} = {}) {
    super(message);
    this.name = 'CollabError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function check(condition, message, status = 400, code = 'collab_error', details = null) {
  if (!condition) throw new CollabError(message, {status, code, details});
}

export function canTransitionTask(from, to) {
  return (TASK_TRANSITIONS[from] || []).includes(to);
}

export function assertTransition(from, to) {
  check(canTransitionTask(from, to), `任务状态不能从 ${from} 变为 ${to}`, 409, 'invalid_transition');
}

export function uid(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function hashJson(value) {
  return sha256(Buffer.from(JSON.stringify(value), 'utf8'));
}

export function pairingCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

export function tokenHash(token) {
  return sha256(String(token));
}

export function newToken() {
  return randomBytes(24).toString('base64url');
}

export function clampInteger(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

// ---------------------------------------------------------------------------
// 图片校验：不依赖 canvas / 任何图像库，按文件头解析真实格式与像素尺寸。
// 中控收到结果时用它验证「文件完整、可读取」，节点上传前也会本地校验一次。
// ---------------------------------------------------------------------------
export function inspectImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  // PNG: 8 字节签名 + IHDR
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return {mime: 'image/png', ext: '.png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
  }
  // JPEG: 扫描 SOF0/SOF1/SOF2 等帧标记
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (offset + 4 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (offset + 9 > buffer.length) break;
        return {mime: 'image/jpeg', ext: '.jpg', width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5)};
      }
      offset += 2 + segmentLength;
    }
    return null;
  }
  // WebP: RIFF....WEBP
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') {
      return {mime: 'image/webp', ext: '.webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff};
    }
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return {mime: 'image/webp', ext: '.webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1};
    }
    if (chunk === 'VP8X') {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return {mime: 'image/webp', ext: '.webp', width, height};
    }
    return null;
  }
  return null;
}

export function validateImageBuffer(buffer, {maxBytes = 64 * 1024 * 1024} = {}) {
  check(Buffer.isBuffer(buffer) && buffer.length > 0, '图片内容为空', 400, 'empty_image');
  check(buffer.length <= maxBytes, `图片超过大小上限（${buffer.length} > ${maxBytes}）`, 413, 'image_too_large');
  const info = inspectImageBuffer(buffer);
  check(info, '不是可识别的 PNG/JPEG/WebP 图片，可能上传不完整', 400, 'invalid_image');
  check(info.width > 0 && info.height > 0, '图片像素尺寸无效', 400, 'invalid_image');
  check(info.width <= 20000 && info.height <= 20000, '图片像素尺寸超出范围', 400, 'invalid_image');
  return info;
}

// ---------------------------------------------------------------------------
// 共享资产去重键：只看语义字段，不看文件名；不同形态/服装/画风不会被合并。
// 仅用于「查重」；真正落库仍保留全部字段，旧版本不会被覆盖。
// ---------------------------------------------------------------------------
export function normalizeAssetText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u3000\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeAssetKey({projectId = '', kind = 'other', name = '', form = '', costume = '', style = ''} = {}) {
  const parts = [projectId, kind, normalizeAssetText(name), normalizeAssetText(form), normalizeAssetText(costume), normalizeAssetText(style)];
  return parts.join('|');
}

export function normalizeProjectId(value) {
  return String(value ?? '').trim();
}

// ---------------------------------------------------------------------------
// 原子写：先写临时文件再 rename，避免中控/节点在崩溃时留下半个 JSON。
// ---------------------------------------------------------------------------
export function ensureDir(directory) {
  fs.mkdirSync(directory, {recursive: true});
  return directory;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, {force: true}); } catch {}
    throw error;
  }
}

export function safeFileSegment(value, fallback = 'item') {
  const text = String(value ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+$/, '_').slice(0, 120);
  return text || fallback;
}

export function safeFileName(value, fallback = 'file.png') {
  const segment = safeFileSegment(value, '');
  return segment || fallback;
}

// ---------------------------------------------------------------------------
// 请求体读取：带大小限制，供中控与测试复用。
// ---------------------------------------------------------------------------
export async function readBody(stream, maxBytes = 4 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    check(total <= maxBytes, '请求体超过大小限制', 413, 'body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(stream, maxBytes = 4 * 1024 * 1024) {
  const buffer = await readBody(stream, maxBytes);
  try {
    return JSON.parse(buffer.toString('utf8') || '{}');
  } catch {
    throw new CollabError('请求不是有效 JSON', {status: 400, code: 'invalid_json'});
  }
}

export function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': body.length,
  });
  response.end(body);
}

export function bearerToken(request) {
  const header = request.headers['x-collab-token'] || request.headers['x-node-token'] || '';
  if (header) return String(header).trim();
  const authorization = String(request.headers.authorization || '');
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
}

// 节点只允许执行固定类型的任务；中控与节点都要在入口校验，避免任一环节被篡改。
export function validateTaskShape(task) {
  const errors = [];
  if (!task || typeof task !== 'object') return ['任务不是对象'];
  if (!TASK_TYPES.includes(task.type)) errors.push(`不支持的任务类型：${task.type}`);
  if (!task.projectId || typeof task.projectId !== 'string') errors.push('缺少 projectId');
  if (!task.panelCode && task.type === 'panel-generation') errors.push('缺少 panelCode');
  if (!task.generationInput || typeof task.generationInput !== 'object') errors.push('缺少 generationInput');
  if (task.generationInput && JSON.stringify(task.generationInput).length > 512 * 1024) errors.push('generationInput 过大');
  if (!Array.isArray(task.references)) errors.push('references 必须是数组');
  if (Array.isArray(task.references)) {
    for (const reference of task.references) {
      if (!reference || typeof reference.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(reference.sha256)) errors.push('参考图 sha256 无效');
      if (reference && typeof reference.role !== 'string') errors.push('参考图缺少 role');
    }
  }
  return errors;
}

export function publicNode(node) {
  if (!node) return null;
  const {tokenHash: _tokenHash, ...rest} = node;
  return rest;
}

export function isLoopbackAddress(address) {
  const value = String(address || '');
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1' || value === 'localhost';
}

export function normalizeOrigin(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  check(/^https?:\/\/[^/\s]+$/i.test(text), `中控地址无效：${value}（应为 http://IP:端口）`);
  return text;
}
