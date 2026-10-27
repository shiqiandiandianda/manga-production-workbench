// These historical fixtures exercise administrator credentials or owner-only
// actions, even in synthetic directories. Do not launch them without a
// separately approved scope.
const blocked = new Set([
  'center/tests/http.test.mjs',
  'comic/tests/asset-center.integration.test.mjs',
  'comic/tests/asset-generator.integration.test.mjs',
  'distribution/tests/forced-upgrades.test.mjs',
  'distribution/tests/rolling-upgrades.test.mjs',
  'distribution/tests/publisher-admin-page.test.mjs',
  'distribution/tests/publication.test.mjs',
  '协作/tests/hub-server.test.mjs',
]);

export function privilegedFixtureReason(file) {
  return blocked.has(file)
    ? '此旧用例会在隔离环境使用管理员凭据或执行管理员操作；未获针对该操作的审批，未启动。'
    : '';
}
