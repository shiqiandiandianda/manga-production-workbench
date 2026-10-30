# 漫画制作工作台 AI 修改维护指南

这份指南用于接手当前漫画制作工作台的代码修改。先按问题定位负责模块，再沿请求与数据流确认原因。不要因为某个文件名称相近，就修改旧入口或另一份安装。

核对日期：2026-10-29。适用范围：包含 `comic/server.mjs`、`start-all.mjs`、`distribution/manager.mjs` 的整合版源码。本文路径均相对于该源码根目录；现场实际运行目录以 `/api/health.codeRoot` 为准。源码更新后，本文的文件名与函数名可以作为搜索起点，行号不作为长期定位依据。

## 1 五分钟接手

1. 阅读当前用户要求、根目录 `AGENTS.md` 和 `comic/AGENTS.md`。这些文件累积了不同时期的决定，要按适用版本和后续修正理解，不能把旧路径、旧端口当作现状。
2. 查询编辑器健康接口，确定真正运行的 `codeRoot` 和 `dataRoot`。本机常用编辑器端口是 **18909**，但同一端口可能被其他副本占用。
3. 在本文第 3 节查“问题 → 文件”，记录复现动作、涉及工程/话/画格，以及失败的网络请求。先区分显示问题、前端状态问题、服务端规则问题、模型/外部服务问题。
4. 改动前保留源码差异。使用 D 盘隔离数据、合成工程、假生成通道验证；现有生产工程、原图和账号不作为随意试验的数据。
5. 验证后按第 9 节加载变更，按第 10 节同步经过审查的源码。交付实际修改位置、测试结果及尚未验证的部分。

只读确认命令，在 PowerShell 中运行：

```powershell
$editorBase = 'http://127.0.0.1:18909'
$health = Invoke-RestMethod "$editorBase/api/health" -TimeoutSec 8
$health | Select-Object application, codeRoot, dataRoot, localImageTools
$editorRoot = $health.codeRoot
$platformRoot = Split-Path -Parent $editorRoot
Set-Location -LiteralPath $platformRoot

# 本机版本管理器端口；不同部署先核对启动参数
$manager = Invoke-RestMethod 'http://127.0.0.1:18913/api/status' -TimeoutSec 8
$manager | Select-Object root, current, latest, busy, readiness, services
```

`codeRoot` 应指向实际的 `comic` 文件夹；`$platformRoot` 才是本指南所称“源码根目录”。健康接口的 `application` 应为 `comic-merged-studio`。若对不上，先找正确进程/端口，不要继续修改猜测中的目录。

## 2 目录与运行服务

| 位置 | 职责 | 修改时的边界 |
| --- | --- | --- |
| `comic/public/` | 主编辑页的原生 JavaScript 模块、HTML、CSS | 这里不是 React/Vite 页面；普通修改由服务器直接提供，通常不需要构建 |
| `comic/server.mjs` | 编辑器 HTTP 服务、工程保存、生成队列及各子 API 装配 | 大型入口文件；优先修改实际负责的子模块，避免继续塞入无关逻辑 |
| `comic/lib/` | 导入、墨库、生成、修图、导出等服务端模块 | 浏览器不能直接执行这里的 Node 文件操作 |
| `comic/python/` | Codex 通道及本地图片处理脚本 | 不同脚本可能使用不同 Python 环境，不能只确认系统 Python 可用 |
| `comic/repair-engine/` | 嵌入的修图编辑器、修图队列、页面与图层操作 | 经主编辑器 `/repair/` 提供；其页面样式与主编辑页分开 |
| `comic/tests/`、`comic/quality/` | 自动化测试、隔离运行器、功能与链路清单 | 历史用例不全代表当前有效产品流程，失败要分类核实 |
| `asset-studio/app/` | 资产工作室，人物/场景/道具生成与结果管理 | 与主编辑页“本话资产”是两个界面，改错一边不会改变另一边 |
| `workbench/server/` | 本机工具入口、项目接口、任务和子引擎管理 | `start-center-local.mjs` 实际启动这里的 `workbench/server/main.mjs` |
| `workbench/app/` | 配套页面、场景引擎等 | 内有 `src` 和 `dist` 的子项目，修改前查看该子项目的构建脚本；不要只改构建产物 |
| `auto-layout/learning-workbench/` | 学习式自动排版服务与页面 | 漫画编辑器经适配接口调用，几何转换和接回规则还在 `comic` 中 |
| `distribution/` | 服务管理、主机发布、升级、就绪检查、签名及本地差异保护 | 修改此处会影响启动/分发；不是普通 UI 文件 |
| `center/`、`协作/` | 仓库中保留的中心及协作能力 | 必须追到当前启动入口再改；不能仅凭目录名判断它就是正在运行的“center” |
| `runtime/`、`.runtime/` | Node、Python、工具、模型等现有运行依赖 | 不随普通源码修改替换，不上传到源码仓库 |
| `runtime-data/` | 生产工程、素材、任务、账号配置、服务日志、更新状态 | 属于运行数据，不是源码；禁止作为代码发布内容 |
| `verification/` 等验证目录 | 临时测试、截图、日志、对照结果 | 放在 D 盘；若含生产图片副本，不上传仓库 |

启动链：`启动工作台.cmd` → 外层 `平台启动配置/控制工作台.ps1` → `start-all.mjs` → `distribution/manager.mjs` → 各服务。

外层启动器不一定存在于纯 Git 源码克隆中。当前安装的常用地址如下；地址是定位线索，不是其他机器必须采用的固定配置。

| 服务 | 当前安装常用端口 | 入口或识别方式 |
| --- | --- | --- |
| 漫画编辑器 | 18909 | `start-comic-local.mjs` → `comic/server.mjs`；`/api/health` |
| 资产工作室 | 8796 | `start-assets-local.mjs` → `asset-studio/app/roles/assets.mjs`；`/api/health` |
| 本机工具入口 | 18911 | `start-center-local.mjs` → `workbench/server/main.mjs`；`/api/v1/center/status` |
| 版本与服务管理 | 18913 | `distribution/manager.mjs`；`/api/status` |
| 自动排版 | 19848 | `distribution/start-layout-local.mjs` → `auto-layout/learning-workbench/integration_server.py` |

管理器中本机工具入口的默认值仍可能是 8790，当前外层启动器传入了 18911。不要只看默认常量。旧 `comic/README.md` 中的 18896/14426，以及历史说明中的 E 盘、18924 等，属于其他时期的入口；当前实例必须重新核对。

## 3 按问题找修改位置

下表的文件均从源码根目录开始。每一行的“先看”是入口；原因仍需由实际调用、请求或复现确认。

### 界面与画布

| 用户反馈或改动目标 | 先看哪里 | 还要检查什么 |
| --- | --- | --- |
| 整体 UI 太大、按钮太高、左右栏太宽 | `comic/public/compact-density.css` | 当前桌面紧凑规则从 1001px 起生效；基础布局在 `comic/public/integrated-workspace.css`；不要用整个 body 的 zoom 缩放画布坐标 |
| 顶部按钮换行、状态文字挤动布局 | `comic/public/team-toolbar.css`、`comic/public/team-toolbar.js` | `comic/public/index.html` 的样式加载顺序、响应断点及 `comic/public/compact-density.css` 的覆盖；连接和版本状态有固定槽位 |
| 主编辑页菜单、侧栏、属性栏开关 | `comic/public/viewport.js` 的 `initWorkbenchChrome`、`comic/public/responsive-workbench.js`、`comic/public/inspector-shortcut.js` | `comic/public/app.js` 的挂载与状态；侧栏折叠后网格列宽是否归零，不能仅凭旧 `comic/public/integrated-workspace.js` 的名称判断当前入口 |
| 悬浮“常用工具”的位置与内容 | `comic/public/floating-canvas-tools.js`、`comic/public/canvas-tool-dock.css`、`comic/public/frame-shortcuts.js` | 拖动边界、窗口变化、工具模式切换，不能只改外观后让指针坐标失准 |
| 修图顶部按钮、处理记录、入口文案 | `comic/public/layout-repair-ui.js`、`comic/public/layout-repair.css` | 顶部修图开关仍保留；2026-10-29 已删除画格旁重复“修图”按钮，不应重新加回 |
| 框选修图弹出的大工作区内按钮/面板 | `comic/public/local-repair-workspace.js`；`comic/repair-engine/public/` | iframe 外壳与内部编辑器是两层；内部主要入口 `comic/repair-engine/public/app.mjs`，样式 `comic/repair-engine/public/styles.css`、`comic/repair-engine/public/integrated.css` |
| 滚动、缩放、平移、画布定位不准 | `comic/public/viewport.js`、`comic/public/canvas-pan.js`、`comic/public/scene-svg.js` | `comic/public/app.js` 的鼠标事件与坐标转换；屏幕坐标、文档坐标和源图像素坐标分开处理 |
| 画格缩放改变原图、轮廓被重置 | `comic/public/frame-resize.js`、`comic/public/panel-proportional-resize.js`、`comic/public/frame-shape-ui.js`、`comic/public/custom-frame-shapes.js` | `comic/public/panel-composition.js`、`comic/public/artwork-transform.js`；选择工具整体缩放与格子工具改裁切轮廓的语义不同 |
| 图层顺序、复制粘贴、合并异常 | `comic/public/layers.js`、`comic/public/canvas-layer-order.js`、`comic/public/image-layer-clipboard.js`、`comic/public/layer-merge.js` | 服务端 `comic/lib/layer-merge-api.mjs`；保留层级、原件和整次操作的撤回能力 |
| 上下间距、画板高度、背景随动错误 | `comic/public/production-screen-spacing.js`、`comic/public/strip-space.js`、`comic/public/gap-background.js` | `comic/public/production-screen-boards.js`；只重排应受影响的内容，保留屏段与画板归属 |
| 封面尾图、话号、单话/共用底图错误 | `comic/public/episode-boards.js`、`comic/public/episode-board-ui.js`、`comic/public/episode-board-canvas.js` | `comic/lib/episode-boards.mjs` 及 `comic/public/episode-board-export.js`；不能只修预览而漏掉导出 |
| 小说原文面板太宽、摘录/定位不对 | `comic/public/novel-source-panel.js`、`comic/public/novel-reader-core.js` | `comic/public/production-display-context.js`、`comic/lib/novel-evidence.mjs`；缺少原著时显示缺失，不编造正文 |

### 工程、文字与制作资料

| 用户反馈或改动目标 | 先看哪里 | 还要检查什么 |
| --- | --- | --- |
| 自动保存失败、“工程已在其他窗口修改” | `comic/public/app.js` 的 `flushSave` / `saveNow`、`comic/public/revision-sync.js`、`comic/public/state-sync.js` | `comic/public/inspector-drafts.js`、`comic/server.mjs` 的保存入口与 `comic/lib/store.mjs`；禁止删除 revision 校验来消除报错 |
| 撤回失效、输入框编辑后不能撤回 | `comic/public/app.js`、`comic/public/layout-history.js`、`comic/public/layout-history-steps.js` | 属性预览事务是否结束，已断开 DOM 的输入框是否还拦截；历史内存还涉及 `comic/public/undo-memory.js` |
| 气泡文字换行、独立文字框、字体错误 | `comic/public/bubble-editor.js`、`comic/public/bubble-text-flow.js`、`comic/public/lettering.js` | `comic/public/bubble-inspector-markup.js`、`comic/public/font-names.js`；移动文字框不应自行改变已确定分行，缩放文字框才按规则重排 |
| 整话统一字体、六类气泡样式 | `comic/public/unified-typography.js`、`comic/public/production-lettering-style.js`、`comic/public/bubble-material.js` | 范围、锁定项、固定素材版本、后续新增文字的继承；`comic/public/compact-settings.css` 只负责设置面板外观 |
| 工程 JSON 无法导入、换电脑图片丢失 | `comic/lib/project-portability.mjs`、`comic/lib/project-snapshot-codec.mjs`、`comic/server.mjs` | 区分原生工程与制作资料包；资源应按固定引用或内嵌原件恢复，不按文件名猜图 |
| 文件夹/墨库制作包扫描、解析、增量导入失败 | `comic/public/production-import-ui.js`、`comic/lib/production-package-api.mjs`、`comic/lib/production-package.mjs` | `comic/lib/prompt-driven-package.mjs`、`comic/lib/production-package-document.mjs`；保留原件、屏段顺序、来源映射和人工修改 |
| XLSX 旧逐格分镜导入问题 | `comic/lib/storyboard-import.mjs`、`comic/lib/storyboard-data.mjs`、`comic/lib/xlsx.mjs` | 旧单表流程与屏段制作包分别处理，不能把每个源格都误建成新的屏段生成单元 |
| 本格提示词保存/恢复、改了却没用于生图 | `comic/public/prompt-source.js`、`comic/public/production-panel-prompts.js`、`comic/public/prompt-source-ui.js` | `comic/public/inspector-ui.js`、`comic/lib/production-package-jobs.mjs`；区分导入原文、本格修改和提示词模式 |
| 裁格位置、台词框错位、裁格后单格提示词错误 | `comic/public/panel-slices-lettering-ui.js`、`comic/public/slice-editor-geometry.js`、`comic/public/production-slice-source.js` | `comic/lib/panel-slices-api.mjs`、`comic/lib/panel-slices-images.mjs`；以源格 ID 和原图像素裁区关联，计划框不是像素裁区 |
| 导出长图、封面尾图拼接、透明层丢失 | `comic/public/complete-strip-export.js`、`comic/lib/strip-export.mjs`、`comic/public/render.js` | 编辑器屏幕预览与导出渲染是不同路径；检查尺寸、透明度、顺序和导出重开 |
| 保存到墨库失败、分类或跨机恢复错误 | `comic/public/project-sync-ui.js`、`comic/public/project-sync-setup.js`、`comic/lib/project-sync.mjs` | `comic/lib/moku-project-library.mjs`、`comic/lib/project-portability.mjs`；显式上传成功与本机自动保存成功是两种状态 |
| “本话版本”提交、历史、版本冲突 | `comic/public/formal-engineering-versions.js`、`comic/lib/formal-engineering-versions.mjs` | `comic/lib/episode-versions.mjs`；明确载入的基准与普通本机副本不可混为一谈 |

### 本话资产与生成

| 用户反馈或改动目标 | 先看哪里 | 还要检查什么 |
| --- | --- | --- |
| 本话资产卡片布局、按钮或详情页 | `comic/public/asset-workspace-ui.js`、`comic/public/asset-workspace.css` | `comic/public/asset-workspace-model.js` 汇总资产与使用位置；卡片容器有 `.asset-gallery-columns`，不要按旧等高网格假设修改 |
| “文生”应点击直接确认 | `comic/public/asset-workspace-ui.js` 的 `adoptGalleryText` 和 `data-gallery-text` | `comic/public/asset-text-description.js`、`comic/lib/asset-workspace-api.mjs` 的 `prepareWorkspaceText`；保持当前话范围、锁定保护、重复点击不重复修改 |
| 文生已采用但仍计缺图、仍强制要参考图 | `comic/public/panel-text-assets.js`、`comic/public/asset-text-references.js`、`comic/public/panel-reference-audit.js`、`comic/public/reference-processing.js` | UI 徽标、缺图批处理、请求输入都要一致；不是把卡片状态文字改成“文生”就完成 |
| 选图后不返回总览、绑定没保存 | `comic/public/asset-workspace-ui.js`、`comic/lib/asset-workspace-api.mjs`、`comic/lib/asset-workspace-binding.mjs` | `flushSave`、工程切换标记、应用范围、`expectedRevision` 和固定墨库版本 |
| 墨库搜索人物、服装、场景不准确 | `comic/public/moku-reference-search.js`、`comic/public/moku-character-groups.js`、`comic/public/asset-requirement-identity.js` | `comic/lib/moku-classified-reader.mjs`、`comic/public/character-state-references.js`；人物服装不能仅以模糊名字自动替换 |
| 参考顺序不对、附图遗漏或串人物 | `comic/public/panel-references.js`、`comic/public/panel-reference-audit.js`、`comic/public/generation-reference-picker.js` | `comic/lib/generation-reference-order.mjs`、`comic/lib/reference-packing.mjs`、`comic/lib/production-reference-files.mjs`；看实际任务输入中的顺序与摘要 |
| 资产生成完成但卡片找不到结果 | `comic/public/reference-generation-results.js`、`comic/public/asset-workspace-ui.js`、`comic/lib/reference-generation-results.mjs` | 任务完成、结果可用、用户采用、绑定回填是不同阶段；先查原任务，不能反复新建生成 |
| 资产工作室的人物整卡/组件、场景结果异常 | `asset-studio/app/roles/studio.mjs`、`asset-studio/app/roles/production-workspace.mjs`、`asset-studio/app/roles/character-component-pipeline.mjs` | `comic/lib/asset-center-api.mjs`、`comic/lib/asset-production-api.mjs` 和实际调用链；场景还可能由 `workbench/app/scene/` 执行 |
| 生成按钮没反应、排队、重复任务、并发问题 | `comic/public/panel-generation-ui.js`、`comic/public/job-cards.js`、`comic/server.mjs` | `comic/lib/generation-slots.mjs`、`comic/lib/concurrency.mjs`、`comic/lib/production-package-jobs.mjs`；先看 POST `/api/jobs` 与任务阶段 |
| 整话分批生图、缺图跳过、停止后续批次 | `comic/public/episode-generation-batches.js`、`comic/lib/episode-generation-batches.mjs` | 范围、任务去重、前序依赖以及停止后是否仍新建任务 |
| Codex 一直连接中或登录/会话失败 | `comic/public/codex-connection-ui.js`、`comic/lib/codex.mjs`、`comic/lib/codex-login.mjs`、`comic/python/codex_worker.py` | 主编辑器与修图引擎分别取状态；账号登录不等于会话可用，连接成功不等于已经成图 |
| 即梦任务提交后没有视频/图片结果 | `comic/lib/jimeng.mjs`、`comic/server.mjs` 的任务恢复入口 | 查看原提交记录与 `jimeng-state.json`，先恢复查询同一任务，不能因等待中就重新提交付费生成 |
| 任务完成但没有自动贴回画格 | `comic/lib/generation-autofill.mjs`、`comic/lib/production-package-jobs.mjs`、`comic/server.mjs` | 目标归属、提示词/参考摘要、尺寸和人工编辑保护；需要作为候选保留的结果不能强行覆盖 |

### 修图、排版与运行故障

| 用户反馈或改动目标 | 先看哪里 | 还要检查什么 |
| --- | --- | --- |
| 高清放大 `bad allocation` 或内存不足 | `comic/lib/upscale-engines.mjs`、`comic/python/local_onnx_upscale.py` | `comic/lib/local-image-tools.mjs`、`comic/public/local-image-messages.js`；分块、显存/系统提交内存、CPU 回退、验证和任务日志 |
| 高清/抠图完成但记录丢失或重复创建图层 | `comic/lib/layout-repair.mjs`、`comic/lib/local-upscale.mjs`、`comic/public/cutout-layer.js` | `comic/public/layout-repair-ui.js`；处理完成结果应能取回，已有高清层继续修改不应嵌套新高清层 |
| 框选人物、保留/排除笔画、去框补底 | `comic/public/local-region-ui.js`、`comic/public/local-region-layers.js`、`comic/lib/local-region-api.mjs` | `comic/python/local_region_tools.py`、`comic/python/local_image_tools.py`；补片透明范围、原图保护、气泡匹配与撤回 |
| 修图返回只有小块、层关系错、冲突或重开错 | `comic/lib/integrated-repair.mjs`、`comic/lib/repair-composition.mjs`、`comic/lib/repair-background.mjs` | `comic/public/local-repair-workspace.js` 与 `comic/repair-engine/`；完整画面、补片、原件和独立文字的边界 |
| 修图任务底栏数量、进度或恢复错误 | `comic/public/repair-taskbar.js`、`comic/lib/repair-background.mjs` | 后台任务与前台窗口生命周期不同；关闭窗口不等于取消任务 |
| 自动排版入口、送入数据或接回几何错误 | `comic/public/auto-layout-ui.js`、`comic/lib/auto-layout-api.mjs` | `comic/lib/layout-canvas-return.mjs`、`comic/lib/screen-reflow.mjs`、`comic/public/assistant-layout-geometry.js` 及排版服务；保留原工程与源图 |
| 主机新版、升级冲突、启动器异常 | `distribution/manager.mjs`、`distribution/updates.mjs`、`distribution/upgrade-readiness.mjs` | `distribution/layout-safe-merge.mjs`、`distribution/layout-update-protection.mjs`、外层启动器；不能绕过任务忙碌或本地差异保护 |

## 4 需要理解的调用链

### 主编辑页与保存

`comic/public/index.html` 加载界面资源，`app.js` 装配工程状态、画布、属性面板及各功能模块。用户操作修改项目或提交专用 API；需要发送新请求时先完成正在编辑的预览事务并 `flushSave()`。服务端校验版本和内容，再通过 Store 保存。

Store 的内存视图含 `projects`、`assets`、`jobs` 等。当前持久化采用分片：数据根目录的 `studio.json` 是索引，`projects/<id>.json` 保存各工程。不能把 `studio.json` 当成包含全部工程正文的旧单文件库，也不能在服务运行期间手工改磁盘 JSON 来代替保存接口。

项目常见结构：`project.pages[]` → `page.panels[]` / `page.bubbles[]`；画格通过 `imageAssetId` 引用资源，制作资料在 `productionPackage` 中保留屏段和来源。图层显示、顺序、父子关系、裁格来源还由专门模型维护。正式修改前读模型函数，不靠截图反推或新造字段。

### 本话资产与文生

`asset-workspace-model.js` 汇总需求、使用位置和状态 → `asset-workspace-ui.js` 展示与操作 → `asset-workspace-api.mjs` 校验工程版本、目标位置、锁定和任务状态 → 写回绑定并保存 → 刷新缺图审计和实际生成输入。

文生将确认的描述写入对应画格的 `referenceTextBindings`，不需要生成一张占位图。当前卡片“文生”直接采用描述并留在总览；点击文字卡片仍可编辑描述。已采用项重复点击不应改写描述或增加版本。混合图片/文字参考必须在实际生成输入中保持一致。

### 生图与结果回填

生成按钮 → 前端确定范围、提示词和参考 → POST `/api/jobs` → 队列与并发槽位 → `codex.mjs` / `jimeng.mjs` → 任务目录中的输入、请求和结果 → 校验来源与当前工程状态 → 自动回填或保留候选。

不要跳过任何一层的身份检查。任务成功但未回填可能是正确保护：用户在生成期间改变了提示词、参考、取景或目标。修复应解释阻断原因并保留结果，而不是无条件赋值 `imageAssetId`。

### 修图与本地模型

主页面修图入口由 `layout-repair-ui.js` 装配；局部修图工作区由 `local-repair-workspace.js` 打开，内层编辑器来自 `comic/repair-engine/`。HTTP `/repair/` 是主服务转交给内嵌引擎的路径，并不对应一个叫 `comic/repair/` 的目录。

画布高清/抠图：`layout-repair.mjs` 保存处理记录 → `local-image-tools.mjs` 管理本机任务 → `upscale-engines.mjs` 或本地 Python 脚本 → 验证输出 → 用户取回或自动应用 → 保留原件与历史。

AI 局部修图：`integrated-repair.mjs` 建立会话与来源快照 → 内嵌修图队列 → `repair-background.mjs` 持续维护后台任务 → `repair-composition.mjs` 核对与合成 → 回到原工程。当前修图载入/回写应按实际画面与独立文字的边界处理，不因历史说明写过“修图联动已删除”就删除当前有效入口。

### 自动排版

`auto-layout-ui.js` → `auto-layout-api.mjs` → 排版服务 → 几何适配与结果接回。已有成图重排由裁区与来源映射约束，不应隐式重新生图；前期计划框也不能直接当作源图片像素裁区。新工程接回、原工程保留和人工确认的规则由具体操作决定。

## 5 必须保持的业务约束

- **原件与来源**：不覆盖用户原图、导入资料原文或已有生产工程。结果可新建资源、独立图层或经明确操作合并，但须保留来源与撤回/取回能力。
- **保存版本**：`expectedRevision`、来源摘要、任务目标与会话归属用于防止旧结果覆盖新修改。不能为了“保存成功”移除检查或强制刷新用户当前未保存的页面。
- **提示词**：导入原文、本格修改、当前提示词模式分别存储；生成必须用用户当前选定的版本。不能自动重写其他格或另一模式。
- **屏段与源格**：制作包默认按已有屏段生成；源格是追溯依据。裁出的独立格按源格提示词与实际出镜资产处理，不能套用整屏附图。
- **人物与素材身份**：区分人物、服装、场景、道具及固定版本；文件名和相似称呼不足以证明是同一素材。已绑定旧参考不能因界面取消某个入口而被清空。
- **图片坐标**：画布缩放、画格几何、图片取景、原图裁区是不同层次；修补、裁格、文字定位应明确使用哪种坐标。
- **结果生命周期**：提交/排队/处理中/完成/可用/已采用不是同一状态。保存任务 ID，超时或断线优先恢复原任务，防止重复收费与重复图层。
- **当前产品流程**：不根据旧测试恢复已关闭的团队帮忙生图、旧独立修图窗口或旧导演流程。当前用户明确要求与实际挂载入口优先于历史描述。
- **数据与环境**：源码、隔离开发副本及验证产物放 D 盘。账号、Token、Cookie、墨库配置、团队接入、模型、字体与生产资料不提交 Git。
- **操作授权**：普通修改与必要的本地验证按用户已授权范围完成；真实付费生成、外部消息、生产资料写入不能伪装成“测试”自动执行。不要给已授权的普通修改额外增加重复确认。

## 6 常见故障的排查顺序

### 画面显示改了但没生效

1. 对照健康接口确认编辑器加载的是刚修改的目录。
2. 在 `index.html` 查看样式链接顺序，在开发者工具查看最终命中的选择器。
3. 区分主页面、修图 iframe 和资产工作室；主页面的 CSS 不会穿透 iframe。
4. 动态插入的样式还可能在 JS 模块内，例如 `novel-source-panel.js`。搜索界面文字和实际 DOM 属性。
5. 用独立浏览器页面验证；用户当前页有未保存内容时不要替他刷新。

当前紧凑 UI 的主要覆盖文件是 `compact-density.css`，排在主页面样式链接末尾；`team-toolbar.css` 负责顶部固定槽位。截图分辨率不同可能进入不同断点，至少检查宽屏与 1366×768 等较窄桌面宽度。

### Codex 一直显示连接中

先分别查看主编辑器 `/api/codex/status`、`/api/integrated-repair/status` 与修图引擎 `/repair/api/codex/status`。主编辑器的强制检查参数是 `?force=1`，修图引擎则是 `?fresh=1`，不要混用。这些是连接检查接口，不是提交生图的入口。

主编辑器继续追 `comic/lib/codex.mjs` 和 `comic/python/codex_worker.py`；修图连接探测则追 `comic/repair-engine/server.mjs` 的 `probeCodex` 与 `comic/repair-engine/python/codex_client.py`。两边有各自的状态缓存，只修其中一边可能无法解决另一边一直等待的问题。

把 `needsLogin` 与临时连接失败分开。`workspace_routing_timeout`、进程关闭或内存不足不等于账号已退出，不能一遇到连接问题就清理凭据或重装。已有生成任务运行时先核实任务，不能直接重启。

### 高清模型内存不足或报错铺满界面

查看对应 `local-tools/<taskId>/upscale.log`、任务状态以及 `local_onnx_upscale.py` 的 tile/provider 记录。当前实现会按可用内存选小分块，检查 Windows 剩余提交内存，固定模型输入尺寸，在小分块长图中定期释放会话；分配失败可缩小分块并有限次退到 CPU。

调整这些参数要同时验证完整长图、边缘尺寸、输出分辨率、透明度和原图摘要。小图通过不代表长图通过。不要静默改模型/倍率，也不要无限重试。友好错误提示在 `local-image-messages.js`，详细原始原因保留在任务日志中。

### 409 冲突或保存后界面回退

先记录请求中的 `expectedRevision` 与服务端当前版本，再看前端是否存在未结算的属性预览、跨窗口修改、工程切换或晚到回调。检查 `flushSave()`、`acceptImportedProject()`、`comic/public/revision-sync.js`、`comic/public/project-revision-merge.js` 与对应 API 的 guard。不要手改磁盘 revision，也不要删除冲突检查。

2026-10-29 修复“后台出图时编辑提示词导致整页无法保存”：`app.js` 的 `applyServerRevision()` 在冲突前，使用最后确认的 `serverBase`、当前草稿和后台工程做三方合并。图片回填、其他字段更新可与本窗口文字一起保留；同一字段、耦合的取景/尺寸/几何及删除与编辑冲突仍拦截。后台回填未增加 revision 时也必须比较内容。合并同步更新撤销/重做与属性草稿快照，保留当前输入焦点；正在拖拽时延后处理，不从旧快照丢失结果。真实冲突通过顶部“处理保存冲突”重试合并，或明确另存“本窗口保留副本”继续工作；原工程保留。旧版已经打开的窗口需先导出草稿，再刷新载入新代码，不可强制刷新。测试入口：`comic/tests/project-revision-merge.test.mjs`、`comic/tests/browser-generation-save-merge.test.mjs`。

### 生图完成却未应用

沿原 job ID 查询任务和保存的输入；核对当前 panel ID、来源签名、参考内容、人工编辑与生成阶段。结果已落盘时保留并允许用户采用。对即梦恢复应读取原提交状态，不能把“没有收到返回”解释为“没有发起任务”。

### 一键单格后提示词空白、参考要求重选、原文不高亮

2026-10-29：先按 `productionGrid/panelSlice.segmentId + panelId` 找 `panelRecords`，不要用图片顺序或整屏提示词替代单格原文。

- **提示词空白**：检查 `production-slice-source.js → hydrateProductionSlices()` 和 `production-panel-prompts.js`。已存在的重排单格不会再次调用创建逻辑，可能已有完整源提示词却漏了 `generation.promptSource`，导致无泡原文被当成空泡读取。只初始化缺失模式；保留明确的模式选择、各模式手改和主动清空。`generationPromptSelection()` 是显示/提交的共同入口。
- **重复匹配**：在 `inheritedSliceReferenceBinding()` 核对父屏槽位、主体、服装、`used_by`、人工确认、revisionId 和 sha256。同一源需求可继承人物、场景、道具的固定版本；“具体款式待绑定”是准备状态而非服装名称（`character-preparation.js`）。`reference-requirements.js` 必须保留人物数组中“百户、缇骑”这类已登记群像，不能拼接再拆成两个人。单格自己换图、文字替代、移除、明确衣装变化和版本不一致仍优先，不做全局别名。
- **原文高亮**：`production-display-context.js → sourceLocations()/isSourceParagraph()` 解析原著位置/原文位置中的章节和行号，兼容 `第101—101行`、多行区间及旧“行101/非空段”格式。`novel-source-panel.js` 按所选格定位和高亮；只有章节或摘录不符时不能猜测。

恢复入口是正常的工程规范化/启动迁移，会备份旧工程。不要手改生产 JSON，也不要删除图片或重建排版。回归入口：`comic/tests/single-panel-links.test.mjs`、`slice-reference-inheritance.test.mjs`、`production-panel-generation.test.mjs`、`production-screen-boards.test.mjs`。

### 裁格提示词仍有屏段尺寸、阅读顺序和父屏坐标

2026-10-29：先检查源 `panelRecords.original/production.单格提示词` 的内容，不能仅凭字段叫“单格”或“画格数量：1”就判定正确。第041话的源单格稿自身含屏段编译模板，保留了整屏规格和跨格核对；这与选错 `promptSource` 是两个问题。

`generationPromptSelection() → single-panel-prompt-scope.js` 针对此已识别模板，校验独立单格编号、唯一画面块及参考使用格号，然后按源格ID提取本格画面、画风、前情与文字要求。执行尺寸取当前画格 bounds，移除父屏坐标、整屏阅读顺序与其他格的执行要求。正常单格原文、整屏生成和各模式人工修改保持原样；不能据邻格推测缺失画面。匹配不唯一时返回 scopeError 并由 `panelProductionShot()` 拦截，界面提示核对来源。

此过程只派生显示和提交文本，不改写导入原件、来源摘要、图层、绑定或用户修改。任务 `shot.promptScope.sourcePrompt` 保留适配前原文供追溯；界面标注“已按本格提取”。修改范围必须覆盖前端与服务端，更新后安全重启加载服务端模块，不能只刷新浏览器。回归：`comic/tests/single-panel-prompt-scope.test.mjs`，包含旧裁格、模式独立、保存重开、切换单位、异常来源拦截，以及假通道中 Codex/即梦最终提示词检查；不调用真实生图。

### 按文字适配气泡却重新排字

2026-10-29：按钮走 `app.js → fitBubbleToTextFrame()`（`lettering.js`），以已有文字框为基准调整气泡外框；冻结文字排版，保持页面上的文字位置、文字框宽高、字号和换行。局部 textBox 坐标会随外框原点变化，验收需比较页面坐标。双圆气泡分别保留两段的独立文字框。不要在此按钮中删除 textBox/textLayout 或调用按字数重新排版的 `fitDialogueBubble()`；后者仍用于新建默认气泡。操作须进入原有撤销和保存流程。

尾巴须随外框一起调整，不能把尾尖固定在旧画板坐标。适配保留尾根位置参数、宽度和尾根至尾尖的方向；长度随外框较小缩放比例调整，最长为 `max(1.5 × 字号, 0.35 × 外框短边)`（且不超过短边两倍，保证极小文字框也可保存），使旧版已经拉长的尾巴也可在再次点击时收回。尾尖保存为 normalized 坐标，后续移动或缩放均跟随气泡；直接拖尾尖仍可自行调整长度。不要加载工程时批量修改已有气泡。上述 `single-panel-links.test.mjs` 覆盖多种轮廓、四个方向、新旧尾尖坐标、重复适配、拖动、竖排、双段、保存重开与撤销。

### 重启时团队版本服务因代码冲突退出

`distribution/publisher.mjs → startup-publication.mjs` 在已有已发布版本、且启动发布明确返回“主版本本机修改与同事已发布代码冲突”时，保留原版本并继续启动团队服务，错误仍显示为待合并。不能重置发布基线、覆盖同事代码或强推。首次启动没有可用版本、语法错误和其他异常仍向启动器报告。回归：`distribution/tests/startup-publication.test.mjs`；验收还应核对旧版本 contentId/归档不变及团队服务健康状态。

## 7 日志与数据定位

以下以实际 `dataRoot` 为准，通常是 `runtime-data/comic/`。只读取排查所需的记录，不把账号配置、完整提示词资料或生产图作为公开日志附件。

| 位置 | 用途 |
| --- | --- |
| `runtime-data/logs/` | 管理器及各服务的启动、运行、恢复日志；外层启动器日志也在这里 |
| `runtime-data/comic/studio.json` | 索引、资源和任务等；工程正文另分片存放 |
| `runtime-data/comic/projects/` | 各工程 JSON；运行中通过接口更新，不能直接编辑 |
| `runtime-data/comic/jobs/<jobId>/` | 常规生图输入、请求、阶段及结果；Codex 通道写 `input.json`、`request.txt`，即梦还保留恢复状态 |
| `runtime-data/comic/local-tools/<taskId>/` | 本地高清、抠图、补底任务及输入输出；高清日志为 `upscale.log` |
| `runtime-data/comic/repair/` | 同页修图会话、任务与资源；其中 `layout-records/` 保存画布图像处理记录 |
| `runtime-data/distribution/` | 安装版本、更新包、源码备份和本地差异保护状态；不是随意清理的缓存 |

实际图片可能位于注册的其他目录，应由资源记录和 `store.assetPath()` 找到；不要仅按某个固定文件夹扫描结果判断图片丢失。

## 8 修改后如何验证

先阅读 [测试合集说明](comic/quality/README.md)，对照 [功能与链路清单](comic/quality/功能与链路清单.md)。这些清单的关联是文件级线索，不等于功能已逐项验收。

验证选择：

| 改动 | 首选相关测试或检查 |
| --- | --- |
| 顶栏与紧凑布局 | `comic/quality/cases/toolbar-layout.test.mjs`，并检查宽窄窗口、折叠侧栏、修图打开、资产总览；比较画布可用面积与漫画缩放值 |
| 文生一键采用、缺图与参考输入 | `comic/tests/asset-text-references.test.mjs`；检查不打开详情、刷新保留、再次点击不改描述、锁定/范围和实际生成输入 |
| 高清内存与回退 | `comic/tests/upscale-memory.test.mjs`、`upscale-validity-history.test.mjs`、`upscale-child-layer.test.mjs`；需另做已授权的完整本地模型图像验证 |
| 修图取回、合并与历史 | `comic/tests/layout-repair.test.mjs`、`local-repair-restored.test.mjs`、`repair-composition.test.mjs`、`comic/quality/cases/repair-integrated.test.mjs` |
| 保存版本与撤回 | `comic/tests/save-preview-revision-regression.test.mjs`、`prompt-edit-history-regression.test.mjs`、`browser-multi-window.test.mjs` |
| 制作包与裁格 | `comic/tests/production-package.test.mjs`、`panel-slices.test.mjs`、`production-lettering-edit.test.mjs` |
| 工程跨机与墨库 | `comic/tests/project-portability.test.mjs`、`project-sync.test.mjs`、`comic/quality/cases/moku-real-contract.test.mjs`；后者需要隔离墨库测试源码及依赖 |
| 导出 | `comic/tests/complete-strip-export.test.mjs`、`render-segments.test.mjs`，并实际解码或重新导入验证产物 |

推荐使用隔离运行器。下面只列出测试计划，不执行生成或生产写入：

```powershell
# $platformRoot 已由健康接口确认；命令在 comic 目录执行
Set-Location -LiteralPath (Join-Path $platformRoot 'comic')
$nodeExe = Join-Path $platformRoot 'runtime/node/node.exe'
& $nodeExe quality/run.mjs --suite small --list
& $nodeExe quality/run.mjs --suite large --filter asset-text-references --list
& $nodeExe quality/run.mjs --suite large --filter upscale-memory --list
```

纯源码仓库没有自带 runtime 时，使用已准备的 Node 24+ 路径；应用 `package.json` 的最低版本与质量运行器要求不同。缺少 Playwright、Canvas、Python 或测试墨库时，按测试说明配置独立依赖，不在生产运行环境中随意安装或升级。

审查计划和依赖后，执行相应套件：

```powershell
# 小改动的核心检查；输出目录必须是尚不存在的新目录
$checkRoot = Join-Path $platformRoot ('verification/quality-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
& $nodeExe quality/run.mjs --suite small --output $checkRoot

# 只运行特定回归时，可用 large 的文件发现加 filter
# & $nodeExe quality/run.mjs --suite large --filter upscale-memory
```

筛选运行只能报告该筛选范围。大改动按 `quality:large` 验证并检查整份报告；不把失败、跳过、超时、零用例、blocked 或 flaky 写成“全部通过”。已知依赖旧功能的历史测试不能作为重新启用旧功能的理由。

界面改动用独立浏览器上下文与合成工程验证，禁止接入真实生成通道。图片处理分别验收：任务终态、文件存在且可解码、原生像素尺寸、透明度、原件保留、画面视觉效果。HTTP 200 或模型 ready 只代表各自那一步。

新增/调整功能时更新 `comic/quality/catalog.mjs` 的对应登记，再运行 `quality/catalog-report.mjs` 生成清单；不要用新增的“读取代码里有某个字符串”测试冒充真实行为验证。

## 9 让修改生效与安全回退

| 修改类型 | 通常如何加载 | 必须确认 |
| --- | --- | --- |
| `comic/public/` JS、CSS、HTML | 用户保存后刷新页面；先用独立页面验证 | 读取的确实是新文件，缓存和 iframe 也各自更新 |
| `comic/lib/`、`comic/server.mjs`、管理器启动逻辑 | 需要在任务空闲时安全重启对应受管理服务 | codeRoot、任务状态、管理器 readiness 与启动结果 |
| 被任务调用的 Python 脚本 | 新子进程通常会读新脚本；JS 调度器一起修改时仍须重启 | 已运行任务不会因为改文件而自动切换实现 |
| 含 `src`/`dist` 的配套子项目 | 按该子项目的 package.json 构建 | 服务实际提供的构建目录与源码一致 |

本机已有外层启动器时，优先使用 `重启工作台.cmd` 或外层 `平台启动配置/控制工作台.ps1 -Mode Restart -NoBrowser`。该脚本核对服务身份、忙碌状态与 readiness，再调用管理器安全停止入口，最后后台启动并等待就绪。不要直接复制其他安装的路径。

管理器 `busy=false` **不足以证明可以重启**，还必须有 `readiness.allowed=true`，并检查阻断原因和正在进行的任务。不能使用 `taskkill /F`、强杀 Node/Python 或抢占另一副本的端口。阻断存在时继续完成不依赖重启的工作，报告具体阻断。

回退也遵循相同空闲检查：只恢复这次改动的源码文件，保留用户后来产生的修改。数据格式变化须有备份和迁移/恢复方案；不能拿旧整个目录覆盖现有 `runtime-data`。文档或静态界面修改本身不要求重启全部工具。

## 10 源码同步与主机发布

用户已要求后续经过确认和验证的工作台代码同步到 [manga-production-workbench 的 dev 分支](https://github.com/shiqiandiandianda/manga-production-workbench/tree/dev)。这一要求不包含上传工程、生产图片或账号。

当前安装目录可能不是 Git 仓库。需要时使用 D 盘独立 Git 检出：先 fetch，核对分支与差异；将本次审查过的源码逐项同步；检查 diff、相关测试，再正常提交和 push。发现远端新改动先合并，禁止 force push 或整目录复制覆盖。

主机自动发布频道、同事自动升级和 Git `dev` 是不同机制。当前主机的源码变化可能被发布器自动发现；隔离测试应避免启动生产发布器，不擅自暂停更新，也不把 Git push 成功当作所有同事端已经升级。

提交前至少确认：文件清单只含预期源码/文档/合成测试；没有运行数据、模型、字体、私有服务配置或凭据；最终提交与远端 dev 一致。自动发布版本号会变，不能把本文日期或某次 V 编号当成唯一版本依据。

## 11 本轮改动的接手线索

2026-10-29 这组功能改动已做本地验证并同步源码。以下用于理解现有实现，不表示整个工具的所有功能都已验收：

- `compact-density.css` 与 `index.html`：统一收紧桌面 UI，保留漫画缩放与几何；已检查 1771×881 和 1366×768 下的编辑页/资产页。
- `asset-workspace-ui.js`：资产卡片“文生”经 `adoptGalleryText` 直接采用当前话描述，仍保留从卡片进入编辑描述的入口；相关回归在 `asset-text-references.test.mjs`。
- `layout-repair-ui.js`：去掉画格旁重复悬浮“修图”按钮，保留顶部修图入口。
- `upscale-engines.mjs`、`local_onnx_upscale.py`、`local-image-messages.js`、`local-image-tools.mjs`：小分块、有限重试、CPU 回退、长图内存释放和可读错误；一次完整原图副本验证产出 2018×3118，原件摘要未改变。这是该模型和该输入的证据，不是任意大图的性能保证。

这组改动的源码提交是 `ff39d81` 和 `be8de2d`；后续接手要先读取最新 dev，不要用这两个提交覆盖之后的新功能。

## 12 可直接交给新 AI 的开工提示

```text
请先阅读源码根目录的《AI修改维护指南.md》、AGENTS.md 和 comic/AGENTS.md。

本次需求：在此填写具体现象、期望行为与截图。

先用当前运行编辑器的 /api/health 确认 codeRoot 和 dataRoot，再按指南定位负责模块。
告诉我你定位到的入口、根因和将修改的文件，然后完成已授权的修改，不要只给方案。
如我明确要求只分析，则保持只读。

保留生产工程、原图、导入原文、账号、配置、参考身份和任务记录。
不要绕过 revision、来源摘要、锁定、重复任务或晚到结果保护。
使用 D 盘隔离数据和假生成通道测试；不要擅自提交真实付费生成。
不要刷新我尚未保存的页面；确需重启时先检查管理器 readiness 并使用安全停止机制。

交付修改文件、行为变化、实际运行的检查、未通过或未验收项、加载方式。
经过审查验证的源码同步到约定的 GitHub dev，不能把生产数据和凭据一并上传。
如果改了模块职责或入口，同时更新这份指南相应行。
```

## 13 继续深入阅读

- [根目录说明](README.md)：部署边界、工程跨机与入口说明。
- [编辑器约束](comic/AGENTS.md)：历次用户要求；注意后续修正和适用版本。
- [功能与链路清单](comic/quality/功能与链路清单.md)：更广的模块与关联测试索引。
- [测试合集说明](comic/quality/README.md)：隔离机制、依赖、命令、结果定义及已知限制。
- [墨库对接与版本说明](comic/quality/墨库对接与版本说明.md)：素材固定版本、上传和工程版本规则。

维护本文时，先检查引用路径确实存在，并沿当前实际挂载点确认。新增功能补“用户现象、入口、数据/API、保护条件、验证方式”；移除功能明确标记旧入口，避免下一位 AI 根据历史说明恢复它。

## 14 人物站位图（2026-10-31）

“本话资产”新增独立“站位图”分类和带“人物站位图”名称的卡片，普通场景卡可点“生成站位图”。`comic/public/scene-blocking.js` 按实际采用的场景参考图固定指纹（SHA256，回退固定版本或本地资产ID）分组：同一张图始终共用一张站位图，跨屏段、换名称、再次回到原图均复用；只有更换参考图才另建。未选图前不创建可选站位卡，不能由原始记录条数或场景名称预估卡片数。保留导入的 `blockingPlans`、原提示词和既有绑定，不改写小说或分镜来源。没有站位方案时，在选定场景参考图后，以首次使用该图的分镜描述建立可选站位需求。

生成入口仍为 `/api/project-center/reference-generation/preview` 和提交接口。`comic/lib/scene-blocking-generation.mjs` 使用本场景已经采用的人物对应服装、场景及道具实图；缺少图片时预览列明缺项，提交拒绝缺失参考。固定模板在 `comic/lib/scene-blocking-prompt.mjs`：正上方俯视，每个人物头部上方标中文姓名，二维单幅16:9。同一张场景参考图只生成一张，不默认追加反打。`sceneFrontPrompt` 对站位图走专用分支，普通场景继续采用原有无人场景规则。资产工作室的站位请求可保留最多60张有序资产引用，实际提供器继续使用既有参考合图机制处理模型上限。

站位身份由作品工程和已选场景参考图固定指纹确定；生成记录及接回资产保存 `purpose=blocking` 和 `blockingId`，普通场景与站位图分别处理，不同场景图的站位结果不能混用；重新选回原图时复用原图对应的站位结果。采用沿用范围、版本、锁定和任务保护，原图保留，删除与恢复使用既有入口。后续漫画只继承空间关系，站位图上的姓名标签不绘入正式漫画。

验证见 `comic/tests/scene-blocking.test.mjs` 和 `scene-blocking-workflow.test.mjs`，使用D盘合成工程、独立通道、假图像提供器及浏览器检查。姓名属于生图提示词要求，本轮没有新增独立姓名文字层，也没有提交真实AI生图验证绘字质量。


## 15 站位图参考可视化与选图响应（2026-10-31）

生成站位图的场景图直接沿用本话已选的场景图，不再要求重复选择。`comic/public/scene-blocking-references.js` 是前端展示与后端实际提交共用的附图解析器；`scene-blocking-reference-view.js` 显示场景、人物服装和道具缩略图，缺图逐项提示。人物与道具更换使用 `settings.blockingReferenceOverrides` 保存固定资产ID、版本与SHA256；只影响该张站位图。更换场景图会通过原场景绑定更新本话使用位置，再定位新场景图对应的站位卡，不能把新图套进旧站位身份。普通场景候选不再默认混入站位图候选。

列表点图使用 `POST /api/projects/:id/asset-workspace/pick` 一次导入并采用，不再通过浏览器导入后重复保存工程。后台导入后再次核对账号、工程版本及锁定，再保存绑定；标签独立异步保存。前端立即显示待采用缩略图和处理中状态，同一张防连点，其他候选可串行排队；成功后才标记已采用，失败保留候选。绑定批次共用一次参考审计上下文，普通场景更换会失效场景分组缓存。原图、来源与任务保护保留。

项目中心同步前读取当前项目的文件目录，移除失效上传缓存；已移到归档的共用图只有归档归属正确时才直接引用，否则校验恢复原字节后归档到目标项目，避免快照引用其他项目文件而报“记录不存在或不属于此项目”。不得关闭原有归属校验或修改真实源工程来绕过错误。

验证入口：`asset-pick-responsive.test.mjs`、`scene-blocking.test.mjs`、`scene-blocking-workflow.test.mjs`、`project-center-sync.test.mjs`；测试使用D盘合成工程和假图像提供器。

## 16 资产规范名称精确检索（2026-10-31）

本话资产列表筛选、候选弹窗、本地固定版本缓存、墨库搜索和一键匹配统一使用 `comic/public/asset-exact-search.js`。按规范主体、场景身份和 `主体__变体` 完整比较；只兼容空格、常用分隔符、大小写及明确作品名前缀，不做包含、相似字、简称、标签或别名兜底。人物需求默认核对当前服装；手动输入另一完整名称或明确变体可查找其他参考。空搜索不下载全库展示候选；列表空筛选仍显示全部需求。

普通场景与站位图分别筛选。站位候选的完整场景名须一致；本地带有 `blockingId` 的记录还须对应当前场景参考图，不能把书房、演武场混入烟柳巷。已有用图和生成历史不清空。同名同服装多版本保留人工选择，一键匹配仍受作品范围、检索完整性、唯一固定版本、锁定及运行中任务保护。

墨库旧文件名与规范名称分隔符可能不同，因此仍读取有上限并缓存的目录页，最终只展示精确身份结果；不能重新接入模糊候选兜底。勾选其他分类仅放开分类，不放开完整名称。验证见 `asset-exact-search.test.mjs`、`moku-batch-search.test.mjs`、`asset-workspace-regression-20261027.test.mjs` 及既有固定引用、缓存与站位流程测试。

## 17 格子人物与场景参考图浮窗（2026-10-31）

选中单个画格后，在画格左侧快捷工具条“生成本格图片”下方提供“参考图”。`comic/public/panel-reference-preview.js` 挂载非模态浮窗，人物/场景两类切换，下拉选择本格多张图片；场景页默认显示普通场景原图，站位图保留在列表中另选。图片加载原件，支持滚轮、加减、100%和适应窗口缩放，拖动图片平移；拖动标题移动窗口，右下角调整窗口大小，位置和尺寸只保存在本浏览器 localStorage。预览交互不改变画板缩放和图层坐标。

`panel-reference-preview-model.js` 读取本格参考审计的已采用ID，人物保持对应服装与固定版本；整屏使用来源绑定，不能拿旧的 frame.referenceIds 或未采用推荐图代替。普通画格及独立单格保留其明确的实际引用。只展示人物和场景，站位图按场景身份展示；文生、跳过或已移除参考不展示成已采用图片。切换格子后跟随新格，空格清空旧图；图片异步回调核对当前选择，防止慢图覆盖新格。

组件不调用采用、上传、保存、生成接口，不写工程JSON或历史。`app.js` 仅接入快捷按钮与 renderCanvas 同步，CSS由原编辑器入口加载，不新增独立工作台。测试入口 `panel-reference-preview.test.mjs`、`panel-reference-preview-browser.test.mjs`，并复查原图层快捷排序、单格取消和固定引用流程；真实工程界面验收须拦截写请求，不能自动刷新用户正在编辑的窗口。
