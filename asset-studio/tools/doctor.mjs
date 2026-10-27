#!/usr/bin/env node
/**
 * 环境自检。排障第一入口。
 *
 * 只读：不启动服务、不写业务数据、不连接任何外部系统。
 * 退出码 0 表示可以启动；1 表示有必须处理的问题。
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {describeConfig, loadConfig} from '../app/platform/config/index.mjs';
import {VERSION} from '../app/version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
const record = (level, name, detail) => results.push({level, name, detail});

function ok(name, detail = '') {
  record('ok', name, detail);
}

function warn(name, detail = '') {
  record('warn', name, detail);
}

function bad(name, detail = '') {
  record('fail', name, detail);
}

async function main() {
  const version = parseVersion(process.version);
  if (version.major >= 24) {
    ok('Node 版本', process.version);
  } else {
    const sqlite = await hasSqlite();
    if (sqlite) warn('Node 版本', `${process.version} 可用 node:sqlite，但目标运行时是 Node 24`);
    else bad('Node 版本', `${process.version} 缺少 node:sqlite，请升级到 Node 24`);
  }

  let config;
  try {
    config = loadConfig({ensureDirs: false});
    ok('配置', describeConfig(config).configFile);
  } catch (error) {
    bad('配置', error.message);
    print();
    process.exitCode = 1;
    return;
  }

  const summary = describeConfig(config);
  ok('运行角色', summary.role);

  for (const [name, dir] of [
    ['数据目录', config.paths.data],
    ['缓存目录', config.paths.cache],
    ['日志目录', config.paths.logs],
    ['工作目录', config.paths.workspace]
  ]) {
    try {
      fs.mkdirSync(dir, {recursive: true});
      const probe = path.join(dir, `.doctor-${Date.now()}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      ok(`${name}可写`, dir);
    } catch (error) {
      bad(`${name}不可写`, `${dir}（${error.message}）`);
    }
  }

  const database = config.paths.database;
  if (fs.existsSync(database)) {
    try {
      const {DatabaseSync} = await import('node:sqlite');
      const db = new DatabaseSync(database, {readOnly: true});
      const row = db.prepare('PRAGMA integrity_check').get();
      db.close();
      const value = row?.integrity_check ?? Object.values(row ?? {})[0];
      if (value === 'ok') ok('数据库', `${database}（完整性检查通过）`);
      else bad('数据库', `${database}（完整性检查：${value}）`);
    } catch (error) {
      bad('数据库', `${database}（${error.message}）`);
    }
  } else {
    ok('数据库', `${database}（将在首次启动时创建）`);
  }

  const webIndex = path.join(ROOT, 'app', 'web', 'index.html');
  if (fs.existsSync(webIndex)) ok('前端外壳', webIndex);
  else bad('前端外壳', `缺少 ${webIndex}`);

  if (config.role === 'node') {
    if (!config.hub.url) {
      bad('集群地址', '未配置 hub.url；节点无法注册');
    } else {
      try {
        const response = await fetch(`${config.hub.url}/api/v1/health`, {
          signal: AbortSignal.timeout(2500)
        });
        const info = await response.json();
        if (response.ok && info.ok) ok('集群地址', `${config.hub.url} · v${info.version ?? '?'}`);
        else bad('集群地址', `${config.hub.url} 健康检查未通过`);
      } catch (error) {
        bad('集群地址', `${config.hub.url}（${error.message}）`);
      }
    }
    const names = [
      config.executors.fake.enabled ? 'fake' : '',
      config.executors.workshop.enabled ? 'character.workshop' : ''
    ].filter(Boolean);
    if (names.length) ok('执行器', names.join(', '));
    else bad('执行器', '没有启用任何执行器');
  } else {
    const port = config.role === 'hub' ? config.hub.port : config.studio.port;
    const host = config.role === 'hub' ? config.hub.listen : config.studio.host;
    const probe = await portFree(port, host);
    if (probe.ok) ok('端口', `${host}:${port} 可用`);
    else bad('端口', `${host}:${port} 不可用（${probe.reason}）`);
  }

  if (config.archive.kind === 'moku') {
    warn('归档', `墨库模式：${config.archive.baseUrl}（阶段 5 才会真正联调）`);
  } else {
    ok('归档', 'local（内容寻址缓存，阶段 5 切换墨库）');
  }

  if (config.executors.workshop.enabled) {
    try {
      const response = await fetch(`${config.executors.workshop.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(2500)
      });
      const info = await response.json();
      if (response.ok && info.app === 'comic-character-workbench') {
        ok('角色工房', `${config.executors.workshop.baseUrl} · v${info.version ?? '?'}`);
      } else {
        bad('角色工房', `${config.executors.workshop.baseUrl} 不是角色工房`);
      }
    } catch (error) {
      bad('角色工房', `${config.executors.workshop.baseUrl}（${error.message}）`);
    }
  } else {
    ok('角色工房', '未启用（真实生成会消耗额度）');
  }

  ok('产品版本', VERSION);
  print();

  const failures = results.filter(item => item.level === 'fail').length;
  process.exitCode = failures ? 1 : 0;
}

function parseVersion(text) {
  const [major, minor] = String(text).replace(/^v/, '').split('.').map(Number);
  return {major, minor};
}

async function hasSqlite() {
  try {
    await import('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

function portFree(port, host) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', error => resolve({ok: false, reason: error.code || error.message}));
    server.once('listening', () => server.close(() => resolve({ok: true})));
    server.listen(port, host);
  });
}

function print() {
  const mark = {ok: '[ok]  ', warn: '[warn]', fail: '[fail]'};
  console.log('');
  console.log('漫画生产平台 · 环境自检');
  console.log('----------------------------------------');
  for (const item of results) {
    console.log(`${mark[item.level]} ${item.name.padEnd(10, ' ')} ${item.detail}`);
  }
  console.log('----------------------------------------');
  const counts = {ok: 0, warn: 0, fail: 0};
  for (const item of results) counts[item.level] += 1;
  console.log(`通过 ${counts.ok}，警告 ${counts.warn}，失败 ${counts.fail}`);
  console.log('');
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
