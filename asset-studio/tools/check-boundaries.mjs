#!/usr/bin/env node
/**
 * 依赖边界检查（CI 必过）。
 *
 * 规则：依赖只能指向内层。
 *   core      → core / shared
 *   platform  → core / platform / shared
 *   adapters  → core / platform / adapters / shared
 *   api       → core / platform / api / shared
 *   compat    → core / api / compat / shared
 *   web       → web / shared
 *   roles     → 全部（唯一组合根）
 *
 * 另外：core 不能 import node:*；web 不能 import node:* 或服务端目录；禁止裸导入（本项目零 npm 依赖）。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');

const RULES = Object.freeze({
  core: ['core', 'shared'],
  platform: ['core', 'platform', 'shared'],
  adapters: ['core', 'platform', 'adapters', 'shared'],
  api: ['core', 'platform', 'api', 'shared'],
  compat: ['core', 'api', 'compat', 'shared'],
  web: ['web', 'shared'],
  roles: ['core', 'platform', 'adapters', 'api', 'compat', 'web', 'roles', 'shared'],
  shared: ['shared']
});

const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*['"]([^'"]+)['"]/g
];

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (/\.(mjs|js)$/.test(entry.name)) result.push(full);
  }
  return result;
}

function importsOf(text) {
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) found.add(match[1]);
  }
  return found;
}

function layerOf(relative) {
  const first = relative.split('/')[0];
  return first.includes('.') ? 'shared' : first;
}

const violations = [];
const files = walk(APP);

for (const file of files) {
  const relative = path.relative(APP, file).split(path.sep).join('/');
  const layer = layerOf(relative);
  const allowed = RULES[layer];
  if (!allowed) {
    violations.push(`${relative}: 未知的层（${layer}）`);
    continue;
  }

  const text = fs.readFileSync(file, 'utf8');
  for (const specifier of importsOf(text)) {
    if (specifier.startsWith('node:')) {
      if (layer === 'core' || layer === 'web') {
        violations.push(`${relative}: ${layer} 不能 import ${specifier}`);
      }
      continue;
    }
    if (!specifier.startsWith('.')) {
      violations.push(`${relative}: 禁止裸导入 "${specifier}"（本项目零 npm 依赖）`);
      continue;
    }

    const resolved = path.resolve(path.dirname(file), specifier);
    const relativeTarget = path.relative(APP, resolved);
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      violations.push(`${relative}: 不能 import app 之外的文件（${specifier}）`);
      continue;
    }
    const targetLayer = layerOf(relativeTarget.split(path.sep).join('/'));
    if (!allowed.includes(targetLayer)) {
      violations.push(`${relative}: ${layer} 不允许依赖 ${targetLayer}（${specifier}）`);
    }
  }
}

if (violations.length) {
  console.error(`依赖边界检查失败（${violations.length} 条）：`);
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`依赖边界检查通过：扫描 ${files.length} 个文件，0 条越界。`);
}
