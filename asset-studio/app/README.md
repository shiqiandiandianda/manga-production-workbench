# 漫画生产平台 · 阶段 1–3

这是《统一架构设计》的落地骨架：**一套代码、三种角色、一个内核、一个外壳、一条任务链**。
当前完成阶段 1（骨架）、阶段 2（旧工程只读统一）、阶段 3（任务闭环，假执行器）。不替代旧系统，也不接真实生成。

## 前置

- Node.js **24 或更新版本**（依赖内置 `node:sqlite`）
- 仓库自带运行时：`01-漫画与资产集成主平台\.runtime\node.exe`（v24）。如果 `node` 不在 PATH，直接用它，或双击 `启动漫画平台.cmd` / `验证阶段2.cmd`。
- 不需要 `npm install`，没有第三方依赖
- Windows / macOS / Linux 均可；默认数据目录在当前仓库下

## 启动

> 最简单：双击根目录 `一键启动.cmd`（自动开浏览器）。
> 团队中心：双击 `一键启动中心.cmd`，同事用浏览器打开窗口里的局域网地址即可，不用安装。

```bash
# 本机工作室（唯一入口）
node app/roles/studio.mjs

# 指定端口 / 配置
node app/roles/studio.mjs --port 8792 --config config/app.local.json

# 团队中心（默认只监听回环；对外部署前先设 hub.workerToken）
node app/roles/hub.mjs --port 8788

# 独立算力节点：不监听端口，通过 HTTP 向 hub 领取任务
node app/roles/node.mjs --config config/node.local.json
```

启动后打开 `http://127.0.0.1:8792/`。

需要覆盖默认配置时，把 `config/app.example.json` 复制成 `config/app.local.json` 再改；不复制也能直接运行。

## 自检与测试

```bash
node tools/doctor.mjs        # 环境、目录、数据库、端口、外壳
node tools/test-all.mjs      # 单元/契约测试 + 依赖边界
```

## 阶段 2 · 旧工程只读导入

先演练，确认数量与警告，再写库：

```bash
# 演练：内存数据库 + 临时缓存，不落盘
node tools/migrate/import-comic.mjs --data "<旧漫画数据目录>" --dry-run

# 正式导入：默认写 data/platform.sqlite 与 data/cache
node tools/migrate/import-comic.mjs --data "<旧漫画数据目录>"

# 对账：项目 / 话数 / 资产 sha256 / 文档
node tools/migrate/reconcile.mjs --data "<旧漫画数据目录>"
```

导入是只读、幂等的：项目按 `externalKey=comic:<旧id>` 去重，资产/话数/文档按 `legacy_ids` 去重，重复运行不会产生第二份。
阶段 2 不导入任务、审批、绑定与面板——它们和阶段 3 的面板模型一起迁，避免只搬一半的状态。

## 阶段 3 · 任务闭环（假执行器）
在「任务」抽屉里填角色、名称、形态、提示词，点「提交缺失资产」：

1. 本机执行循环自动领取任务，假执行器产出一张合法 PNG（不调用 AI、不消耗额度）；
2. 任务进入「待审核」，可看缩略图；
3. 点「批准」，该版本成为资产的唯一生效版本；点「退回」必须填原因；
4. 重复提交同一形态会合并订阅；已批准的形态会直接复用，不再生成。

API 对应：

```http
POST /api/v1/projects/:projectId/asset-requests
GET  /api/v1/projects/:projectId/tasks
GET  /api/v1/tasks/:taskId
POST /api/v1/tasks/:taskId/review          {decision:"approve"|"reject", reason?}
GET  /api/v1/projects/:projectId/bindings
POST /api/v1/projects/:projectId/bindings  {panelId, assetKey, revisionId}
```

绑定的 revision 必须是已批准版本；锁定引用需要 `force` 才能替换。
真实角色工房适配器已接入，但默认关闭；见下一节。

### 独立节点

节点不监听端口，只向 hub 出站：

```bash
node app/roles/node.mjs --config config/node.local.json
```

```json
{
  "role": "node",
  "hub": {"url": "http://<hub-ip>:8788", "workerToken": "<与 hub.hub.workerToken 相同>"},
  "node": {
    "machineId": "",
    "poolId": "local",
    "capacity": 1,
    "reserve": 0,
    "heartbeatMs": 5000,
    "claimMs": 1000
  },
  "executors": {
    "fake": {"enabled": true, "autoRun": false},
    "workshop": {"enabled": false}
  }
}
```

- 节点身份由 `(machineId, poolId)` 唯一确定；同一机器同一执行池重连不会虚增名额。
- 执行前写 `data/node-journal`；启动时发现未清理记录会提示人工核实，**不自动重派**。
- 节点不碰数据库，结果通过 `/api/v1/attempts/:id/result` 回传。
- hub 配置了 `hub.workerToken` 时，节点必须带同一个 token，否则 worker/attempt 接口返回 401。

### 接真实角色工房

默认关闭。确认工房在跑：

```bash
curl http://127.0.0.1:8892/api/health
# {"ok":true,"app":"comic-character-workbench","version":"1.18.0"}
```

在 `config/app.local.json` 里显式启用：

```json
{
  "executors": {
    "workshop": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:8892",
      "timeoutMs": 1800000,
      "pollMs": 1500
    }
  }
}
```

重启后任务抽屉会出现「角色工房（真实生成）」选项。

- **会消耗 Codex/账号额度**，默认不启用。
- 本机可能同时有 8892 与 8894 两个工房实例，选你实际要用的那个。
- 适配器契约：`POST /api/jobs {kind:"comic_character"}` → 轮询 `GET /api/state` → 读取 `job.files` 的 `/files/...`。
- 目前不自动上传参考图；带参考的角色一致性要等参考上传接进来。

### 真实候选试跑（会计费）

2026-10-19 已用真实工房跑通一次完整闭环：生成 → 待审核 → 批准 → 绑定 → applied，
产物 1024×1536 PNG。记录见 `00-统一架构/阶段3验收记录.md`。

参考图链路已接：提交时传 `referenceRevisionIds`（本项目已登记的固定版本，最多 3 个），
平台会先从内容缓存读字节，再上传给工房。

只有你主动运行脚本才会真正生成：

```bash
node tools/try-real-candidate.mjs --project <projectId> --name 李明 \
  --state 校服 --prompt "国漫线稿，角色设定图，正面" \
  --reference <revisionId>
```

脚本只提交、轮询、打印 revision；**不自动批准**，审核仍在平台任务抽屉完成。
运行前会检查 `character.workshop` 是否已注册；未启用会直接提示配置方法。

## 目录

```
app/
  core/          纯领域：模型、用例、端口（不 import node:*）
  platform/      基础设施：SQLite、HTTP、配置、日志
  adapters/      外部系统适配：archive、engines
  api/           唯一路由表
  compat/        旧协议投影（阶段 4 起）
  web/           唯一前端外壳（原生 ESM，无构建）
  roles/         studio / hub / node 组合根 + 本机执行循环
tools/           边界检查、doctor、测试、migrate/
tests/           领域、配置、API、归档、迁移、任务闭环
config/          配置示例
```

依赖规则由 `tools/check-boundaries.mjs` 机器检查：`core` 只能依赖自己，`web` 只能依赖自己，依赖方向永远向内。

## 已实现（阶段 1–3）

- 配置加载与校验（角色、端口、路径、归档模式、并发上限）
- SQLite 迁移框架 + 第一批表（projects / episodes / documents / assets / tasks / attempts / leases / events / outbox / legacy_ids）
- 项目：创建、读取、列表、改名、关联墨库项目（乐观并发 + 幂等 + 改绑保护）
- 项目创建支持 `externalKey`（来源工具稳定编号）：同一个 key 重复提交返回原项目，对应 `07/PROJECT-API.md` 的 create/find 语义
- 资产：读取、幂等登记身份与固定版本（供阶段 2 迁移）
- 事件：单调递增 seq，支持 `after` 游标增量拉取
- 统一外壳：顶栏项目上下文、话数栏、画布占位、检查器、资产/任务/规范/进度/变更/管理抽屉
- 统一错误：稳定 `code`、`retryable`、`nextAction`、`requestId`
- 安全基线：只监听回环、CSP、请求体上限、路径穿越防护、静态资源白名单

### 阶段 2

- `LocalArchive`：sha256 内容寻址缓存，`put / putFile / get / stat`，读取时校验
- `GET /api/v1/blobs/:sha256`：固定内容预览，浏览器可长期缓存
- 旧工程只读迁移器：项目、话数、资产身份与固定版本、`comic-project` 文档、`legacy_ids`
- 对账脚本：项目 / 话数 / 资产 sha256 / 文档，差异退出码 1
- 资产卡片显示真实缩略图

### 阶段 3

- 13 状态任务状态机，非法迁移直接拒绝
- 单任务管线：提交 / 合并订阅 / 领取 / 开始 / 完成 / 失败 / 审核 / 绑定
- 执行器契约 + `fake` 执行器 + 本机执行循环（租约、attempt、lease）
- 审核批准后该版本成为资产唯一生效版本；退回必须填原因
- 绑定带锁定保护；已批准版本不能被静默替换
- 任务抽屉：提交缺失资产、看候选缩略图、批准 / 退回、刷新

## 未实现（后续阶段）

| 阶段 | 内容 |
|---|---|
| 4 | 长条画布迁入、旧页面下线、规范/进度/变更抽屉 |
| 5 | 墨库 Archive 适配、归档 outbox、固定版本权威 |
| 6 | 旧服务归档、交付与演练 |

## 设计约束（改代码前先读）

1. 每个事实只有一个写入者；写操作走用例，不直接改库。
2. `core` 不 import `node:*`，不知道 HTTP / SQLite / 墨库。
3. 旧工具只能是执行器，不能有自己的项目、队列、页面、端口。
4. 每个错误必须有 `code` 和可执行的 `nextAction`。
5. 新增接口必须同时有：schema、错误码、契约测试、权限声明。
6. 任何依赖方向变化，先改 `tools/check-boundaries.mjs` 并写 ADR。

## 端口约定

| 端口 | 角色 | 说明 |
|---|---|---|
| 8792 | studio（当前） | 阶段 1 开发端口；阶段 6 切换为 8790 |
| 8788 | hub | 团队中心；阶段 1 默认只监听回环 |
| 14328 / 17879 | PhotoCraft | 本机修图，阶段 3 接入 |

不新增其他端口。旧系统的 18898 / 18909 / 19080 / 18897 / 8891 / 8892 不进入新链路。
