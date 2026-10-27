/**
 * 命名与归档引擎。
 *
 * 目标：生图平台只说"这是什么资产"，落盘文件名/目录由本机规则决定，且规则可改、
 * 可预览、可复现。旧版把文件名写死成 randomUUID().png 或 xxx.png，
 * 结果素材库无法按业务检索——这里改为模板驱动。
 *
 * 模板变量（缺省值为空字符串，不会留下 '{xxx}' 之类的残渣）：
 *   {project} {type} {typeLabel} {character} {outfit} {view} {part} {style} {era}
 *   {gender} {version} {index} {job} {scene} {canonicalKey} {ext}
 *   {date} {time} {datetime} {yyyy} {MM} {dd} {HH} {mm} {ss}
 *
 * 反斜杠与正斜杠都当目录分隔符；每一级都会做文件名净化，
 * 因此调用方无需担心平台传来的名字里带 ':' 或 '..'。
 */
import path from 'node:path';
import {fileExists, safeName, sha256} from './store.mjs';

export const ASSET_TYPES = {
  face: '完整头图',
  face_candidate: '定脸候选',
  face_core: '纯五官',
  hairstyle: '发型',
  body: '身体底稿',
  clothing: '服装',
  card: '角色卡',
  hands: '八格手部',
  combined: '上下合成',
  crowd: '群像套组',
  scene: '场景分镜',
  shot: '镜头',
  reference: '参考图',
  upload: '上传素材',
  misc: '其他'
};

const VARIABLE_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

export function timeParts(date = new Date(), timeZone = 'Asia/Shanghai') {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
  }
  const parts = {};
  for (const item of formatter.formatToParts(date)) {
    if (item.type !== 'literal') parts[item.type] = item.value;
  }
  const yyyy = parts.year || String(date.getUTCFullYear());
  const MM = parts.month || pad(date.getUTCMonth() + 1);
  const dd = parts.day || pad(date.getUTCDate());
  const HH = parts.hour === '24' ? '00' : parts.hour || pad(date.getUTCHours());
  const mm = parts.minute || pad(date.getUTCMinutes());
  const ss = parts.second || pad(date.getUTCSeconds());
  return {yyyy, MM, dd, HH, mm, ss, date: `${yyyy}${MM}${dd}`, time: `${HH}${mm}${ss}`, datetime: `${yyyy}${MM}${dd}-${HH}${mm}${ss}`};
}

export function buildVariables(input = {}, options = {}) {
  const type = String(input.type || 'misc');
  const clock = timeParts(input.createdAt ? new Date(input.createdAt) : new Date(), options.timeZone || 'Asia/Shanghai');
  const raw = {
    project: input.project || input.projectName || '',
    type,
    typeLabel: ASSET_TYPES[type] || type,
    character: input.character || input.characterName || '',
    outfit: input.outfit || input.outfitName || '',
    view: input.view || '',
    part: input.part || '',
    style: input.style || '',
    era: input.era || '',
    gender: input.gender || '',
    ageStage: input.ageStage || '',
    version: input.version ? String(input.version) : 'v1',
    index: input.index !== undefined && input.index !== null && input.index !== '' ? String(input.index) : '',
    job: input.jobId || input.job || '',
    scene: input.scene || input.sceneName || '',
    canonicalKey: input.canonicalKey || '',
    chapter: input.chapter !== undefined && input.chapter !== null ? String(input.chapter) : '',
    ext: input.ext || 'png',
    ...clock
  };
  const extra = input.vars && typeof input.vars === 'object' ? input.vars : {};
  for (const [key, value] of Object.entries(extra)) {
    if (!(key in raw)) raw[key] = value;
  }
  return raw;
}

export function applyTemplate(template, variables, {sanitize = true} = {}) {
  const expanded = String(template).replace(VARIABLE_PATTERN, (_, name) => {
    const value = variables[name];
    return value === undefined || value === null ? '' : String(value);
  });
  const segments = expanded
    .split(/[\\/]+/)
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => {
      // 变量留空会产生 "a__b"、"a_-_b" 这类残迹，落盘前统一压掉多余连接符，
      // 避免素材库里出现一串下划线的文件名。
      const cleaned = segment
        .replace(/[\s]*[_\-]{2,}[\s]*/g, '_')
        .replace(/^[_\-\s]+/, '')
        .replace(/[_\-\s]+$/, '');
      return sanitize ? safeName(cleaned, {max: 120}) : cleaned;
    })
    .filter(Boolean);
  const cleaned = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '..') continue;
    cleaned.push(segment);
  }
  return cleaned.join(path.sep);
}

/** 生成不含扩展名的相对路径，并保证扩展名统一小写。 */
export function buildRelativePath({template, variables, ext = 'png', extension = true} = {}) {
  const relative = applyTemplate(template || '{project}/{type}/{character}_{version}', variables);
  const safeExt = safeName(String(ext).replace(/^\./, ''), {max: 12, fallback: 'png'}).toLowerCase();
  const base = relative || safeName(variables?.type || 'asset');
  if (!extension) return base;
  return /\.(png|jpe?g|webp|gif|json|txt|mp4)$/i.test(base) ? base : `${base}.${safeExt}`;
}

/**
 * 处理目标已存在的情况。
 *  - overwrite：直接用原名
 *  - skip：返回 null（调用方放弃写入）
 *  - hash：追加内容短哈希
 *  - version：v1、v2、v3…（默认，最符合"同一资产多版本"的直觉）
 */
export async function resolveCollision(targetPath, {policy = 'version', contentHash = ''} = {}) {
  if (!(await fileExists(targetPath))) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const stem = path.basename(targetPath, ext);
  if (policy === 'overwrite') return targetPath;
  if (policy === 'skip') return null;
  if (policy === 'hash') {
    const suffix = (contentHash || sha256(String(Date.now()))).slice(0, 8);
    return path.join(dir, `${stem}_${suffix}${ext}`);
  }
  const match = /^(.*)_v(\d+)$/.exec(stem);
  const baseStem = match ? match[1] : stem;
  let version = match ? Number(match[2]) : 1;
  for (let attempt = 0; attempt < 9999; attempt++) {
    version += 1;
    const candidate = path.join(dir, `${baseStem}_v${version}${ext}`);
    if (!(await fileExists(candidate))) return candidate;
  }
  throw Object.assign(new Error('同名文件过多，无法生成新版本名。'), {status: 409, code: 'collision_exhausted'});
}

/** 拼接目标根目录与相对路径，超出 Windows 长路径限制时加 \\?\ 前缀。 */
export function joinDestination(root, relative) {
  const joined = path.isAbsolute(relative) ? relative : path.join(root, relative);
  const normalized = path.normalize(joined);
  if (process.platform === 'win32' && normalized.length >= 250 && !normalized.startsWith('\\\\?\\')) {
    return normalized.startsWith('\\\\') ? `\\\\?\\UNC\\${normalized.slice(2)}` : `\\\\?\\${normalized}`;
  }
  return normalized;
}

/** 去掉 \\?\ 前缀，用于展示与索引（索引里存可读路径更有用）。 */
export function displayPath(target) {
  if (target.startsWith('\\\\?\\UNC\\')) return `\\\\${target.slice(8)}`;
  if (target.startsWith('\\\\?\\')) return target.slice(4);
  return target;
}

/**
 * 一次性算出所有启用位置的最终路径，并按主位置处理重名，
 * 保证多个位置上的文件名完全一致（素材接口按相对路径去重）。
 */
export async function planTargets({destinations, relative, policy, contentHash}) {
  const enabled = destinations.filter(entry => entry.enabled);
  const primary = enabled.find(entry => entry.role === 'primary') || enabled[0];
  if (!primary) throw Object.assign(new Error('没有启用中的存储位置。'), {status: 500, code: 'no_destination'});
  const primaryTarget = joinDestination(primary.path, relative);
  const resolvedPrimary = await resolveCollision(primaryTarget, {policy, contentHash});
  if (!resolvedPrimary) return null;
  const finalRelative = path.relative(primary.path, resolvedPrimary);
  const targets = enabled.map(entry => ({
    destinationId: entry.id,
    label: entry.label,
    root: entry.path,
    path: joinDestination(entry.path, finalRelative),
    writable: entry.writable !== false
  }));
  return {relative: finalRelative, primaryId: primary.id, targets};
}
