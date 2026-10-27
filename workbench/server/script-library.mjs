/**
 * 剧本库：全工作台唯一的一份剧本来源。
 *
 * 解决的问题：以前场记和角色工房各自要求上传一次剧本，同一部小说要导两遍，
 * 章节范围、正文还可能对不上。现在只在这里导入一次，保存成"剧本记录"，
 * 再一键分发给两个模块——它们仍然各自做擅长的分析，但输入是同一份。
 *
 * 存储：data/scripts/index.json（列表）+ data/scripts/<id>.json（正文与章节）
 */
import path from 'node:path';
import {readFile, writeFile, mkdir, rm, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readJson, atomicJson, safeName} from './store.mjs';
import {paths} from './paths.mjs';
import {listZipEntries, readZipFile} from './zip-read.mjs';

const MAX_TEXT = 5_000_000;
const MAX_BYTES = 60 * 1024 * 1024;
const DEFAULT_CHUNK = 4000;

/** 场记默认的场景格式（与它的 DEFAULT_FORMAT 对齐，避免分发后还要手填） */
const SCENE_FORMAT = {
  layout: 'shot-reverse',
  confirmed: true,
  style: '国漫线稿，清晰的手绘描线，写实空间与透视，细节丰富；光照服从剧本。',
  template: '场景：{{name}}。{{description}}',
  referenceImages: [],
  referenceNames: [],
  size: '1536x864',
  showChapterSubtitle: false,
  showPanelLabels: false
};

let parseScriptCache = null;

/** 复用场记的章节解析规则，保证两边切章一致 */
async function loadParseScript() {
  if (parseScriptCache) return parseScriptCache;
  const file = path.join(paths.sceneApp, 'src', 'lib', 'script-structure.ts');
  if (!existsSync(file)) return null;
  try {
    const module = await import(pathToFileURL(file).href);
    parseScriptCache = module.parseScript;
    return parseScriptCache;
  } catch {
    return null;
  }
}

/* ------------------------------ 文本解码 ------------------------------ */

export function decodeText(bytes) {
  if (!bytes?.length) return '';
  // BOM
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  // 先按 UTF-8 严格解，失败再退回 GB18030（中文 TXT 常见）
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

/* ------------------------------ 各格式解析 ------------------------------ */

function stripXml(xml) {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/text:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function tidy(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readDocx(bytes) {
  const xml = readZipFile(bytes, 'word/document.xml');
  if (!xml) throw Object.assign(new Error('这个 DOCX 里没有找到正文（word/document.xml），可能不是 Word 文档。'), {code: 'docx_no_body'});
  return tidy(stripXml(xml.toString('utf8')));
}

function readEpub(bytes) {
  const entries = listZipEntries(bytes)
    .filter(entry => /\.(x?html?|htm)$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  if (!entries.length) throw Object.assign(new Error('这个 EPUB 里没有找到可读的正文页。'), {code: 'epub_no_pages'});
  const parts = [];
  for (const entry of entries) {
    const raw = readZipFile(bytes, entry.name);
    if (!raw) continue;
    const text = tidy(stripXml(raw.toString('utf8')));
    if (text) parts.push(text);
  }
  return tidy(parts.join('\n\n'));
}

/* ------------------------------ 章节切分 ------------------------------ */

/** 比场记多认几个中文小说常见标题词，用于它没切出来时的兜底 */
const EXTRA_HEADING = /^(?:第[零〇一二三四五六七八九十百千万两\d]+[卷篇夜话]|序章|序言|楔子|尾声|后记|番外)/;

/** 按段落把长文本切成近似等长的块，尽量不在句子中间断开 */
function chunkByParagraph(text, size = DEFAULT_CHUNK) {
  const paragraphs = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current.length && current.length + paragraph.length + 1 > size) {
      chunks.push(current);
      current = '';
    }
    if (paragraph.length > size) {
      // 单段就超长：按句号切开
      const sentences = paragraph.split(/(?<=[。！？…])/);
      for (const sentence of sentences) {
        if (current.length + sentence.length > size && current) {
          chunks.push(current);
          current = '';
        }
        current += sentence;
      }
      continue;
    }
    current += (current ? '\n' : '') + paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * 把正文切成章节。
 * 先用场记的规则；切不出来（只有一段）时依次尝试：补充标题词、按段落分块。
 */
export async function splitChapters(text) {
  const body = tidy(String(text || ''));
  if (!body) return {chapters: [], method: 'empty'};

  const parseScript = await loadParseScript();
  if (parseScript) {
    try {
      const parsed = parseScript(body);
      const meaningful = parsed.chapters.filter(chapter => chapter.text.trim().length > 0);
      const looksLikeSinglePreamble = meaningful.length === 1 && /序言\s*\/\s*正文/.test(meaningful[0].title);
      if (meaningful.length >= 2 || (meaningful.length === 1 && body.length <= DEFAULT_CHUNK && !looksLikeSinglePreamble)) {
        return {
          chapters: meaningful.map((chapter, index) => ({
            index: index + 1,
            title: chapter.title.replace(/^#{1,6}\s*/, '').trim() || `第 ${index + 1} 章`,
            text: tidy(chapter.text)
          })),
          method: 'headings'
        };
      }
    } catch {
      /* 退到下面的兜底 */
    }
  }

  // 兜底 1：补充的标题词
  const lines = body.split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && trimmed.length <= 40 && EXTRA_HEADING.test(trimmed)) {
      if (current && current.text.trim()) sections.push(current);
      current = {title: trimmed, text: `${trimmed}\n`};
      continue;
    }
    if (!current) current = {title: '序言 / 正文', text: ''};
    current.text += `${line}\n`;
  }
  if (current && current.text.trim()) sections.push(current);
  if (sections.length >= 2) {
    return {
      chapters: sections.map((section, index) => ({
        index: index + 1,
        title: section.title.replace(/^#{1,6}\s*/, '').trim() || `第 ${index + 1} 章`,
        text: tidy(section.text)
      })),
      method: 'extra-headings'
    };
  }

  // 兜底 2：按段落分块（长文才分，短文就一段）
  if (body.length <= DEFAULT_CHUNK) {
    return {chapters: [{index: 1, title: '全文', text: body}], method: 'single'};
  }
  const chunks = chunkByParagraph(body);
  return {
    chapters: chunks.map((chunk, index) => ({index: index + 1, title: `第 ${index + 1} 段`, text: chunk})),
    method: 'chunked'
  };
}

/**
 * 把上传的文件转成纯文本（不落库）。
 * 支持 .txt / .md / .docx / .epub；.doc 与 .pdf 给出明确的转换指引。
 */
export function fileToText({fileName, bytes}) {
  if (!bytes?.length) throw badRequest('文件是空的。');
  if (bytes.length > MAX_BYTES) throw badRequest(`文件超过 ${Math.round(MAX_BYTES / 1024 / 1024)} MB，请分卷导入。`);
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (extension === '.docx') return readDocx(bytes);
  if (extension === '.epub') return readEpub(bytes);
  if (['.txt', '.md', '.markdown', ''].includes(extension)) return tidy(decodeText(bytes));
  if (extension === '.doc') throw badRequest('旧版 .doc 不支持直接读取，请在 Word 里另存为 .docx 后重试。');
  if (extension === '.pdf') throw badRequest('PDF 暂不支持直接读取。请先转成 DOCX 或 TXT（扫描件需要先做文字识别）。');
  throw badRequest(`不支持的文件类型：${extension || '未知'}。支持 .txt / .md / .docx / .epub。`);
}

/* ------------------------------ 剧本库 ------------------------------ */

export function createScriptLibrary({config, logger}) {
  const root = path.join(paths.data, 'scripts');
  const indexFile = path.join(root, 'index.json');
  let cache = null;

  async function ensureDir() {
    await mkdir(root, {recursive: true});
  }

  async function loadIndex() {
    await ensureDir();
    const raw = await readJson(indexFile, {version: 1, scripts: []});
    cache = Array.isArray(raw?.scripts) ? raw.scripts : [];
    return cache;
  }

  async function saveIndex() {
    await atomicJson(indexFile, {version: 1, updatedAt: new Date().toISOString(), scripts: cache || []});
  }

  async function list() {
    if (!cache) await loadIndex();
    return (cache || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function get(id) {
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(String(id || ''))) return null;
    const file = path.join(root, `${id}.json`);
    if (!existsSync(file)) return null;
    return await readJson(file, null);
  }

  async function remove(id) {
    const record = await get(id);
    if (!record) return null;
    await rm(path.join(root, `${id}.json`), {force: true});
    if (!cache) await loadIndex();
    cache = cache.filter(item => item.id !== id);
    await saveIndex();
    return record;
  }

  /** 导入一份正文，切章并保存 */
  async function importText({text, title, sourceName = '', format = 'paste'}) {
    const body = tidy(String(text || ''));
    if (!body) throw badRequest('正文是空的，没有可导入的内容。');
    if (body.length > MAX_TEXT) throw badRequest(`正文超过 ${MAX_TEXT} 字，请分卷导入。`);
    const {chapters, method} = await splitChapters(body);
    if (!chapters.length) throw badRequest('没能从这段文字里切出章节。');

    const now = new Date().toISOString();
    const record = {
      id: `script_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      title: String(title || safeName(sourceName.replace(/\.[^.]+$/, '')) || '未命名剧本').slice(0, 200),
      sourceName: String(sourceName || '').slice(0, 300),
      format: String(format || 'paste').slice(0, 20),
      chars: body.length,
      chapterCount: chapters.length,
      splitMethod: method,
      createdAt: now,
      updatedAt: now,
      text: body,
      chapters
    };
    await ensureDir();
    await atomicJson(path.join(root, `${record.id}.json`), record);
    if (!cache) await loadIndex();
    cache.push({
      id: record.id, title: record.title, sourceName: record.sourceName, format: record.format,
      chars: record.chars, chapterCount: record.chapterCount, splitMethod: record.splitMethod, createdAt: now
    });
    await saveIndex();
    logger?.info('已导入剧本', {id: record.id, title: record.title, chapters: chapters.length, chars: body.length});
    return record;
  }

  /** 导入文件：按扩展名选择解析方式 */
  async function importFile({fileName, bytes, title}) {
    const text = fileToText({fileName, bytes});
    return await importText({text, title: title || String(fileName || '').replace(/\.[^.]+$/, ''), sourceName: fileName, format: path.extname(String(fileName || '')).replace(/^\./, '') || 'txt'});
  }

  /* ---------------------------- 分发给两个模块 ---------------------------- */

  function pickChapters(record, rangeStart, rangeEnd) {
    const total = record.chapters.length;
    const start = Math.max(1, Math.min(Number(rangeStart) || 1, total));
    const end = Math.max(start, Math.min(Number(rangeEnd) || total, total));
    return {chapters: record.chapters.slice(start - 1, end), range: [start, end], total};
  }

  async function post(url, body, {method = 'POST', timeoutMs = 60_000} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const target = new URL(url);
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          // 两个上游引擎都按"只允许本机工作台页面"校验来源，服务端调用要自报为它自己的回环地址
          Origin: target.origin
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = {raw: text};
      }
      if (!response.ok) {
        throw Object.assign(new Error(data?.error || `上游返回 ${response.status}`), {status: response.status, code: 'upstream_error', payload: data});
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 分发给场记（场景模块）。它只有一个当前项目，分发即替换。 */
  async function distributeToScene(record, {chapters, range, title}) {
    const settings = await config.read();
    const text = chapters.map(chapter => chapter.text).join('\n\n');
    const sceneChapters = chapters.map((chapter, index) => ({
      id: `chapter-${index + 1}`,
      index: index + 1,
      title: chapter.title,
      text: chapter.text
    }));
    const batches = [];
    for (let offset = 0; offset < sceneChapters.length; offset += 10) {
      batches.push({
        id: `batch-${offset / 10 + 1}`,
        chapters: sceneChapters.slice(offset, offset + 10),
        status: 'pending',
        completedParts: 0
      });
    }
    const project = {
      sourceParsingVersion: 2,
      id: randomUUID(),
      title: String(title || record.title).slice(0, 200),
      text,
      scenes: [],
      characters: [],
      batches,
      format: {...SCENE_FORMAT}
    };
    const result = await post(`http://127.0.0.1:${settings.scene.port}/api/project`, project, {method: 'PUT'});
    return {
      ok: true,
      module: 'scene',
      projectTitle: project.title,
      chapters: sceneChapters.length,
      range,
      revision: result?.revision || '',
      note: '场记一次只保留一个项目，分发已替换它当前的项目。'
    };
  }

  /** 分发给角色工房（角色模块）。每次都新建项目，保留历史。 */
  async function distributeToWorkshop(record, {chapters, range, title}) {
    const settings = await config.read();
    const text = chapters.map(chapter => chapter.text).join('\n\n');
    const payload = {
      project: {
        name: String(title || record.title).slice(0, 160),
        script: text,
        rangeStart: range[0],
        rangeEnd: range[1],
        styleMode: 'manual',
        style: '国漫',
        workflowMode: 'manual',
        autoArchiveClothing: true,
        readRange: [range[0], range[1]],
        rangeVerified: true,
        importWarnings: [],
        availableChapters: chapters.map(chapter => ({chapter: chapter.index, title: chapter.title})),
        chapters: chapters.map(chapter => ({chapter: chapter.index, title: chapter.title, text: chapter.text}))
      }
    };
    const result = await post(`http://127.0.0.1:${settings.workshop.port}/api/projects/import`, payload, {timeoutMs: 120_000});
    return {
      ok: true,
      module: 'workshop',
      projectId: result?.id || '',
      projectTitle: result?.name || title,
      chapters: chapters.length,
      range,
      note: '角色工房每次分发都会新建一个项目，历史项目保留。'
    };
  }

  async function distribute(id, {targets = ['scene', 'workshop'], rangeStart, rangeEnd, title}) {
    const record = await get(id);
    if (!record) throw Object.assign(new Error('剧本不存在。'), {status: 404, code: 'script_missing'});
    const {chapters, range, total} = pickChapters(record, rangeStart, rangeEnd);
    if (!chapters.length) throw badRequest('选中的章节是空的。');

    const wanted = new Set((Array.isArray(targets) ? targets : [targets]).map(String));
    const report = {scriptId: record.id, scriptTitle: record.title, range, totalChapters: total, results: []};

    for (const target of ['scene', 'workshop']) {
      if (!wanted.has(target)) continue;
      const label = target === 'scene' ? '场景模块（场记）' : '角色模块（角色工房）';
      try {
        const result = target === 'scene'
          ? await distributeToScene(record, {chapters, range, title})
          : await distributeToWorkshop(record, {chapters, range, title});
        report.results.push({...result, label});
        logger?.info('剧本已分发', {scriptId: record.id, target, range});
      } catch (error) {
        report.results.push({
          ok: false,
          module: target,
          label,
          error: error.message,
          hint: target === 'scene'
            ? '如果场记正在跑批量任务，需要先暂停再分发。'
            : '确认角色引擎已启动（局域网接入 / 运行状态里可以启动）。'
        });
        logger?.warn('剧本分发失败', {scriptId: record.id, target, error: error.message});
      }
    }
    return report;
  }

  return {list, get, remove, importText, importFile, distribute, splitChapters};
}

function badRequest(message) {
  return Object.assign(new Error(message), {status: 400, code: 'script_invalid'});
}

export {SCENE_FORMAT};
