import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyOutcome} from '../outcomes.mjs';

test('失败、超时、拦截、跳过、待办、取消和零测试不能被报告为通过',()=>{
  const good='ℹ pass 2\nℹ fail 0\nℹ skipped 0\nℹ todo 0\nℹ cancelled 0';
  assert.equal(classifyOutcome({raw:good}).status,'passed');
  assert.equal(classifyOutcome({raw:'ℹ pass 0\nℹ skipped 1'}).kind,'skipped');
  assert.equal(classifyOutcome({raw:'QUALITY_BROWSER_RETRY: startup\n'+good}).status,'flaky');
  assert.equal(classifyOutcome({raw:'Error [ERR_MODULE_NOT_FOUND]: module absent',code:1}).kind,'missing_module_or_dependency');
  for(const input of [{raw:good,code:1},{raw:good,timed:true},{raw:good,interrupted:true},{raw:'QUALITY_GUARD: denied'},
    {raw:'ℹ pass 2\nℹ skipped 1'},{raw:'ℹ pass 2\nℹ todo 1'},{raw:'ℹ pass 2\nℹ cancelled 1'},{raw:''},
    {raw:'Ran 3 tests\nOK (skipped=1)',isPython:true},{raw:'QUALITY_BROWSER_RETRY: startup\n'+good}])assert.notEqual(classifyOutcome(input).status,'passed');
});
