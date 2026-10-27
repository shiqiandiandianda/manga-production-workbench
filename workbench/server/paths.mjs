/**
 * 目录布局：所有路径集中在这里，避免各模块各写一套相对路径。
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

/**
 * 数据根目录。支持用 WORKBENCH_DATA_DIR 指向别处——测试实例、便携部署都靠它，
 * 于是两个引擎的数据目录也必须跟着这个根走，否则"测试"会写进正式数据里。
 */
const DATA_ROOT = process.env.WORKBENCH_DATA_DIR || path.join(ROOT, 'data');

export const paths = {
  root: ROOT,
  /** 工作台自身数据：设置、索引、接收工单、写盘待补队列 */
  data: DATA_ROOT,
  /** 场记（场景模块）的服务与数据 */
  sceneApp: path.join(ROOT, 'app', 'scene'),
  sceneData: path.join(DATA_ROOT, 'scene'),
  /** 角色工房（角色模块）的 Python 源码与数据 */
  workshopEngine: path.join(ROOT, 'engine', 'workshop'),
  workshopData: path.join(DATA_ROOT, 'workshop'),
  /** 前端静态产物 */
  webDist: path.join(ROOT, 'app', 'web', 'dist'),
  /** 随包运行时 */
  runtimeNode: path.join(ROOT, 'runtime', 'node', 'bin', 'node.exe'),
  runtimePython: path.join(ROOT, 'runtime', 'python', 'python.exe'),
  runtimeCodex: path.join(ROOT, 'runtime', 'Codex')
};

export const files = {
  settings: path.join(paths.data, 'settings.json'),
  settingsBackup: path.join(paths.data, 'settings.json.bak'),
  tokens: path.join(paths.data, 'tokens.json'),
  /** 本机 AI 助手（Codex）读取的访问令牌，由工作台启动时自动签发 */
  assistantToken: path.join(paths.data, 'assistant-token.txt'),
  assetIndex: path.join(paths.data, 'asset-index.jsonl'),
  assetIndexSnapshot: path.join(paths.data, 'asset-index.json'),
  jobs: path.join(paths.data, 'intake-jobs.json'),
  jobsBackup: path.join(paths.data, 'intake-jobs.json.bak'),
  outbox: path.join(paths.data, 'outbox.json'),
  logs: path.join(paths.data, 'logs')
};
