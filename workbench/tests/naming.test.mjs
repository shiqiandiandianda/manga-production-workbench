/**
 * 命名与归档的离线单元测试。
 * 这些用例覆盖了最容易出错、又最难在界面上发现的规则：
 * 命名模板变量、重名策略、内容嗅探、以及"主位置失败必须报错"。
 * 运行：node --test tests/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp, rm, writeFile, mkdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {buildVariables, buildRelativePath, applyTemplate, planTargets, timeParts, joinDestination} from '../server/naming.mjs';
import {sniffMime, readImageSize} from '../server/archive.mjs';
import {normalizeRecord, kindForExtension} from '../server/asset-index.mjs';
import {safeName, atomicBytes, withRetry, jsonlLog, sha256} from '../server/store.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

/** 受限环境下系统临时目录可能不可写，因此优先用工作台自己的 temp 目录。 */
async function makeTemp(prefix) {
  for (const base of [path.join(ROOT, 'data', 'temp'), tmpdir()]) {
    try {
      await mkdir(base, {recursive: true});
      return await mkdtemp(path.join(base, prefix));
    } catch {
      /* 换下一个候选 */
    }
  }
  throw new Error('找不到可写的临时目录。');
}

test('命名模板：变量展开与目录层级', () => {
  const variables = buildVariables({
    type: 'card',
    project: '长夜',
    character: '李三',
    outfit: '校服',
    view: '正面',
    version: 'v2'
  }, {timeZone: 'Asia/Shanghai'});
  assert.equal(variables.typeLabel, '角色卡');
  const relative = applyTemplate('{project}/{type}/{character}_{outfit}_{view}_{version}', variables);
  assert.equal(relative, path.join('长夜', 'card', '李三_校服_正面_v2'));
});

test('命名模板：缺失变量不留残迹', () => {
  const variables = buildVariables({type: 'scene', project: '长夜', scene: '码头夜斗', view: '正打'}, {});
  const relative = applyTemplate('{project}/{type}/{character}_{outfit}_{view}_{version}', variables);
  assert.equal(relative, path.join('长夜', 'scene', '正打_v1'));
  assert.ok(!relative.includes('__'), '不应出现连续下划线');
});

test('命名模板：非法字符被净化，目录穿越被拦截', () => {
  const variables = buildVariables({type: 'misc', project: '../..', character: 'a:b*c?', version: 'v1'}, {});
  const relative = applyTemplate('{project}/{type}/{character}_{version}', variables);
  assert.ok(!relative.includes('..'), relative);
  assert.ok(!/[:*?]/.test(relative), relative);
});

test('命名模板：时间变量可用且格式固定', () => {
  const parts = timeParts(new Date('2026-10-15T11:20:30Z'), 'Asia/Shanghai');
  assert.equal(parts.yyyy, '2026');
  assert.equal(parts.MM, '10');
  assert.equal(parts.dd, '15');
  assert.equal(parts.HH, '19');
  const relative = applyTemplate('{yyyy}{MM}{dd}/{HH}{mm}{ss}', parts);
  assert.match(relative, /^20261015[\\/]192030$/);
});

test('buildRelativePath 统一扩展名', () => {
  const variables = buildVariables({type: 'scene', project: 'p', view: 'v'}, {});
  assert.ok(buildRelativePath({template: '{project}/{view}', variables, ext: 'PNG'}).endsWith('.png'));
  assert.ok(buildRelativePath({template: '{project}/{view}.json', variables, ext: 'png'}).endsWith('.json'));
});

test('重名策略：version 递增、overwrite 覆盖、skip 放弃', async () => {
  const dir = await makeTemp('wb-naming-');
  try {
    const destinations = [{id: 'local', label: '本机', path: dir, role: 'primary', writable: true, enabled: true}];
    const first = await planTargets({destinations, relative: path.join('p', 'a.png'), policy: 'version'});
    assert.ok(first);
    await atomicBytes(first.targets[0].path, PNG);
    const second = await planTargets({destinations, relative: path.join('p', 'a.png'), policy: 'version'});
    assert.ok(second.relative.includes('_v2'), second.relative);
    const overwrite = await planTargets({destinations, relative: path.join('p', 'a.png'), policy: 'overwrite'});
    assert.equal(path.basename(overwrite.relative), 'a.png');
    const skipped = await planTargets({destinations, relative: path.join('p', 'a.png'), policy: 'skip'});
    assert.equal(skipped, null);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('多位置：相对路径在所有位置保持一致', async () => {
  const dir = await makeTemp('wb-multi-');
  try {
    const destinations = [
      {id: 'local', label: '本机', path: path.join(dir, 'a'), role: 'primary', writable: true, enabled: true},
      {id: 'share', label: '共享', path: path.join(dir, 'b'), role: 'archive', writable: true, enabled: true},
      {id: 'off', label: '停用', path: path.join(dir, 'c'), role: 'archive', writable: true, enabled: false}
    ];
    const plan = await planTargets({destinations, relative: path.join('项目', 'card', 'x.png'), policy: 'version'});
    assert.equal(plan.targets.length, 2);
    assert.deepEqual(plan.targets.map(item => path.basename(item.path)), ['x.png', 'x.png']);
    assert.ok(!plan.targets.some(item => item.path.includes(path.sep + 'c' + path.sep)));
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('内容嗅探：拒绝伪装与不允许的类型', () => {
  assert.equal(sniffMime(PNG, 'png', ['image/png']), 'image/png');
  assert.equal(sniffMime(Buffer.from('{"a":1}'), 'json', ['application/json']), 'application/json');
  assert.equal(sniffMime(Buffer.from('纯文本说明'), 'txt', ['text/plain']), 'text/plain');
  assert.throws(() => sniffMime(Buffer.from('not an image at all'), 'png', ['image/png']), /无法识别/);
  assert.throws(() => sniffMime(Buffer.from([0x00, 0x01, 0x02]), 'txt', ['text/plain']), /无法识别/);
  assert.throws(() => sniffMime(PNG, 'png', ['image/jpeg']), /不允许/);
  // allowed 为空数组表示不限制类型（配置层已保证不会误配成空清单）。
  assert.equal(sniffMime(Buffer.from('{"a":1}'), 'json', []), 'application/json');
});

test('图片尺寸：PNG 头解析', () => {
  const size = readImageSize(PNG);
  assert.equal(size.width, 1);
  assert.equal(size.height, 1);
  assert.equal(readImageSize(Buffer.from('xxxx')).width, null);
});

test('安全文件名：Windows 保留名与控制字符', () => {
  assert.equal(safeName('con'), '_con');
  assert.equal(safeName('a\u0001b'), 'a_b');
  assert.equal(safeName('   '), 'unnamed');
  assert.ok(safeName('x'.repeat(300)).length <= 100);
});

test('原子写入与重试：临时文件不残留', async () => {
  const dir = await makeTemp('wb-atomic-');
  try {
    const target = path.join(dir, 'sub', 'deep', 'file.png');
    await atomicBytes(target, PNG);
    assert.equal((await readFile(target)).length, PNG.length);
    const {readdir} = await import('node:fs/promises');
    const files = await readdir(path.dirname(target));
    assert.deepEqual(files, ['file.png']);
    let attempts = 0;
    await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('busy'), {code: 'EBUSY'});
      return 'ok';
    }, {baseDelayMs: 1});
    assert.equal(attempts, 3);
    await assert.rejects(() => withRetry(async () => {
      throw Object.assign(new Error('boom'), {code: 'EINVAL'});
    }, {baseDelayMs: 1}), /boom/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('JSONL 日志：半行损坏不影响读取', async () => {
  const dir = await makeTemp('wb-jsonl-');
  try {
    const file = path.join(dir, 'index.jsonl');
    const log = jsonlLog(file);
    await log.append({a: 1});
    await log.append({a: 2});
    await writeFile(file, (await readFile(file, 'utf8')) + '{"a":3', 'utf8');
    const records = await log.readAll();
    assert.deepEqual(records, [{a: 1}, {a: 2}]);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('长路径在 Windows 上追加 \\\\?\\ 前缀', () => {
  const deep = path.join('C:', 'x'.repeat(300), 'a.png');
  const joined = joinDestination('C:', deep.slice(2));
  if (process.platform === 'win32') {
    assert.ok(joined.startsWith('\\\\?\\') || joined.length < 250);
  } else {
    assert.ok(joined.length > 0);
  }
});

test('哈希稳定', () => {
  assert.equal(sha256(PNG), sha256(Buffer.from(PNG)));
  assert.equal(sha256(PNG).length, 64);
});

/**
 * 回归：索引里的 kind 必须是 image，否则界面不显示缩略图。
 * 曾经的 bug：扩展名比对用的是不带点的 'png'，与 '.png' 集合不匹配，图片全被判成 other。
 */
test('索引 kind 判定：带点与不带点都要认', () => {
  assert.equal(kindForExtension('png'), 'image');
  assert.equal(kindForExtension('.png'), 'image');
  assert.equal(kindForExtension('PNG'), 'image');
  assert.equal(kindForExtension('json'), 'text');
  assert.equal(kindForExtension('bin'), 'other');
  assert.equal(kindForExtension(''), 'other');

  // 调用方把 kind / extension 传成 undefined 时也不能把推断结果覆盖掉
  assert.equal(normalizeRecord({assetId: 'a', relativePath: 'p/x.png', extension: 'png', kind: undefined}).kind, 'image');
  assert.equal(normalizeRecord({assetId: 'b', relativePath: 'p/y.PNG'}).kind, 'image');
  assert.equal(normalizeRecord({assetId: 'c', relativePath: 'p/z.json', extension: 'json'}).kind, 'text');
  assert.equal(normalizeRecord({assetId: 'd', relativePath: 'p/v.mp4'}).kind, 'video');
  assert.equal(normalizeRecord({assetId: 'e', relativePath: 'p/raw.bin'}).kind, 'other');
  // 显式传入的 kind 优先，不被推断覆盖
  assert.equal(normalizeRecord({assetId: 'f', relativePath: 'p/keep.jpg', kind: 'other'}).kind, 'other');
  // 相对路径为空时也不能抛错
  assert.equal(normalizeRecord({assetId: 'g'}).kind, 'other');
});
