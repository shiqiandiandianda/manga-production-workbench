// These historical fixtures create or read an administrator token even in a
// synthetic directory. Do not launch them without a separately approved scope.
const blocked = new Set([
  'center/tests/http.test.mjs',
  'comic/tests/asset-center.integration.test.mjs',
  'comic/tests/asset-generator.integration.test.mjs',
]);

export function privilegedFixtureReason(file) {
  return blocked.has(file)
    ? '此旧用例会生成或读取隔离管理员令牌；未获针对该操作的审批，未启动。'
    : '';
}
