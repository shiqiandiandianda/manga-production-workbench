import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

test('测试隔离：仅已登记的本机服务可访问，浏览器不能直连其他本机或外部地址',{timeout:30000},async t=>{
  const ports=process.env.QUALITY_PORTS_FILE;
  assert.ok(ports,'must run through quality runner');
  const hits=[];
  const server=http.createServer((req,res)=>{hits.push(req.url);res.end('synthetic');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const {chromium}=createRequire(import.meta.url)(process.env.COMIC_TEST_PLAYWRIGHT_MODULE);
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage();
  assert.equal(await (await page.goto(origin+'/allowed')).text(),'synthetic');
  assert.ok(hits.includes('/allowed'));
  // Remove the port registration while keeping the synthetic server listening.
  fs.writeFileSync(ports,'');
  await assert.rejects(fetch(origin),/QUALITY_GUARD/);
  await assert.rejects(fetch('http://example.invalid/'),/QUALITY_GUARD/);
  try { await page.goto(origin+'/blocked',{timeout:5000}); } catch {};
  assert.equal(hits.includes('/blocked'),false,'browser must not bypass the proxy to an unregistered local service');
  assert.throws(()=>fs.writeFileSync(path.resolve(process.env.QUALITY_RUN_DIR,'..','quality-outside-test.txt'),'no'),/QUALITY_GUARD/);
  assert.throws(()=>fs.readFileSync(path.resolve(process.env.QUALITY_RUN_DIR,'..','quality-outside-test.txt')),/QUALITY_GUARD/);
  assert.throws(()=>fs.readdirSync(path.resolve(process.env.QUALITY_RUN_DIR,'..')),/QUALITY_GUARD/);
  await assert.rejects(async()=>fs.promises.readFile(path.resolve(process.env.QUALITY_RUN_DIR,'..','quality-outside-test.txt')),/QUALITY_GUARD/);
  const python=spawnSync(process.env.COMIC_PYTHON_BIN,['-c','import pathlib, sys; pathlib.Path(sys.argv[1]).read_bytes()',path.resolve(process.env.QUALITY_RUN_DIR,'..','quality-outside-test.txt')],{encoding:'utf8'});
  assert.notEqual(python.status,0);assert.match(python.stderr,/QUALITY_GUARD/);
  assert.throws(()=>spawnSync('docker',['version']),/QUALITY_GUARD/);
});
