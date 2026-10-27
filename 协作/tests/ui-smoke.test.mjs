// 中控控制台 + 协作页「静态冒烟测试」：只做文件/引用/路径白名单/外链/令牌/启动脚本的静态断言。
// 边界：浏览器 DOM 不执行、不启动任何常驻服务、不联网；页面 JS 只用 node --check 做语法检查。
// 运行：开发\workbench\运行环境\node\node.exe --test 开发\协作\tests\ui-smoke.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COLLAB_DIR = path.resolve(HERE, '..');                 // 开发/协作
const DEV_DIR = path.resolve(COLLAB_DIR, '..');              // 开发
const PROJECT_ROOT = path.resolve(DEV_DIR, '..');            // 项目根
const CONSOLE_PUBLIC = path.join(COLLAB_DIR, 'public');
const COMIC_PUBLIC = path.join(DEV_DIR, 'comic', 'public');
const BUNDLED_NODE_REL = '..\\workbench\\运行环境\\node\\node.exe';

const CONSOLE_PAGE_FILES = ['index.html', 'app.js', 'style.css', 'favicon.svg'];
const COLLAB_PAGE_FILES = ['collab.html', 'collab-app.js', 'collab.css'];
const LAUNCH_FILES = ['启动协作中控.cmd', '启动协作节点.cmd'];
const DOC_FILES = ['README.md', '真机双机验收步骤.md'];

// 协议 §4「中控 HTTP API」白名单；“:xxx” 为参数段。
const HUB_API_PATTERNS = [
  '/api/health', '/api/pair',
  '/api/node/heartbeat',
  '/api/node/tasks/:id/progress', '/api/node/tasks/:id/fail', '/api/node/tasks/:id/result', '/api/node/tasks/:id/verify',
  '/api/blobs', '/api/blobs/:id', '/api/blobs/:id/thumb',
  '/api/tasks', '/api/tasks/:id', '/api/tasks/:id/cancel', '/api/tasks/:id/retry', '/api/tasks/:id/apply',
  '/api/assets', '/api/assets/:id', '/api/assets/request',
  '/api/notifications', '/api/notifications/read',
  '/api/nodes', '/api/nodes/:id/settings', '/api/nodes/:id/revoke',
  '/api/admin/pairing', '/api/admin/rotate-pairing',
  '/api/events',
];

// 协议 §7「漫画服务执行适配层」白名单。
const COMIC_API_PATTERNS = [
  '/api/collab/generation', '/api/collab/generation/:id', '/api/collab/generation/:id/cancel',
  '/api/collab/prepare', '/api/collab/config', '/api/collab/pair', '/api/collab/distribute', '/api/collab/status',
  '/api/collab/tasks', '/api/collab/tasks/:id', '/api/collab/tasks/:id/retry', '/api/collab/tasks/:id/cancel',
  '/api/collab/tasks/:id/apply-choice',
  '/api/collab/assets', '/api/collab/assets/:id', '/api/collab/assets/:id/thumb', '/api/collab/assets/:id/download',
  '/api/collab/notifications', '/api/collab/notifications/read', '/api/collab/assets/request',
];

// 现有漫画服务路由：协作页取「当前工程画格」必需（协议 §7 之外，任务书明确要求；已在 README 接口清单标注）。
const EXISTING_COMIC_PATTERNS = ['/api/state'];

const ALLOWED_PATTERNS = [...HUB_API_PATTERNS, ...COMIC_API_PATTERNS, ...EXISTING_COMIC_PATTERNS];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function exists(file) {
  try { return fs.statSync(file).isFile(); } catch (error) { return false; }
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function normalizeApiPath(raw) {
  let text = String(raw).replace(/\$\{[^}]*\}/g, ':param');
  const queryIndex = text.indexOf('?');
  if (queryIndex >= 0) text = text.slice(0, queryIndex);
  text = text.replace(/\/+$/, '');
  return text;
}

function matchesPattern(normalized, pattern) {
  const actual = normalized.split('/').filter(Boolean);
  const expected = pattern.split('/').filter(Boolean);
  if (actual.length !== expected.length) return false;
  return actual.every((segment, index) => expected[index].startsWith(':') ? segment.length > 0 : segment === expected[index]);
}

// 扫描 JS 源码里所有 /api/ 字符串字面量（含模板字符串 ${...} 占位）。
function extractApiPaths(file) {
  const source = read(file);
  const results = [];
  const pattern = /(['"`])(\/api\/[^'"`\s]*)\1/g;
  let match;
  while ((match = pattern.exec(source))) {
    results.push({file, raw: match[2], normalized: normalizeApiPath(match[2]), line: lineOf(source, match.index)});
  }
  return results;
}

function localResourceRefs(html) {
  const refs = [];
  const pattern = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(html))) {
    const reference = match[1].trim();
    if (!reference) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue; // 外链/协议/锚点不在本地解析范围
    refs.push(reference);
  }
  return refs;
}

function resolveLocalRef(publicDir, reference) {
  const clean = reference.split('?')[0].split('#')[0];
  if (!clean || clean === '/') return path.join(publicDir, 'index.html');
  const joined = path.resolve(publicDir, clean.replace(/^\/+/, ''));
  if (joined !== publicDir && !joined.startsWith(`${publicDir}${path.sep}`)) return null;
  return joined;
}

// ---------------------------------------------------------------------------
test('页面与交付文件都存在', () => {
  for (const name of CONSOLE_PAGE_FILES) {
    assert.ok(exists(path.join(CONSOLE_PUBLIC, name)), `缺少中控控制台文件：开发/协作/public/${name}`);
  }
  for (const name of COLLAB_PAGE_FILES) {
    assert.ok(exists(path.join(COMIC_PUBLIC, name)), `缺少协作页文件：开发/comic/public/${name}`);
  }
  for (const name of LAUNCH_FILES) {
    assert.ok(exists(path.join(COLLAB_DIR, name)), `缺少启动脚本：开发/协作/${name}`);
  }
  for (const name of DOC_FILES) {
    assert.ok(exists(path.join(COLLAB_DIR, name)), `缺少交付文档：开发/协作/${name}`);
  }
});

test('中控控制台 index.html 只引用同源白名单文件且文件存在', () => {
  const file = path.join(CONSOLE_PUBLIC, 'index.html');
  const html = read(file);
  for (const required of ['/app.js', '/style.css', '/favicon.svg']) {
    assert.ok(html.includes(required), `中控控制台 index.html 缺少引用 ${required}`);
  }
  const refs = localResourceRefs(html);
  assert.ok(refs.length >= 3, `中控控制台本地引用过少（${refs.length}），可能解析失败`);
  for (const reference of refs) {
    const resolved = resolveLocalRef(CONSOLE_PUBLIC, reference);
    assert.ok(resolved, `中控控制台引用了越界路径：${reference}`);
    assert.ok(exists(resolved), `中控控制台引用的文件不存在：${reference}（解析为 ${resolved}）`);
  }
});

test('协作页 collab.html 引用 collab-app.js / collab.css 且文件存在', () => {
  const file = path.join(COMIC_PUBLIC, 'collab.html');
  const html = read(file);
  for (const required of ['/collab-app.js', '/collab.css']) {
    assert.ok(html.includes(required), `collab.html 缺少引用 ${required}`);
  }
  const refs = localResourceRefs(html);
  for (const reference of refs) {
    const resolved = resolveLocalRef(COMIC_PUBLIC, reference);
    assert.ok(resolved, `collab.html 引用了越界路径：${reference}`);
    assert.ok(exists(resolved), `collab.html 引用的文件不存在：${reference}（解析为 ${resolved}）`);
  }
});

test('页面没有内联脚本/内联事件（18896 静态页 CSP 只允许 self 脚本）', () => {
  for (const file of [path.join(CONSOLE_PUBLIC, 'index.html'), path.join(COMIC_PUBLIC, 'collab.html')]) {
    const html = read(file);
    assert.ok(!/<script(?![^>]*\bsrc\s*=)[^>]*>/i.test(html), `${path.basename(file)} 含内联 <script>，会被 CSP 拦截`);
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), `${path.basename(file)} 含内联事件处理器（onclick 等），会被 CSP 拦截`);
  }
});

test('页面 JS 的 /api/ 请求路径都在协议 §4/§7 白名单内', () => {
  const files = [path.join(CONSOLE_PUBLIC, 'app.js'), path.join(COMIC_PUBLIC, 'collab-app.js')];
  const found = files.flatMap(extractApiPaths);
  assert.ok(found.length >= 25, `扫描到的 /api/ 路径过少（${found.length}），正则或文件内容异常`);
  for (const file of files) {
    const count = found.filter((item) => item.file === file).length;
    assert.ok(count >= 15, `${path.basename(file)} 扫描到的 /api/ 路径过少（${count}）`);
  }
  const offenders = found.filter((item) => !ALLOWED_PATTERNS.some((pattern) => matchesPattern(item.normalized, pattern)));
  const detail = offenders.map((item) => `${path.basename(item.file)}:${item.line} ${item.raw}`).join('\n');
  assert.deepEqual(offenders, [], `发现协议白名单之外的接口路径：\n${detail}`);
});

test('页面没有 http(s) 外链资源，也不依赖任何外网 CDN', () => {
  for (const file of [path.join(CONSOLE_PUBLIC, 'index.html'), path.join(COMIC_PUBLIC, 'collab.html')]) {
    const html = read(file);
    assert.ok(!/(?:src|href|action)\s*=\s*["']\s*(?:https?:)?\/\//i.test(html), `${path.basename(file)} 引用外部 URL`);
  }
  for (const file of [path.join(CONSOLE_PUBLIC, 'app.js'), path.join(COMIC_PUBLIC, 'collab-app.js')]) {
    const source = read(file);
    const pattern = /(['"`])(https?:\/\/[^'"`\s]*)\1/g;
    let match;
    while ((match = pattern.exec(source))) {
      const url = match[2];
      // 允许裸协议前缀（配对地址补 http:// 用），不允许任何带主机的绝对地址。
      assert.ok(url === 'http://' || url === 'https://',
        `${path.basename(file)}:${lineOf(source, match.index)} 出现外部 URL 字面量：${url}`);
    }
  }
});

test('页面 JS 没有硬编码配对令牌', () => {
  for (const file of [path.join(CONSOLE_PUBLIC, 'app.js'), path.join(COMIC_PUBLIC, 'collab-app.js')]) {
    const source = read(file);
    // 1) 不允许 JSON 风格 token: "长字符串" 硬编码。
    const jsonLike = /["']?token["']?\s*:\s*["']([^"']{16,})["']/g;
    let match;
    while ((match = jsonLike.exec(source))) {
      assert.fail(`${path.basename(file)}:${lineOf(source, match.index)} 疑似硬编码令牌：${match[1].slice(0, 8)}…`);
    }
    // 2) 不允许 const xxxToken = "长字符串" 硬编码。
    const variableAssign = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*[Tt]oken[A-Za-z_$]*\s*=\s*["'`]([^"'`]{16,})["'`]/g;
    while ((match = variableAssign.exec(source))) {
      assert.fail(`${path.basename(file)}:${lineOf(source, match.index)} 疑似硬编码令牌：${match[1].slice(0, 8)}…`);
    }
    // 3) 不允许 localStorage.setItem('...token...', "长字符串") 硬编码。
    const storageLiteral = /localStorage\.setItem\(\s*["'][^"']*[Tt]oken[^"']*["']\s*,\s*["']([^"']{16,})["']/g;
    while ((match = storageLiteral.exec(source))) {
      assert.fail(`${path.basename(file)}:${lineOf(source, match.index)} 疑似硬编码令牌：${match[1].slice(0, 8)}…`);
    }
    // 4) 不允许 40 位以上的 base64url 风格常量（配对 token 为 24 字节随机串；纯分隔线不算）。
    const longRun = /[A-Za-z0-9][A-Za-z0-9_-]{39,}/g;
    while ((match = longRun.exec(source))) {
      assert.fail(`${path.basename(file)}:${lineOf(source, match.index)} 出现疑似令牌/密钥的长字符串：${match[0].slice(0, 12)}…`);
    }
  }
  // 控制台令牌只从 localStorage 读写，配对成功后动态保存。
  const consoleSource = read(path.join(CONSOLE_PUBLIC, 'app.js'));
  assert.match(consoleSource, /localStorage\.getItem\(TOKEN_KEY\)/, '中控控制台应从 localStorage 读取令牌');
  assert.match(consoleSource, /localStorage\.setItem\(TOKEN_KEY, data\.token\)/, '中控控制台配对成功后应动态保存令牌');
  assert.match(consoleSource, /x-collab-token/, '中控控制台请求应携带 x-collab-token 头');
  assert.match(consoleSource, /token=/, '中控控制台图片请求应使用 ?token= 传递令牌');
});

test('启动脚本使用包内 node 相对路径、首次运行提示与 pause', () => {
  const hubScript = read(path.join(COLLAB_DIR, '启动协作中控.cmd'));
  const nodeScript = read(path.join(COLLAB_DIR, '启动协作节点.cmd'));
  for (const [name, source] of [['启动协作中控.cmd', hubScript], ['启动协作节点.cmd', nodeScript]]) {
    assert.ok(source.includes('%~dp0'), `${name} 应使用 %~dp0 相对路径`);
    assert.ok(source.includes(BUNDLED_NODE_REL), `${name} 应调用包内 node 相对路径 ${BUNDLED_NODE_REL}`);
    assert.ok(/pause/i.test(source), `${name} 结束前应 pause 让用户看到错误`);
    assert.ok(/chcp\s+(?:936|65001)/i.test(source), `${name} 应设置中文控制台代码页`);
    assert.ok(/[\u4e00-\u9fa5]/.test(source), `${name} 应包含中文提示`);
  }
  // cmd 批处理的 if/for 块在 LF-only 文件里会解析错乱，交付文件必须是 CRLF。
  for (const name of ['启动协作中控.cmd', '启动协作节点.cmd']) {
    const buffer = fs.readFileSync(path.join(COLLAB_DIR, name));
    assert.ok(buffer.includes(0x0d) && buffer.includes(0x0a), `${name} 必须使用 CRLF 换行（否则 cmd 括号块解析异常）`);
  }
  assert.ok(hubScript.includes('hub.example.json') && hubScript.includes('hub.json'), '中控脚本首次运行应提示复制 hub.example.json → hub.json');
  assert.ok(nodeScript.includes('node.json') && nodeScript.includes('pair'), '节点脚本首次运行应提示先执行 pair 配对');
  assert.ok(nodeScript.includes('config.json'), '节点脚本应说明 pair 生成的是运行数据目录下的 config.json');
});

test('现有工作台 index.html 只新增了协作入口，未破坏原有脚本', () => {
  const html = read(path.join(COMIC_PUBLIC, 'index.html'));
  assert.match(html, /<a[^>]+href="\/collab\.html"[^>]*target="_blank"[^>]*>/, '工作台应有指向 /collab.html 的新窗口入口');
  assert.ok(html.includes('/app.js'), '工作台原有 /app.js 引用不应被破坏');
  assert.ok(html.includes('id="collab-open"'), '协作入口应有稳定 id=collab-open 便于识别');
  const entryCount = (html.match(/href="\/collab\.html"/g) || []).length;
  assert.equal(entryCount, 1, `协作入口应只有一个，实际 ${entryCount} 个`);
});

test('页面轮询间隔为 2 秒（静态检查）', () => {
  for (const file of [path.join(CONSOLE_PUBLIC, 'app.js'), path.join(COMIC_PUBLIC, 'collab-app.js')]) {
    assert.match(read(file), /POLL_MS\s*=\s*2000/, `${path.basename(file)} 应设置 POLL_MS = 2000`);
  }
});

test('页面 JS 通过 node --check 语法检查（不执行 DOM）', () => {
  for (const file of [path.join(CONSOLE_PUBLIC, 'app.js'), path.join(COMIC_PUBLIC, 'collab-app.js')]) {
    const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
    assert.equal(result.status, 0, `${path.basename(file)} 未通过 node --check：\n${result.stderr || result.stdout}`);
  }
});

test('中控静态白名单与页面引用一致（hub-server 存在时检查）', (t) => {
  const serverFile = path.join(COLLAB_DIR, 'lib', 'hub-server.mjs');
  if (!exists(serverFile)) {
    t.skip('hub-server.mjs 尚未生成，跳过白名单交叉检查');
    return;
  }
  const source = read(serverFile);
  for (const name of ['index.html', 'app.js', 'style.css', 'favicon.svg']) {
    assert.ok(source.includes(`'${name}'`) || source.includes(`"${name}"`), `hub-server.mjs 静态白名单缺少 ${name}`);
  }
});
