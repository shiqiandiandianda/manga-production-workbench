/**
 * 剧本库测试：切章规则、导入落库、列表与删除。
 *
 * 不测"分发到两个模块"——那需要两个引擎同时在线，属于端到端范畴，
 * 由 tools/smoke.mjs 与 scripts/probe-unified-script.mjs 覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

async function makeTemp(prefix) {
  for (const base of [path.join(ROOT, 'data', 'temp'), tmpdir()]) {
    try {
      await mkdir(base, {recursive: true});
      return await mkdtemp(path.join(base, prefix));
    } catch { /* 换下一个 */ }
  }
  throw new Error('找不到可写的临时目录。');
}

/** 剧本库依赖 WORKBENCH_DATA_DIR，所以要在导入模块之前设好 */
const dataDir = await makeTemp('wb-scripts-');
process.env.WORKBENCH_DATA_DIR = dataDir;
const {splitChapters, createScriptLibrary, decodeText} = await import('../server/script-library.mjs');

const config = {read: async () => ({scene: {port: 1}, workshop: {port: 2}})};

test('切章：标准章节标题', async () => {
  const {chapters, method} = await splitChapters('第一章 雨夜\n雨很密。\n\n第二章 对峙\n两人对峙。\n');
  assert.equal(chapters.length, 2);
  assert.equal(method, 'headings');
  assert.match(chapters[0].title, /第一章 雨夜/);
  assert.ok(chapters[0].text.includes('雨很密'));
});

test('切章：场记不认的「第X夜」也能切', async () => {
  const {chapters, method} = await splitChapters('第一夜\n雨很密。\n\n第二夜\n两人对峙。\n');
  assert.equal(chapters.length, 2);
  assert.equal(method, 'extra-headings');
});

test('切章：没有标题的长文按段落分块', async () => {
  const text = Array.from({length: 80}, (_, index) => `第${index + 1}段：` + '这是一段用来测试分块的正文内容。'.repeat(6)).join('\n');
  const {chapters, method} = await splitChapters(text);
  assert.ok(chapters.length >= 2, '长文应该被切成多段');
  assert.equal(method, 'chunked');
  // 分块后不应丢字（去掉换行差异后长度接近）
  const total = chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
  assert.ok(Math.abs(total - text.length) < text.length * 0.2, `分块后字数偏差过大：${total} vs ${text.length}`);
});

test('切章：短文保持单段，空文本返回空', async () => {
  const single = await splitChapters('只有一小段正文。');
  assert.equal(single.chapters.length, 1);
  assert.equal(single.method, 'single');
  const empty = await splitChapters('   \n  ');
  assert.equal(empty.chapters.length, 0);
  assert.equal(empty.method, 'empty');
});

test('文本解码：UTF-8 与 BOM', () => {
  assert.equal(decodeText(Buffer.from('正文', 'utf8')), '正文');
  assert.equal(decodeText(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('正文', 'utf8')])), '正文');
});

test('剧本库：导入、列表、读取、删除', async () => {
  const library = createScriptLibrary({config, logger: null});
  const created = await library.importText({text: '第一章 雨夜\n雨很密。\n\n第二章 对峙\n两人对峙。\n', title: '测试剧本'});
  assert.equal(created.title, '测试剧本');
  assert.equal(created.chapterCount, 2);
  assert.ok(created.id.startsWith('script_'));

  const list = await library.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
  assert.equal(list[0].text, undefined, '列表不应带正文');

  const full = await library.get(created.id);
  assert.equal(full.chapters.length, 2);
  assert.ok(full.text.includes('雨很密'));

  await library.remove(created.id);
  assert.equal((await library.list()).length, 0);
  assert.equal(await library.get(created.id), null);
});

test('剧本库：空正文与非法编号被拒', async () => {
  const library = createScriptLibrary({config, logger: null});
  await assert.rejects(() => library.importText({text: '   ', title: '空'}), /空的/);
  assert.equal(await library.get('../../etc/passwd'), null);
  assert.equal(await library.get(''), null);
});

test('文件解析：TXT 与不支持的类型', async () => {
  const {fileToText} = await import('../server/script-library.mjs');
  assert.equal(fileToText({fileName: 'a.txt', bytes: Buffer.from('第一章 雨夜\n雨很密。', 'utf8')}), '第一章 雨夜\n雨很密。');
  assert.throws(() => fileToText({fileName: 'a.pdf', bytes: Buffer.from('x')}), /PDF/);
  assert.throws(() => fileToText({fileName: 'a.doc', bytes: Buffer.from('x')}), /docx/);
  assert.throws(() => fileToText({fileName: 'a.xyz', bytes: Buffer.from('x')}), /不支持/);
});

test.after(async () => {
  await rm(dataDir, {recursive: true, force: true});
});
