import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../../..');
const runner=path.join(root,'comic/quality/run.mjs');

function runWithPreload(code,args){
  assert.ok(process.env.QUALITY_RUN_DIR,'must run through the isolated quality runner');
  const dir=fs.mkdtempSync(path.join(process.env.QUALITY_RUN_DIR,'runner-preflight-'));
  const preload=path.join(dir,'mock.cjs'),output=path.join(dir,'nested');
  fs.writeFileSync(preload,code);
  const env={...process.env,NODE_OPTIONS:(process.env.NODE_OPTIONS||'')+' --require '+JSON.stringify(preload)};
  const child=spawnSync(process.execPath,[runner,...args,'--output',output],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(child.status,1,child.stderr||child.stdout);
  return {output,result:JSON.parse(fs.readFileSync(path.join(output,'results.json'),'utf8'))};
}

test('空间不足时在复制源码之前停止并生成中断报告',()=>{
  const {output,result}=runWithPreload("require('node:fs').statfsSync=()=>({bavail:1,bsize:1});",['--suite','small','--filter','outcomes.test.mjs']);
  assert.equal(result.complete,false);
  assert.equal(result.interrupted,true);
  assert.match(result.stoppedReason,/不足 3 GiB/);
  assert.deepEqual(result.results,[]);
  assert.equal(fs.existsSync(path.join(output,'source-1')),false);
  assert.equal(fs.existsSync(path.join(output,'report.html')),true);
});

test('无法启动测试进程时停止排队并标记阻断，而非虚报测试失败',()=>{
  const code="const cp=require('node:child_process');cp.spawn=()=>{const e=Error('synthetic spawn failure');e.code='EPERM';throw e;};require('node:module').syncBuiltinESMExports();";
  const {result}=runWithPreload(code,['--suite','small','--start','0','--end','2','--jobs','1']);
  assert.equal(result.complete,false);
  assert.equal(result.interrupted,true);
  assert.match(result.stoppedReason,/无法启动测试子进程/);
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].status,'blocked');
  assert.equal(result.results[0].kind,'spawn_error');
});
