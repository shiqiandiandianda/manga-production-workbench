# AI导演计划导入契约

本工作台只负责导入已有分镜、接收AI导演计划、编译显示、调用图片资产、生图及人工返修。不拆小说，不运行本地规则自动选版式；没有合格计划就保持待排版。

## 分镜输入

- 支持XLSX、CSV、TSV、JSON、TXT。XLSX一次导入所有含画面内容的工作表。
- 话号取自“话/话数/episode”列或“第11话”这样的工作表名称。找不到话号时，必须明确填写，不默认改成第1话。
- 原画面、台词、人物状态和所有原始列保存在工程中；不要求事先规范景别或机位别名。

## Skill输出

主入口为“导入分镜与排版”：选择分镜表，同时多选Skill生成的每话JSON，点击“导入并排版”直接进入画布。无需打开AI设计页面，也不经过检查或试排页面。Skill返回单话JSON即可：

```json
{
  "episode": 11,
  "spreads": [
    {
      "spread": "est-panorama",
      "units": ["E011-001", "E011-002"],
      "pace": "normal",
      "mirror": false,
      "slots": [{}, {"emotion": "calm", "view": "eye"}],
      "why": "定场后接人物反应"
    }
  ]
}
```

上面仅为结构示例，不是任意两格都适用的计划。

- `episode`可省略，批量导入会从`E011-001`等格ID识别话号；填写时必须与格ID话号一致。不按文件选择顺序匹配；没有明确话号时才参考文件名。
- `spreads`使用实际组件ID，当前内置32种组件（组件库v1.1.0）；禁止编造组件ID和画格ID。
- `units`按原阅读顺序覆盖本话每格恰好一次；“格ID”列优先，否则按实际话号与格号形成`E011-001`这样的ID。非数字格号使用本话行序号，最终以工具导出的目录为准。
- `pace`为`tight/normal/breath/pause/memory/scene`。`slots`与组件槽位对应，可填`emotion/view/composition/tension/breakout/note`。
- 导演不输出坐标，不改原画面和原台词。角色、天气、服装、道具、来源信息不得由计划替换。
- 支持上传`.json`、粘贴JSON和Markdown的JSON围栏。兼容工具导出的`comic-design-plan-v2`完整计划。

### 半格并排

使用`half-pair`，每组恰好两个格ID。两格同排、从左到右阅读；没有第三个主格槽位，不要求后接主格，可连续使用，不计入每话2组的受限并排额度。`pace`控制每行前的留白，`mirror`沿用现有计划格式。

```json
{
  "episode": 11,
  "spreads": [
    {"spread": "half-pair", "units": ["E011-001", "E011-002"], "pace": "normal"},
    {"spread": "half-pair", "units": ["E011-003", "E011-004"], "pace": "tight"}
  ]
}
```

上面示例对应一话4格；实际计划仍须完整覆盖本话。旧`act-quick-pair`不变：2个并排小格加1个结果主格，内置AI质量规则仍限制它每话2组。直接导入JSON仍不执行审美闸门。半格并排不强制生成任何额外主格，也不增删原分镜。

## 接收流程

### 分镜表与多话JSON一起导入

- 在同一个窗口选择一份分镜表和多份每话JSON，点击“导入并排版”。不调用Codex，不执行AI设计生成，不自动生图。
- 分镜表支持一次100话、总计8000格；旧小说/生产表流程仍维持原有范围限制。每批最多100份JSON、合计16MB，单份不超过1.5MB。
- 每话独立编译并应用：缺少JSON的话保持待排版，坏JSON、话号冲突、重复话号或未知组件只影响对应文件，不回退规则排版，不阻断其他有效话。
- “更新当前工程”按话号和格ID合并分镜，保留已有图片、取景、独立生产提示词、参考图、人工图层以及受手调字段保护的几何/对白/样式；未涉及的话保持原样。也可只选JSON向当前工程补导，编辑器撤销按钮可撤回本批更新。
- JSON仅参与排版，不执行完整设计计划里的operations或assetRequests。原始分镜表和成功应用的JSON原件另存到工作台数据目录，原文件不改。
- 一步接口仍为`POST /api/projects/storyboard-import`，分镜表字段不变，新增`layoutFiles: [{name, text}]`。更新已有工程时增加`projectId`及`expectedRevision`；仅补导JSON时可不传分镜文件。
- 返回工程及`importReport`：包含各文件话号、应用/失败状态、原因、成功数量及待排版话号。工程内`layoutImports`保留最近结果和每话已采用计划。

### 单话设计面板（可选）

“导入并应用”直接将JSON计划写入可编辑画格、气泡与效果，可整体撤销。导入不执行排版审美闸门，不限制主副格比例、主格数量和相邻关系、画中画数量、并排小格数量、破窗数量或换场分组，也不自动收窄组件。只保留JSON解析、组件槽位和格子引用、完整来源覆盖、工程版本及安全编辑等运行必需检查。已有图片、手改提示词和原始分镜保留，不退回本地规则试排。

接口仍分为导入和采用两步，页面的单次“导入并应用”操作依次完成两步。导入的标准化计划持久保存`layoutPlan.designRules: "disabled"`，重新打开、导出及再次采用均不会恢复审美拦截；内置AI生成通道仍保留其生成质量检查。

新增分镜入口：`POST /api/projects/storyboard-import`。

导入计划：`POST /api/projects/:id/design-plans/import`，请求包含`expectedRevision`、`aiOnly: true`、`episode`与`plan`。

候选采用：`POST /api/projects/:id/design-plans/:planId/apply`，请求包含`expectedRevision`。

本次接入不安装或声称已经加载仍在制作中的Skill。工具接受其JSON输出；内置Codex文字通道使用同一组件计划契约。
