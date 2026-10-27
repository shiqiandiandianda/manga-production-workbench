import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
import {blockGate, clearGate, gateBlocked, readGate} from '../../distribution/generation-gate.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 4000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return; await delay(10); } throw new Error(message); }

test('共享限流闸门：写入、读取、过期与清理', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-gate-'));
  const file = path.join(directory, 'generation-gate.json');
  try {
    assert.equal(gateBlocked(file), false);
    blockGate(file, 5000, 'codex_rate_limited', 2);
    const gate = readGate(file);
    assert.ok(gate.until > Date.now() + 3000);
    assert.equal(gate.reason, 'codex_rate_limited');
    assert.equal(gate.strikes, 2);
    assert.equal(gateBlocked(file), true);
    clearGate(file);
    assert.equal(gateBlocked(file), false);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('漫画编辑器 429 会写共享闸门，另一个通道可读到同一暂停时间', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-gate-429-'));
  const gateFile = path.join(directory, 'gate.json');
  const previousGate = process.env.COMIC_GENERATION_GATE, previousCooldown = process.env.COMIC_RATE_LIMIT_COOLDOWN_MS;
  process.env.COMIC_GENERATION_GATE = gateFile;
  process.env.COMIC_RATE_LIMIT_COOLDOWN_MS = '400';
  t.after(() => {
    if (previousGate === undefined) delete process.env.COMIC_GENERATION_GATE; else process.env.COMIC_GENERATION_GATE = previousGate;
    if (previousCooldown === undefined) delete process.env.COMIC_RATE_LIMIT_COOLDOWN_MS; else process.env.COMIC_RATE_LIMIT_COOLDOWN_MS = previousCooldown;
  });
  const rate = Object.assign(new Error('429 Too Many Requests'), {code: 'account_rate_limited', stage: 'turn/start', generationEnded: false, mayHaveStarted: false});
  let calls = 0;
  const bridge = {close() {}, status: async () => ({connected: true, imageFeature: true}), generate: async () => { calls++; if (calls === 1) throw rate; return {bytes: png, imageToolSeen: true}; }};
  const studio = createStudio({dataDir: directory, bridge, jimengBridge: {close() {}, status: async () => ({connected: false})}, storyboardGenerator: {close() {}}});
  await new Promise(resolve => studio.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { studio.close(); await until(() => studio.idle(), 'cleanup').catch(() => {}); await new Promise(resolve => { studio.server.close(() => resolve()); studio.server.closeAllConnections?.(); }); fs.rmSync(directory, {recursive: true, force: true}); });
  const origin = 'http://127.0.0.1:' + studio.server.address().port;
  const project = createProject('共享闸门 429 测试', true);
  studio.store.db.projects.push(project); studio.store.save();
  await fetch(origin + '/api/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({projectId: project.id, panelIds: [project.pages[0].panels[0].id], provider: 'codex'})});
  await until(() => calls === 1, 'first call');
  const gate = readGate(gateFile);
  assert.ok(gate.until > Date.now(), '429 必须写入共享闸门');
  assert.equal(gate.reason, 'codex_rate_limited');
  await until(() => studio.store.db.jobs.every(job => job.status === 'done'), 'cooldown retry');
  assert.equal(calls, 2);
  assert.equal(readGate(gateFile).until, 0, '成功生成后应清理闸门');
});
