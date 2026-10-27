# 旧工程迁移（阶段 2）

把旧漫画数据目录里的工程、话数、资产与工程文档，只读导入新库。

## 前置

1. 旧漫画数据目录必须是包含 `studio.json` 的目录：
   - `storage: 2`：`studio.json` + `projects/<id>.json` + `assets/`
   - 旧版单文件：`studio.json` 内直接有 `projects`
2. 先备份旧目录。本工具不写旧目录，但迁移前留一份永远是对的。
3. Node 24（`node:sqlite`）。

## 顺序

```bash
# 1. 演练：内存数据库 + 临时缓存，结束后丢弃
node tools/migrate/import-comic.mjs --data "<旧漫画数据目录>" --dry-run

# 2. 正式导入：默认 data/platform.sqlite + data/cache
node tools/migrate/import-comic.mjs --data "<旧漫画数据目录>"

# 3. 对账
node tools/migrate/reconcile.mjs --data "<旧漫画数据目录>"
```

可选参数：

| 参数 | 作用 |
|---|---|
| `--db <文件>` | 指定新数据库 |
| `--cache <目录>` | 指定内容缓存 |
| `--metadata-only` | 只登记元数据，不复制图片字节（缩略图会 404） |

## 判定标准

- 演练输出的"警告"应为 0；有警告逐条看原因，不要直接写库。
- 正式导入后，`reconcile` 的"差异"必须为 0；退出码 1 表示有差异。
- 新入口能按项目打开，话数、资产名、缩略图与旧工程一致。
- 再跑一次导入：`新建 0 / 已存在 N`，项目、话数、资产、文档数量不变。

## 幂等与编号

- 项目：`externalKey = comic:<旧 projectId>` 唯一。
- 话数 / 资产 / 文档：旧编号写入 `legacy_ids`，重复导入直接复用。
- 资产版本：`revisionId = local:<sha256>`，内容寻址；阶段 5 换成墨库 revisionId。
- 同一项目的不同旧资产如果落到同一形态，会用旧编号尾缀区分，不错误合并。

## 不导入什么

任务、审批、绑定、面板、修图记录。它们和阶段 3 的面板模型一起迁，避免只搬一半的状态。
