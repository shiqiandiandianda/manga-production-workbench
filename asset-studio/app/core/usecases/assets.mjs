/**
 * 资产用例。
 *
 * 阶段 1 只实现读取与"登记身份/版本"，供阶段 2 的迁移器使用；
 * 生成、审核、绑定在阶段 3 接入。
 */
import {fail} from '../errors.mjs';
import {newId} from '../ids.mjs';
import {
  assetKeyOf,
  createAssetIdentity,
  createAssetRevision
} from '../model/asset.mjs';

export function createAssetUsecases({projects, assets, clock, ids = newId}) {
  function assertProject(projectId) {
    if (!projects.get(projectId)) throw fail.notFound('项目不存在');
  }

  return {
    /** 项目资产：身份 + 各自的固定版本，按创建顺序。 */
    async list({projectId}) {
      assertProject(projectId);
      return assets.listIdentities(projectId).map(identity => ({
        ...identity,
        revisions: assets.listRevisions(identity.id)
      }));
    },

    /** 幂等登记资产身份：同一 (projectId, assetKey) 只保留一条。 */
    async ensureIdentity({projectId, role, name, state = '', view = ''}) {
      assertProject(projectId);
      const assetKey = assetKeyOf({role, name, state, view});
      const existing = assets.findIdentity(projectId, assetKey);
      if (existing) return existing;
      const identity = createAssetIdentity({
        id: ids('asset'),
        projectId,
        role,
        name,
        state,
        view,
        now: clock()
      });
      return assets.insertIdentity(identity);
    },

    /** 幂等登记固定版本：同一 (assetId, revisionId) 重复调用返回原记录。 */
    async addRevision({assetId, revisionId, sha256, mime, size, status = 'candidate'}) {
      const identity = assets.getIdentity(assetId);
      if (!identity) throw fail.notFound('资产不存在');
      const existing = assets.findRevision(assetId, revisionId);
      if (existing) return existing;
      const revision = createAssetRevision({
        id: ids('rev'),
        assetId,
        revisionId,
        sha256,
        mime,
        size,
        status,
        now: clock()
      });
      return assets.insertRevision(revision);
    }
  };
}
