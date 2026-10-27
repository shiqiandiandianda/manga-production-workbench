#!/usr/bin/env node
/**
 * 迁移对账 CLI。
 *
 * 用法：
 *   node tools/migrate/reconcile.mjs --data <旧漫画数据目录> [--db data/platform.sqlite]
 *
 * 输出 JSON 报告到 data/migration/reconcile-<时间>.json；有差异时退出码为 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {reconcileComicStore} from './lib/reconcile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parse(process.argv.slice(2));

if (args.help || !args.data) {
  console.log(`用法：node tools/migrate/reconcile.mjs --data <旧漫画数据目录> [--db data/platform.sqlite]`);
  process.exit(args.help ? 0 : 1);
}

try {
  const report = reconcileComicStore({
    dataDir: args.data,
    databaseFile: path.resolve(ROOT, args.db || 'data/platform.sqlite')
  });

  const directory = path.resolve(ROOT, 'data/migration');
  fs.mkdirSync(directory, {recursive: true});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(directory, `reconcile-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  console.log('');
  console.log('迁移对账');
  console.log('----------------------------------------');
  console.log(`旧项目     ${report.counts.oldProjects}`);
  console.log(`新项目     ${report.counts.newProjects}`);
  console.log(`旧话数     ${report.counts.oldEpisodes}`);
  console.log(`新话数     ${report.counts.newEpisodes}`);
  console.log(`检查资产   ${report.counts.assetsChecked}`);
  console.log(`检查文档   ${report.counts.documentsChecked}`);
  console.log(`差异       ${report.mismatches.length}`);
  console.log(`警告       ${report.warnings.length}`);
  console.log(`报告       ${file}`);
  console.log('----------------------------------------');

  for (const mismatch of report.mismatches.slice(0, 30)) {
    console.log(`  [差异] ${mismatch.kind} ${mismatch.detail}`);
  }
  for (const warning of report.warnings.slice(0, 20)) {
    console.log(`  [警告] ${warning}`);
  }
  console.log('');
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  console.error(`对账失败：${error.message}`);
  if (process.env.APP_DEBUG === '1' && error.stack) console.error(error.stack);
  process.exitCode = 1;
}

function parse(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`无法识别的参数：${token}`);
    const key = token.slice(2);
    if (key === 'help') {
      result.help = true;
      continue;
    }
    if (!['data', 'db'].includes(key)) throw new Error(`未知选项：--${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`选项 --${key} 需要一个值`);
    result[key] = value;
    index += 1;
  }
  return result;
}
