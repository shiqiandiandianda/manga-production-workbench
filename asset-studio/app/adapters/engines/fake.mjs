/**
 * 假执行器：阶段 3 用来验证任务管线，不调用任何 AI、不消耗额度。
 *
 * 产出是一张合法的 1×1 PNG；真实执行器（角色工房）后续替换它。
 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export function createFakeExecutor({latencyMs = 30, bytes = ONE_PIXEL_PNG} = {}) {
  return {
    id: 'fake',
    label: '假执行器（不耗额度）',
    capabilities: ['asset.generate'],

    async probe() {
      return {ready: true};
    },

    estimate() {
      return {slots: 1, minutes: 0};
    },

    async run(_manifest, ctx = {}) {
      if (latencyMs > 0) {
        await new Promise(resolve => setTimeout(resolve, latencyMs));
      }
      ctx.progress?.({percent: 100});
      return {
        bytes,
        mime: 'image/png',
        engineJobId: `fake_${Date.now()}`
      };
    },

    async cancel() {
      return true;
    }
  };
}
