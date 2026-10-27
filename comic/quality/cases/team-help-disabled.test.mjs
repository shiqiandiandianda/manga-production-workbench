import test from 'node:test';
import assert from 'node:assert/strict';
import {createComicFixture} from '../../tests/helpers/collab-fixture.mjs';

test('默认关闭团队帮忙生图，旧入口明确拒绝且不产生任务', async t => {
  assert.notEqual(process.env.COMIC_TEAM_HELP, '1', '此用例必须以默认关闭状态运行');
  const fixture = await createComicFixture(t);
  const before = await fixture.api('/api/state');
  assert.equal(before.status, 200);
  assert.equal((await fixture.api('/api/health')).value.collaboration, false);
  for (const [route, method] of [
    ['/api/collab/status', 'GET'],
    ['/api/collab/pair', 'POST'],
    ['/api/production-center/status', 'GET'],
    ['/api/production-center/dispatch', 'POST'],
    ['/api/production-center/volunteer', 'POST'],
  ]) {
    const response = await fixture.api(route, method, method === 'POST' ? {} : undefined);
    assert.equal(response.status, 410, route);
    assert.match(response.value.error, /团队帮忙生图功能已移除/);
  }
  for (const route of ['/project-center.html', '/collab.html']) {
    const response = await fixture.apiRaw(route);
    assert.equal(response.status, 410, route);
    assert.match(response.bytes.toString('utf8'), /团队帮忙生图功能已移除/);
  }
  const home = await fixture.apiRaw('/');
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.bytes.toString('utf8'), /团队帮忙生图|\/project-center\.html|\/collab\.html/);
  const after = await fixture.api('/api/state');
  assert.deepEqual(after.value.jobs, before.value.jobs);
  assert.equal(fixture.calls.length, 0);
});
