/**
 * SQLite 打开与连接级设置。
 *
 * node:sqlite 是 Node 24 内置模块；阶段 1 只依赖它，不引第三方驱动。
 */
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export function openDatabase(file, {readOnly = false} = {}) {
  if (!file) throw new Error('缺少数据库路径');
  if (file !== ':memory:' && !readOnly) {
    fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  }
  const db = readOnly ? new DatabaseSync(file, {readOnly: true}) : new DatabaseSync(file);
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
  }
  return db;
}

export function databaseSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
