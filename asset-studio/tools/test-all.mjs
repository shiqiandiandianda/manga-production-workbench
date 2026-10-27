#!/usr/bin/env node
/**
 * 一键验证：Node 能力检查 + 依赖边界 + 测试。
 * 用法：node tools/test-all.mjs
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('');
console.log(`漫画生产平台 · 验证`);
console.log(`Node ${process.version} · ${process.platform} ${process.arch}`);
console.log('----------------------------------------');

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`Node 版本过低：${process.version}。需要 Node 24（或带 --experimental-sqlite 的 22/23）。`);
  process.exit(1);
}

try {
  await import('node:sqlite');
  console.log('[ok]   node:sqlite 可用');
} catch {
  console.error('[fail] 当前 Node 没有内置 node:sqlite。');
  console.error('       请安装 Node.js 24 或更新版本后重试。');
  process.exit(1);
}

let failed = 0;
run(['tools/check-boundaries.mjs'], '依赖边界');

const testFiles = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => path.join('tests', name));
if (!testFiles.length) {
  console.error('没有找到 tests/*.test.mjs');
  failed += 1;
} else {
  run(['--test', '--test-reporter=spec', ...testFiles], '测试');
}

console.log('----------------------------------------');
if (failed) {
  console.log(`结果：失败（${failed} 项）。把上面的输出整段发回即可。`);
  process.exitCode = 1;
} else {
  console.log('结果：通过。可以继续下一阶段。');
}

function run(args, label) {
  console.log('');
  console.log(`=== ${label} ===`);
  const result = spawnSync(process.execPath, args, {cwd: ROOT, stdio: 'inherit'});
  if (result.error) {
    console.error(result.error.message);
    failed += 1;
    return;
  }
  if (result.status !== 0) failed += 1;
}
