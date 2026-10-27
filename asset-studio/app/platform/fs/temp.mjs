/**
 * 临时目录：优先使用显式配置，其次仓库内 .tmp，最后才是系统临时目录。
 *
 * 有些 Windows 环境（或受限进程）不能写 `%TEMP%`，此时系统临时目录会 EPERM。
 * 统一走这里，避免每个调用点各自猜。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');

export function tempRoots() {
  return [
    process.env.APP_TEMP_DIR,
    path.join(REPO_ROOT, '.tmp'),
    os.tmpdir()
  ].filter(Boolean);
}

export function createTempDir(prefix = 'tmp-') {
  const errors = [];
  for (const base of tempRoots()) {
    try {
      fs.mkdirSync(base, {recursive: true});
      return fs.mkdtempSync(path.join(base, prefix));
    } catch (error) {
      errors.push(`${base}: ${error.code || error.message}`);
    }
  }
  throw new Error(`无法创建临时目录（${errors.join('; ')}）`);
}
