/**
 * 资产身份与版本模型（纯领域）。
 *
 * 关键规则：
 * - 资产身份由 (projectId, assetKey) 决定；不同服装/形态/视角/年龄不合并。
 * - 资产版本必须同时持有墨库 revisionId 与 sha256；文件名、路径、"最新一张"都不是版本。
 * - 批准状态只由审核用例推进，生成器不能直接把候选改成 approved。
 */
import {fail} from '../errors.mjs';

export const ASSET_ROLES = Object.freeze(['character', 'scene', 'prop', 'style']);
export const REVISION_STATUS = Object.freeze(['candidate', 'approved', 'rejected', 'superseded']);

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function cleanRole(value) {
  const role = normalizeText(value);
  if (!ASSET_ROLES.includes(role)) {
    throw fail.invalid(`资产类型必须是 ${ASSET_ROLES.join(' / ')} 之一`);
  }
  return role;
}

/**
 * assetKey = role|name|state|view，全部归一化。
 * 例：character|李明|校服|正面
 */
export function assetKeyOf({role, name, state = '', view = ''}) {
  const roleKey = cleanRole(role);
  const nameKey = normalizeText(name);
  if (!nameKey) throw fail.invalid('资产名称不能为空');
  return [roleKey, nameKey, normalizeText(state), normalizeText(view)].join('|');
}

export function parseAssetKey(assetKey) {
  const parts = String(assetKey ?? '').split('|');
  if (parts.length !== 4) throw fail.invalid('资产编号格式不正确');
  return {role: parts[0], name: parts[1], state: parts[2], view: parts[3]};
}

export function createAssetIdentity({
  id,
  projectId,
  role,
  name,
  state = '',
  view = '',
  now
}) {
  if (!id) throw fail.invalid('缺少资产编号');
  if (!projectId) throw fail.invalid('缺少项目编号');
  if (!now) throw fail.invalid('缺少创建时间');
  const displayName = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!displayName) throw fail.invalid('资产名称不能为空');
  const roleKey = cleanRole(role);
  return {
    id,
    projectId,
    assetKey: assetKeyOf({role: roleKey, name: displayName, state, view}),
    role: roleKey,
    name: displayName,
    state: String(state ?? '').replace(/\s+/g, ' ').trim(),
    view: String(view ?? '').replace(/\s+/g, ' ').trim(),
    createdAt: now,
    updatedAt: now
  };
}

const SHA256 = /^[a-f0-9]{64}$/i;

export function createAssetRevision({
  id,
  assetId,
  revisionId,
  sha256,
  mime,
  size,
  status = 'candidate',
  now
}) {
  if (!id) throw fail.invalid('缺少版本编号');
  if (!assetId) throw fail.invalid('缺少资产编号');
  if (!now) throw fail.invalid('缺少创建时间');
  const fixedRevision = String(revisionId ?? '').trim();
  if (!fixedRevision || fixedRevision.length > 200) {
    throw fail.invalid('缺少合法的墨库 revisionId');
  }
  if (!SHA256.test(String(sha256 ?? ''))) throw fail.invalid('sha256 必须是 64 位十六进制');
  const type = String(mime ?? '').trim().toLowerCase();
  if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(type)) throw fail.invalid('mime 格式不正确');
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes <= 0) throw fail.invalid('文件大小必须是正整数');
  if (!REVISION_STATUS.includes(status)) throw fail.invalid('版本状态不正确');
  return {
    id,
    assetId,
    revisionId: fixedRevision,
    sha256: String(sha256).toLowerCase(),
    mime: type,
    size: bytes,
    status,
    createdAt: now
  };
}

export function shortRevision(revisionId) {
  const value = String(revisionId ?? '');
  return value.length <= 10 ? value : value.slice(0, 10);
}
