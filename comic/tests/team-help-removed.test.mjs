import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 4000) { const end = Date.now() + timeout; while (Date.now() < end) { if (check()) return; await delay(10); } throw new Error(message); }

test('团队帮忙生图默认移除：页面 410、接口 410、本机任务不受影响', async t => {
  const previous = process.env.COMIC_TEAM_HELP;
  delete process.env.COMIC_TEAM_HELP;
  t.after(() => { if (previous === undefined) delete process.env.COMIC_TEAM_HELP; else process.env.COMIC_TEAM_HELP = previous; });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-team-help-removed-'));
  const bridge = {close() {}, status: async () => ({connected: true, imageFeature: true}), generate: async () => ({bytes: png, imageToolSeen: true, description: '合成测试图'})};
  const studio = createStudio({dataDir: directory, bridge, jimengBridge: {close() {}, status: async () => ({connected: false})}, storyboardGenerator: {close() {}}});
  await new Promise(resolve => studio.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { studio.close(); await until(() => studio.idle(), 'cleanup').catch(() => {}); await new Promise(resolve => { studio.server.close(() => resolve()); studio.server.closeAllConnections?.(); }); fs.rmSync(directory, {recursive: true, force: true}); });
  const origin = 'http://127.0.0.1:' + studio.server.address().port;
  const get = async route => { const response = await fetch(origin + route); return {status: response.status, text: await response.text()}; };
  assert.equal((await get('/project-center.html')).status, 410);
  assert.equal((await get('/collab.html')).status, 410);
  const status = await fetch(origin + '/api/production-center/status');
  assert.equal(status.status, 410);
  assert.match((await status.json()).error, /已移除/);
  const project = createProject('移除团队帮忙后的本机生图', true);
  studio.store.db.projects.push(project); studio.store.save();
  const submitted = await fetch(origin + '/api/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({projectId: project.id, panelIds: [project.pages[0].panels[0].id], provider: 'codex'})});
  assert.equal(submitted.status, 202);
  await until(() => studio.store.db.jobs.every(job => job.status === 'done'), 'local generation still works');
});
