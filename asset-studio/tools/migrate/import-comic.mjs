#!/usr/bin/env node
/**
 * 旧漫画工程导入（只读）。
 *
 * 用法：
 *   node tools/migrate/import-comic.mjs --data "D:/.../production-comic-data"
 *   node tools/migrate/import-comic.mjs --data ... --dry-run
 *   node tools/migrate/import-comic.mjs --data ... --db data/platform.sqlite --cache data/cache
 *
 * 安全边界：
 * - 只读旧目录，不写旧工程。
 * - 重复运行幂等：项目按 externalKey、资产/话数/文档按 legacy_ids 去重。
 * - --dry-run 使用内存数据库和临时缓存，结束后全部丢弃。
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importComicStore} from './lib/import-comic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parse(process.argv.slice(2));

if (args.help || !args.data) {
  console.log(`用法：node tools/migrate/import-comic.mjs --data <旧漫画数据目录> [选项]

选项：
  --db <文件>        新数据库，默认 data/platform.sqlite
  --cache <目录>     内容缓存，默认 data/cache
  --dry-run          不落盘：内存数据库 + 临时缓存
  --metadata-only    只登记元数据，不复制图片字节
  --help             显示本说明
`);
  process.exit(args.help ? 0 : 1);
}

const databaseFile = path.resolve(ROOT, args.db || 'data/platform.sqlite');
const archiveRoot = path.resolve(ROOT, args.cache || 'data/cache');

try {
  const result = await importComicStore({
    dataDir: args.data,
    databaseFile,
    archiveRoot,
    dryRun: Boolean(args['dry-run']),
    withFiles: !args['metadata-only']
  });

  const {stats, warnings} = result;
  console.log('');
  console.log('漫画工程迁移（只读）');
  console.log('----------------------------------------');
  console.log(`源目录     ${path.resolve(args.data)}`);
  console.log(`数据库     ${result.databaseFile}`);
  console.log(`缓存       ${result.archiveRoot ?? '(dry-run 临时目录，已清理)'}`);
  console.log(`模式       ${result.dryRun ? '演练' : '写入'}`);
  console.log('----------------------------------------');
  console.log(`项目       ${stats.projects}（新建 ${stats.projectsCreated} / 已存在 ${stats.projectsExisting} / 跳过 ${stats.skippedProjects}）`);
  console.log(`话数       ${stats.episodes}（已存在 ${stats.episodesExisting}）`);
  console.log(`资产       ${stats.assets}（已存在 ${stats.assetsExisting} / 无字节 ${stats.assetsWithoutBytes}）`);
  console.log(`版本       ${stats.revisions}`);
  console.log(`文档       ${stats.documents}`);
  console.log(`归档文件   ${stats.filesArchived}`);
  console.log(`警告       ${warnings.length}`);
  console.log('----------------------------------------');

  if (warnings.length) {
    console.log('警告（前 30 条）：');
    for (const warning of warnings.slice(0, 30)) console.log(`  - ${warning}`);
    if (warnings.length > 30) console.log(`  ... 其余 ${warnings.length - 30} 条见后续报告`);
  } else {
    console.log('没有警告。');
  }
  console.log('');
} catch (error) {
  console.error(`迁移失败：${error.message}`);
  if (process.env.APP_DEBUG === '1' && error.stack) console.error(error.stack);
  process.exitCode = 1;
}

function parse(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`无法识别的参数：${token}`);
    const key = token.slice(2);
    if (['dry-run', 'metadata-only', 'help'].includes(key)) {
      result[key] = true;
      continue;
    }
    if (!['data', 'db', 'cache'].includes(key)) throw new Error(`未知选项：--${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`选项 --${key} 需要一个值`);
    result[key] = value;
    index += 1;
  }
  return result;
}
