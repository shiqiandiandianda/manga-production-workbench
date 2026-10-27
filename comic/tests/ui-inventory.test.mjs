import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = name => fs.readFileSync(path.join(root, 'public', name), 'utf8');

test('按钮与控件清单：无重复 ID、无死按钮、无失效页面链接', () => {
  const result = spawnSync(process.execPath, ['tools/audit-ui.mjs'], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || 'audit failed');
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.duplicateIds, [], '页面不能有重复 id');
  assert.deepEqual(report.deadButtons, [], '每个按钮都必须有 id/data-action/href/form 处理');
  assert.deepEqual(report.pageLinks, [], '页面链接必须指向真实文件');
});

test('团队帮忙生图入口已删除，本格/本话生图入口保留', () => {
  const index = html('index.html');
  assert.equal(index.includes('collab-open'), false, '协作生图入口应删除');
  assert.equal(index.includes('project-center-open'), false, '项目中心按钮不应再注入');
  assert.equal(index.includes('id="generate-current-panel"'), true);
  assert.equal(index.includes('id="generate-current-episode"'), true);
  assert.equal(index.includes('id="generate-selected"'), false, '属性面板不再重复生成本格按钮');
  assert.equal((index.match(/data-image-layer-action="copy"/g) || []).length, 1, '复制画面只保留工具栏一处');
  assert.equal((index.match(/data-image-layer-action="paste"/g) || []).length, 1, '粘贴画面只保留工具栏一处');
});

test('所有页面不再链接已移除的团队帮忙页面', () => {
  for (const file of fs.readdirSync(path.join(root, 'public')).filter(name => name.endsWith('.html'))) {
    const text = html(file);
    if (file === 'project-center.html' || file === 'collab.html') continue;
    assert.equal(text.includes('/project-center.html'), false, file + ' 仍链接项目生产中心');
    assert.equal(text.includes('/collab.html'), false, file + ' 仍链接协作页');
  }
});
