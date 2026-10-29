import test from 'node:test';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {GenerationSlots, GenerationSlotsClient} from '../lib/generation-slots.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const portablePython = path.resolve(root,'../runtime/python/python.exe');
const python = process.env.CODEX_PRIMARY_RUNTIME_PYTHON || process.env.COMIC_PYTHON_BIN || (existsSync(portablePython)?portablePython:'python3');
const repairWorker = [path.join(root,'repair/python/generation_worker.py'),path.join(root,'repair-engine/python/generation_worker.py')].find(existsSync);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, live = null) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'comic-slots-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const options = {directory, limit:2, pollMs:5, ...(live ? {isAlive:pid => live.has(pid)} : {})};
  return {directory, options, slots:new GenerationSlots(options)};
}
async function serve(t, slots) {
  const events = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    events.push(url.pathname);
    if (!await slots.handle(req, res, url)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {origin, events, client:new GenerationSlotsClient({origin, pollMs:5})};
}
function childResult(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({code, output}));
  });
}

test('comic and repair callers together occupy at most two image slots', async t => {
  const live = new Set([11, 12, 13]);
  const {slots} = await fixture(t, live);
  const first = await slots.acquire({ownerId:'comic:1', ownerPid:11, requestId:'a'});
  const second = await slots.acquire({ownerId:'repair:2', ownerPid:12, requestId:'b'});
  let acquired = false;
  const third = slots.acquire({ownerId:'repair:3', ownerPid:13, requestId:'c'}).then(value => { acquired = true; return value; });
  await delay(25);
  assert.equal(acquired, false);
  assert.equal(slots.snapshot().running, 2);
  first.release({completed:true});
  const next = await third;
  assert.equal(slots.snapshot().running, 2);
  second.release({completed:true}); next.release({completed:true});
});

test('cancelled waiter never consumes a slot or starts generation', async t => {
  const live = new Set([11, 12, 13]);
  const {slots} = await fixture(t, live);
  const one = await slots.acquire({ownerId:'one', ownerPid:11});
  const two = await slots.acquire({ownerId:'two', ownerPid:12});
  const controller = new AbortController();
  const pending = slots.acquire({ownerId:'cancelled', ownerPid:13, signal:controller.signal});
  controller.abort();
  await assert.rejects(pending, {name:'AbortError'});
  assert.equal(slots.snapshot().running, 2);
  one.release({completed:true}); two.release({completed:true});
  assert.equal(slots.snapshot().running, 0);
});

test('restart keeps a detached live worker even after its Node owner dies', async t => {
  const live = new Set([11, 22, 33]);
  const {slots, options} = await fixture(t, live);
  const lease = await slots.acquire({ownerId:'repair:1', ownerPid:11, requestId:'attempt1'});
  lease.trackPid(22);
  live.delete(11);
  const restarted = new GenerationSlots(options);
  assert.equal(restarted.snapshot().running, 1);
  const second = await restarted.acquire({ownerId:'comic:2', ownerPid:33});
  assert.equal(restarted.tryAcquire({ownerId:'blocked', ownerPid:33}), null);
  live.delete(22);
  assert.equal(restarted.snapshot().running, 1);
  assert.throws(() => restarted.tryAcquire({ownerId:'repair:1', ownerPid:33, requestId:'attempt1'}), /不能重复提交/);
  second.release({completed:true});
});

test('cancel release waits for all tracked workers; idle completion releases explicitly', async t => {
  const live = new Set([11, 22, 23]);
  const {slots} = await fixture(t, live);
  const cancelled = await slots.acquire({ownerId:'cancel', ownerPid:11});
  cancelled.trackPid(22); cancelled.trackPid(23);
  cancelled.release();
  assert.equal(slots.snapshot().running, 1);
  live.delete(22);
  assert.equal(slots.snapshot().running, 1);
  live.delete(23);
  assert.equal(slots.snapshot().running, 0);
  live.add(22);
  const idle = await slots.acquire({ownerId:'pool-next', ownerPid:11});
  idle.trackPid(22);
  idle.release({completed:true});
  assert.equal(slots.snapshot().running, 0);
  assert.equal(live.has(22), true, 'completed persistent worker can remain idle');
});

test('request deduplication and worker claim nonce prevent a second generation', async t => {
  const live = new Set([11, 22, 23]);
  const {slots} = await fixture(t, live);
  const lease = await slots.acquire({ownerId:'repair', ownerPid:11, requestId:'fixed-attempt'});
  const duplicate = await slots.acquire({ownerId:'repair', ownerPid:11, requestId:'fixed-attempt'});
  assert.equal(duplicate.token, lease.token);
  assert.equal(slots.snapshot().running, 1);
  slots.track(lease.token, 22, true);
  slots.track(lease.token, 22, true);
  assert.throws(() => slots.track(lease.token, 23, true), /禁止重复生成/);
  lease.release({completed:true});
  assert.throws(() => slots.track(lease.token, 23), /身份已结束/);
  assert.throws(() => slots.tryAcquire({ownerId:'repair', ownerPid:11, requestId:'fixed-attempt'}), /不能重复提交/);
});

test('HTTP repair client shares coordinator, deduplicates identity, rejects browser calls', async t => {
  const {slots} = await fixture(t);
  const {origin, client} = await serve(t, slots);
  const one = await client.acquire({ownerId:'repair-http', requestId:'a'});
  const duplicate = await client.acquire({ownerId:'repair-http', requestId:'a'});
  assert.equal(one.token, duplicate.token);
  const direct = await slots.acquire({ownerId:'comic-direct', requestId:'b'});
  const controller = new AbortController();
  const waiting = client.acquire({ownerId:'repair-cancel', requestId:'c', signal:controller.signal});
  await delay(20); controller.abort();
  await assert.rejects(waiting, {name:'AbortError'});
  direct.release({completed:true});
  await one.release({completed:true});
  await assert.rejects(client.acquire({ownerId:'repair-cancel', requestId:'c'}), /不能重复提交/);
  const response = await fetch(`${origin}/api/generation-slots/acquire`, {method:'POST', headers:{Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({ownerId:'browser', ownerPid:process.pid})});
  assert.equal(response.status, 403);
  assert.equal(slots.snapshot().running, 0);
});

test('expired unclaimed reservation cannot reuse its stale token', async t => {
  const live = new Set([11, 22]);
  const {slots, options} = await fixture(t, live);
  const lease = await slots.acquire({ownerId:'lost-response', ownerPid:11});
  slots.state.leases[0].createdAt = Date.now() - 31000;
  slots.save();
  const restarted = new GenerationSlots(options);
  assert.equal(restarted.snapshot().running, 0);
  assert.throws(() => restarted.track(lease.token, 22, true), /身份已结束/);
});

test('detached Python wrapper registers itself and child before fake generation', async t => {
  const {slots, directory} = await fixture(t);
  const {origin, events, client} = await serve(t, slots);
  const lease = await client.acquire({ownerId:'repair-worker', requestId:'attempt'});
  const marker = path.join(directory, 'generated.txt');
  const pipeline = path.join(directory, 'fake-pipeline.py');
  await writeFile(pipeline, `import subprocess, sys\nfrom pathlib import Path\nchild = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(.4)'])\nPath(${JSON.stringify(marker)}).write_text('fake generated')\nchild.wait()\n`);
  const child = spawn(python, [path.join(root, 'repair-engine/python/generation_worker.py'), '--pipeline', pipeline], {env:{...process.env, COMIC_GENERATION_SLOT_ORIGIN:origin, COMIC_GENERATION_SLOT_TOKEN:lease.token}, stdio:['ignore','pipe','pipe']});
  const result = await childResult(child);
  assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(marker, 'utf8'), 'fake generated');
  assert.ok(events.indexOf('/api/generation-slots/claim') < events.indexOf('/api/generation-slots/track'));
  assert.ok(events.includes('/api/generation-slots/release'));
  assert.equal(result.output.includes(lease.token), false);
  assert.equal(slots.snapshot().running, 0);
});

test('stale wrapper identity fails closed before any pipeline code or fake generation', async t => {
  const {slots, directory} = await fixture(t);
  const {origin, client} = await serve(t, slots);
  const lease = await client.acquire({ownerId:'cancel-before-start', requestId:'attempt'});
  await lease.release({completed:true});
  const pipeline = path.join(directory, 'never-run.py');
  const marker = path.join(directory, 'unexpected.txt');
  await writeFile(pipeline, `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('unexpected')\n`);
  const child = spawn(python, [path.join(root, 'repair-engine/python/generation_worker.py'), '--pipeline', pipeline], {env:{...process.env, COMIC_GENERATION_SLOT_ORIGIN:origin, COMIC_GENERATION_SLOT_TOKEN:lease.token}, stdio:['ignore','pipe','pipe']});
  const result = await childResult(child);
  assert.equal(result.code, 1);
  assert.equal(result.output.includes(lease.token), false);
  await assert.rejects(readFile(marker), {code:'ENOENT'});
});

test('main persistent Python synchronously registers both PIDs without real AI', async t => {
  const {slots} = await fixture(t);
  const {origin, client, events} = await serve(t, slots);
  const lease = await client.acquire({ownerId:'main-python', requestId:'attempt'});
  const script = `import os, sys\nsys.path.insert(0, ${JSON.stringify(path.join(root, 'python'))})\nfrom codex_worker import register_generation_slot\nclass Process: pid = os.getpid()\nclass Server: process = Process()\nregister_generation_slot(Server(), {'globalSlot':{'origin':os.environ['TEST_SLOT_ORIGIN'],'token':os.environ['TEST_SLOT_TOKEN']}})\nprint('registered')\n`;
  const child = spawn(python, ['-c', script], {env:{...process.env, TEST_SLOT_ORIGIN:origin, TEST_SLOT_TOKEN:lease.token}, stdio:['ignore','pipe','pipe']});
  const result = await childResult(child);
  assert.equal(result.code, 0, result.output);
  assert.equal(events.filter(value => value === '/api/generation-slots/track').length, 2);
  assert.equal(result.output.includes(lease.token), false);
  await lease.release({completed:true});
});

test('main Python never sends turn/start when its coordinator identity is stale', async t => {
  const {slots, directory} = await fixture(t);
  const {origin, client} = await serve(t, slots);
  const lease = await client.acquire({ownerId:'main-stale',requestId:'attempt'});
  await lease.release({completed:true});
  await writeFile(path.join(directory,'input.json'),JSON.stringify({action:'generate',referenceFiles:[],globalSlot:{origin,token:lease.token}}));
  await writeFile(path.join(directory,'request.txt'),'fake generation request');
  const script = `import os, sys\nfrom pathlib import Path\nsys.path.insert(0, ${JSON.stringify(path.join(root,'python'))})\nfrom codex_worker import generate, BridgeError\nclass Process: pid = os.getpid()\nclass Server:\n process=Process()\n generation_started=False\n def rpc(self,method,params,timeout=30):\n  if method=='thread/start':return {'thread':{'id':'fake'}}\n  raise AssertionError('turn/start must never be sent')\ntry:\n generate(Server(),Path(sys.argv[1]))\nexcept BridgeError as error:\n assert error.code=='generation_slot_unavailable', error.code\n print('blocked before turn/start')\nelse:raise AssertionError('unexpected generation')\n`;
  const result=await childResult(spawn(python,['-c',script,directory],{stdio:['ignore','pipe','pipe']}));
  assert.equal(result.code,0,result.output);
  assert.match(result.output,/blocked before turn\/start/);
  assert.equal(result.output.includes(lease.token),false);
  await assert.rejects(readFile(path.join(directory,'result.json')),{code:'ENOENT'});
});

test('unknown cloud image keeps its slot after Node and CLI die; query recovery reuses that slot', async t=>{
  const live=new Set([11,22,33]);
  const {slots,options}=await fixture(t,live);
  const cloud=await slots.acquire({ownerId:'comic:jimeng-original',ownerPid:11,requestId:'submit-attempt'});
  cloud.keepRemote();cloud.trackPid(22);cloud.release();
  live.delete(11);live.delete(22);
  const restarted=new GenerationSlots(options);
  assert.equal(restarted.snapshot().running,1,'remote image cannot be inferred stopped from local PID death');
  assert.deepEqual(restarted.listRemote().map(item=>item.ownerId),['comic:jimeng-original']);
  const other=await restarted.acquire({ownerId:'repair:other',ownerPid:33,requestId:'repair-attempt'});
  assert.equal(restarted.tryAcquire({ownerId:'comic:new',ownerPid:33,requestId:'new-image'}),null);
  assert.throws(()=>restarted.tryAcquire({ownerId:'comic:jimeng-original',ownerPid:33,requestId:'new-submit'}),/恢复原任务/);
  const recovery=await restarted.acquire({ownerId:'comic:jimeng-original',ownerPid:33,requestId:'query-attempt',recoveryOnly:true});
  assert.equal(restarted.snapshot().running,2,'query recovery does not consume a third slot');
  assert.notEqual(recovery.token,cloud.token,'retired attempt callbacks must not affect recovery');
  assert.throws(()=>restarted.track(cloud.token,33),/身份已结束/);
  restarted.release(cloud.token,{completed:true});
  assert.equal(restarted.snapshot().running,2,'old owner completion does not clear recovery');
  recovery.release({completed:true});
  assert.equal(restarted.listRemote().length,0);
  assert.equal(restarted.snapshot().running,1);
  other.release({completed:true});
});

test('known completed or rejected cloud query clears lease, while unknown cancellation keeps it',async t=>{
  const live=new Set([11]);
  const {slots,options}=await fixture(t,live);
  const first=await slots.acquire({ownerId:'cloud:cancelled',ownerPid:11,requestId:'submit'});
  first.keepRemote();first.release();
  assert.equal(slots.snapshot().running,1);
  const recovered=await slots.acquire({ownerId:'cloud:cancelled',ownerPid:11,requestId:'query',recoveryOnly:true});
  recovered.release({completed:true});
  assert.equal(slots.snapshot().running,0);
  const final=new GenerationSlots(options);
  assert.equal(final.listRemote().length,0);
  assert.throws(()=>final.tryAcquire({ownerId:'cloud:cancelled',ownerPid:11,requestId:'submit'}),/不能重复提交/);
});

test('six default shared image slots admit mixed comic and repair jobs and queue the seventh',async t=>{
  const {directory}=await fixture(t);
  const slots=new GenerationSlots({directory,pollMs:5});
  const held=[];
  for(let i=0;i<6;i++)held.push(await slots.acquire({ownerId:(i%2?'repair:':'comic:')+i,requestId:'six-'+i}));
  assert.deepEqual(slots.snapshot(),{running:6,concurrency:6});
  let admitted=false;const seventh=slots.acquire({ownerId:'comic:seventh',requestId:'seven'}).then(lease=>{admitted=true;return lease;});
  await delay(25);assert.equal(admitted,false);
  held[0].release({completed:true});const last=await seventh;
  assert.deepEqual(slots.snapshot(),{running:6,concurrency:6});
  for(const lease of held.slice(1))lease.release({completed:true});last.release({completed:true});
  assert.equal(slots.snapshot().running,0);
});
