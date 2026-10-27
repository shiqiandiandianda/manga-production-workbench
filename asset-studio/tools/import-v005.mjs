#!/usr/bin/env node
/**
 * 把 V005 制作交付包导入长条漫画编辑器。
 *
 * 输入：制作数据/分话JSON/E0xx.json（v9.3 设计稿）
 * 输出：编辑器工程（一话一页、竖向长条、面板高度按 panel_height 比例换算）
 *
 * 用法：
 *   node tools/import-v005.mjs --package "<交付包目录>" --dry-run
 *   node tools/import-v005.mjs --package "<交付包目录>" --base http://127.0.0.1:18909
 */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const WIDTH = 1280;
const MARGIN = 40;
const GAP = 24;

const args = parse(process.argv.slice(2));
if (args.help || !args.package) {
  console.log(`用法：node tools/import-v005.mjs --package <交付包目录> [选项]

选项：
  --base <地址>      编辑器地址，默认 http://127.0.0.1:18909
  --title <标题>     工程标题
  --dry-run          只生成本地 JSON，不调用编辑器
  --out <文件>       本地 JSON 输出路径
`);
  process.exit(args.help ? 0 : 1);
}

const root = path.resolve(args.package);
const dataDir = fs.existsSync(path.join(root, '制作数据'))
  ? path.join(root, '制作数据')
  : root;
const episodesDir = path.join(dataDir, '分话JSON');
if (!fs.existsSync(episodesDir)) {
  console.error(`找不到分话 JSON：${episodesDir}`);
  process.exit(1);
}

const episodeFiles = fs.readdirSync(episodesDir)
  .filter(name => /^E\d+\.json$/.test(name))
  .sort();
const episodes = episodeFiles.map(name => JSON.parse(fs.readFileSync(path.join(episodesDir, name), 'utf8')));
const title = args.title || `开局神戒，召唤万虫 第${episodes[0].episode}-${episodes.at(-1).episode}话 V005`;

const project = buildProject(episodes, title);

const outFile = path.resolve(args.out || path.join('data', 'import-v005', 'project.json'));
fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, JSON.stringify(project, null, 2));

const totals = project.pages.map(page => ({
  name: page.name,
  panels: page.panels.length,
  bubbles: page.bubbles.length,
  height: page.height
}));
console.log(`工程：${project.title}`);
console.log(`话数：${project.pages.length}，镜头：${project.shots.length}`);
console.table(totals);
console.log(`本地 JSON：${outFile}`);

if (args.dryRun) {
  console.log('dry-run：未写入编辑器。');
  process.exit(0);
}

const base = String(args.base || 'http://127.0.0.1:18909').replace(/\/+$/, '');
try {
  const created = await post(`${base}/api/projects`, {title});
  const saved = await put(`${base}/api/projects/${created.id}`, {
    ...project,
    id: created.id,
    revision: created.revision,
    created: created.created,
    updated: new Date().toISOString()
  });
  const url = `${base}/?project=${encodeURIComponent(saved.id)}`;
  console.log('');
  console.log(`已导入：${url}`);
  console.log(`projectId：${saved.id}`);
} catch (error) {
  console.error(`导入失败：${error.message}`);
  process.exitCode = 1;
}

function buildProject(list, projectTitle) {
  const shots = [];
  const pages = [];

  for (const episode of list) {
    const panels = [...(episode.panels || [])].sort((a, b) => Number(a.reading_order) - Number(b.reading_order));
    const bubblesByPanel = new Map();
    for (const bubble of episode.bubbles || []) {
      if (!bubblesByPanel.has(bubble.panel_id)) bubblesByPanel.set(bubble.panel_id, []);
      bubblesByPanel.get(bubble.panel_id).push(bubble);
    }

    const pagePanels = [];
    const pageBubbles = [];
    let cursor = MARGIN;

    for (const source of panels) {
      const panelBubbles = bubblesByPanel.get(source.panel_id) || [];
      const shotId = id('shot');
      shots.push({
        id: shotId,
        code: source.panel_id,
        title: source.action_summary || source.narrative_function || source.panel_id,
        description: source.content || source.action_summary || '',
        dialogue: panelBubbles.map(bubble => `${bubble.speaker_display || ''}：${bubble.text}`.trim()).join('\n'),
        referenceIds: []
      });

      const height = Math.max(320, Math.round(Number(source.panel_height || 0.75) * WIDTH));
      const half = source.panel_shape === 'half_width';
      const width = half ? 600 : 1200;
      const x = half ? Math.round((WIDTH - width) / 2) : MARGIN;
      const frame = {
        id: id('panel'),
        shotId,
        name: source.panel_id,
        x,
        y: cursor,
        w: width,
        h: height,
        points: rectangle(),
        kind: 'panel',
        border: 6,
        borderColor: '#242830',
        feather: 0,
        visible: true,
        locked: false,
        candidates: []
      };
      pagePanels.push(frame);

      let order = 0;
      for (const bubble of panelBubbles) {
        order += 1;
        const text = String(bubble.text || '').trim();
        if (!text) continue;
        const boxWidth = Math.min(440, Math.round(width * 0.5));
        const boxHeight = Math.min(240, Math.max(90, 60 + Math.ceil(text.length / 16) * 28));
        const right = bubble.position === '右上';
        pageBubbles.push({
          id: id('bubble'),
          shotId,
          text,
          type: bubbleType(bubble.type),
          speaker: bubble.speaker_display || '',
          x: right ? Math.max(x + 16, x + width - boxWidth - 24) : x + 24,
          y: cursor + 24 + (order - 1) * 12,
          w: boxWidth,
          h: boxHeight,
          fontSize: 30,
          visible: true,
          locked: false,
          tail: {visible: false}
        });
      }

      cursor += height + GAP;
    }

    pages.push({
      id: id('page'),
      name: `第${episode.episode}话 ${episode.episode_name || ''}`.trim(),
      width: WIDTH,
      height: Math.max(320, cursor + MARGIN - GAP),
      background: '#ffffff',
      layoutPreset: 'custom',
      storyboard: {episode: episode.episode, projection: 'v005-import'},
      panels: pagePanels,
      bubbles: pageBubbles
    });
  }

  return {
    id: null,
    title: projectTitle,
    revision: 0,
    style: '国漫线稿，长条漫画，竖向阅读；人物、服装、场景与色调在全部镜头中保持一致。',
    references: [],
    shots,
    pages,
    archivedBubbles: [],
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  };
}

function bubbleType(value) {
  const type = String(value || '');
  if (type === '心声' || type === '意念') return 'thought';
  if (['旁白', '信息字幕', '规则字幕', '册内文字', '设定图解'].includes(type)) return 'caption';
  return 'speech';
}

function rectangle() {
  return [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}];
}

function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}

async function post(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  return decode(response);
}

async function put(url, payload) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  return decode(response);
}

async function decode(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

function parse(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`无法识别的参数：${token}`);
    const key = token.slice(2);
    if (key === 'help' || key === 'dry-run') {
      result[key === 'dry-run' ? 'dryRun' : key] = true;
      continue;
    }
    if (!['package', 'base', 'title', 'out'].includes(key)) throw new Error(`未知选项：--${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`选项 --${key} 需要一个值`);
    result[key] = value;
    index += 1;
  }
  return result;
}
