#!/usr/bin/env node
/**
 * 真实角色候选试跑（会消耗 Codex/账号额度）。
 *
 * 前置：
 *   1. 角色工房在跑：GET http://127.0.0.1:8892/api/health
 *   2. 平台配置已启用 workshop：
 *        "executors": {"workshop": {"enabled": true, "baseUrl": "http://127.0.0.1:8892"}}
 *   3. 平台服务在跑（默认 http://127.0.0.1:8792）
 *
 * 用法：
 *   node tools/try-real-candidate.mjs --project <projectId> --name 李明 \
 *     --state 校服 --prompt "国漫线稿，角色设定图，正面"
 *
 * 可选：
 *   --base <平台地址>        默认 http://127.0.0.1:8792
 *   --executor <执行器>      默认 character.workshop
 *   --reference <revisionId> 可重复，最多 3 个；引用本项目已登记的固定版本
 *   --timeout <秒>           默认 900
 *
 * 脚本只提交和等待，不自动批准；审核仍在平台界面完成任务。
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const args = parse(process.argv.slice(2));

if (args.help || !args.project || !args.name || !args.prompt) {
  console.log(`用法：node tools/try-real-candidate.mjs --project <projectId> --name <角色名> --prompt <提示词> [选项]

选项：
  --state <形态>            例：校服
  --executor <执行器>       默认 character.workshop
  --reference <revisionId>  可重复，最多 3 个
  --base <平台地址>         默认 http://127.0.0.1:8792
  --timeout <秒>            默认 900
`);
  process.exit(args.help ? 0 : 1);
}

const base = String(args.base || 'http://127.0.0.1:8792').replace(/\/+$/, '');
const executor = args.executor || 'character.workshop';
const timeoutMs = Math.max(30, Number(args.timeout) || 900) * 1000;
const references = Array.isArray(args.reference)
  ? args.reference
  : args.reference ? [args.reference] : [];

try {
  const executors = await get('/api/v1/executors');
  if (!executors.executors.some(item => item.id === executor)) {
    console.error(`执行器未注册：${executor}`);
    console.error('请先在 config/app.local.json 启用 executors.workshop 并重启服务。');
    process.exitCode = 1;
  } else {
    const created = await post(`/api/v1/projects/${encodeURIComponent(args.project)}/asset-requests`, {
      items: [{
        needId: 'manual_try',
        role: args.role || 'character',
        name: args.name,
        state: args.state || '',
        view: args.view || '',
        prompt: args.prompt,
        executor,
        referenceRevisionIds: references.slice(0, 3)
      }]
    });

    console.log(`批次 ${created.batchId}：入队 ${created.accepted}，复用 ${created.reused}，阻塞 ${created.blocked}`);
    for (const item of created.blockedItems ?? []) console.log(`  阻塞：${item.reason}`);

    const taskId = created.tasks?.[0]?.taskId;
    if (!taskId) {
      console.log('没有新建任务。');
      process.exitCode = created.reused ? 0 : 1;
    } else {
      await waitFor(taskId);
    }
  }
} catch (error) {
  console.error(`试跑失败：${error.message}`);
  process.exitCode = 1;
}

async function waitFor(taskId) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    const task = (await get(`/api/v1/tasks/${taskId}`)).task;
    const line = `${task.state}${task.revision ? ` · ${task.revision.revisionId}` : ''}`;
    if (line !== last) {
      console.log(`任务 ${taskId}：${line}${task.reviewReason ? `（${task.reviewReason}）` : ''}`);
      last = line;
    }
    if (task.state === 'review') {
      console.log('');
      console.log('已进入待审核。打开平台「任务」抽屉批准或退回。');
      console.log(`revisionId：${task.revision?.revisionId}`);
      console.log(`sha256：${task.revision?.sha256}`);
      return;
    }
    if (['failed', 'uncertain', 'rejected', 'applied'].includes(task.state)) {
      if (task.state !== 'applied') process.exitCode = 1;
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  console.error(`等待超时（${Math.round(timeoutMs / 1000)} 秒）。任务可能仍在执行，请到平台任务面板查看。`);
  process.exitCode = 1;
}

async function get(route) {
  const response = await fetch(base + route);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body;
}

async function post(route, payload) {
  const response = await fetch(base + route, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body?.error?.message || `HTTP ${response.status}：${text.slice(0, 200)}`);
  }
  return body;
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
    if (!['project', 'name', 'state', 'view', 'role', 'prompt', 'executor', 'base', 'timeout', 'reference'].includes(key)) {
      throw new Error(`未知选项：--${key}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`选项 --${key} 需要一个值`);
    if (key === 'reference') {
      result.reference = result.reference ?? [];
      result.reference.push(value);
    } else {
      result[key] = value;
    }
    index += 1;
  }
  return result;
}
