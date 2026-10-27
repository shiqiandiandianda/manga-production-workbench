@echo off
rem Copy to config.local.bat; do not put credentials in the published package.
set "COMIC_PORT=18896"
set "IMAGE_REPAIR_PORT=14426"
set "COMIC_MAX_CONCURRENT=6"
set "COMIC_MAIN_MAX_CONCURRENT=6"
set "COMIC_REPAIR_MAX_CONCURRENT=2"
rem 默认共享总并发 6；主平台平时用满 6，补图有需求时优先让出最多 2 个名额。
rem 可在两个平台的“并发分配”界面输入并保存；保存值优先于启动配置。总额度 1–20，补图额度 0–总额度，0 暂停新的补图任务。
rem 渠道并发仍受原有上限限制；Codex 单渠道最多 8。
rem Codex 参考图处理：view=先逐张查看参考再生图（默认）；direct=跳过查看、直接把参考路径交给生图，减少生图前等待。
rem 建议先用几个镜头对比画面质量，再决定是否改为 direct。
rem set "COMIC_CODEX_REFERENCE_MODE=direct"
rem 气泡位置：默认排进画面（贴近说话人）；如果生图压字效果不好，可改为排在画格外：
rem set "COMIC_LETTERING_PLACEMENT=outside"
rem Codex 调度推理档位（默认 low）；当前模型不支持所填档位时会直接报错。
rem set "COMIC_CODEX_GENERATION_EFFORT=low"
rem 漫画素材库在其他位置时，指向“漫画素材”文件夹本身。
rem set "COMIC_STYLE_LIBRARY_DIR=E:\素材库\漫画素材"
rem set "COMIC_NODE=C:\Program Files\nodejs\node.exe"
rem set "COMIC_PYTHON_BASE=C:\Python312\python.exe"
rem set "COMIC_NPM=C:\Program Files\nodejs\npm.cmd"
rem set "COMIC_PYTHON_BIN=C:\your-release\.venv\Scripts\python.exe"
rem set "COMIC_CANVAS_MODULE=C:\your-release\dependencies\node_modules\@napi-rs\canvas"
rem set "COMIC_CODEX_BIN=C:\path\to\codex.exe"
rem set "COMIC_JIMENG_BIN=C:\path\to\dreamina-canvas.exe"
rem set "COMIC_MERGED_DATA_ROOT=C:\new-isolated-data"
