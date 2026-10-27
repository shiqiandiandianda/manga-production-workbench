# 工具说明

## 生产工具

| 文件 | 用途 | 运行 |
|---|---|---|
| `build-registry.py` | 从 V005 总表重建 `asset-registry.json` 和 `asset-validation.json` | `python tools/build-registry.py` |
| `compose-standard-card.py` | 角色卡 3840×1890 拼版 | 见 `--help` |
| `split-three-view.py` | 三视图单图自动裁成正面/3/4/背面 | `python tools/split-three-view.py --sheet x.png --outdir out/` |

Python 依赖：`openpyxl`、`Pillow`、`numpy`，使用项目内置 Python。

## 资产台账

- 页面：`http://127.0.0.1:8790/tools` 内的资产台账
- API：`/api/registry`、`/api/registry/validation`
- 数据：`data/asset-registry.json`、`data/asset-validation.json`
- 待办请求：`/api/requests`，自动带身份/服装/手部参考 ID
- 参考图代理：`/api/editor-image?id=<editorAssetId>`
- 缩略图：`/api/asset-thumb?assetId=<assetId>`

## 墨库上传

- 上传的 `name` 必须带 `.png` / `.jpg` / `.webp` 后缀，墨库按后缀生成预览
- 缺后缀会出现 `previewStatus: unavailable`，卡片只显示文件名占位
- `POST /api/moku-reupload` 可给已有资产补传新 revision
- 补传后要检查 `previewStatus` 是否为 `ready`

## 拼版

- 主页面下方“拼版”板：六主槽 + 三附加槽
- 保存：`POST /api/compose-save`（角色卡）、`POST /api/prop-save`（道具卡）
