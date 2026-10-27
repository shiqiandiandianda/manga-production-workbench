"""工作台引导脚本：在导入角色工房服务之前改写数据目录与运行时路径。

由“资产生成工作台”的 Node 服务在启动角色引擎时调用，不要手动执行。
作用只有一个：让角色工房沿用原始源码，但把 data 目录放到工作台统一的数据目录下。
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE_DIR))

DATA = Path(os.environ.get('WORKBENCH_DATA_DIR') or (ENGINE_DIR / 'data'))
DATA.mkdir(parents=True, exist_ok=True)
for sub in ('assets', 'generated', 'cache', 'cache/thumbnails', 'temp', 'temp/exports', 'archives'):
    (DATA / sub).mkdir(parents=True, exist_ok=True)

import server  # noqa: E402
import worker  # noqa: E402

server.ROOT = ENGINE_DIR
worker.ROOT = ENGINE_DIR
worker.DATA = DATA

# 上游 Workbench 把数据目录写死成 <源码目录>/data。
# 这里包一层构造器，让服务实例改用工作台统一的数据目录，其余逻辑完全不变。
_OriginalWorkbench = server.Workbench


class Workbench(_OriginalWorkbench):  # noqa: N801 - 沿用上游类名，原地替换
    def __init__(self, *args, **kwargs):
        if not args and 'root' not in kwargs:
            kwargs['root'] = ENGINE_DIR
        super().__init__(*args, **kwargs)
        # 上游 __init__ 里会把 self.state_path 重置成 <引擎目录>/data/state.json，
        # 并在那里落一份初始状态。所以初始化之后必须再改回来，并补写目标目录的那一份：
        # 不补的话，新数据目录永远缺 state.json，而它的保存逻辑是"读-改-写"，
        # 之后每个请求都会 500（这次就踩到了这个坑）。
        self.data = DATA
        self.state_path = DATA / 'state.json'
        if not self.state_path.exists():
            self.save()
            print(f'[hub] 已在 {self.state_path} 建立初始状态文件', flush=True)
        # 上游初始化时会在引擎目录下留一份没用的 state.json，清掉保持源码目录干净
        stray = ENGINE_DIR / 'data' / 'state.json'
        if stray.exists():
            try:
                stray.unlink()
            except OSError:
                pass


server.Workbench = Workbench

runtime_root = ENGINE_DIR.parent.parent / 'runtime'
if runtime_root.is_dir():
    worker.RUNTIME_ROOT = runtime_root
    codex = runtime_root / 'Codex' / 'codex.exe'
    python = runtime_root / 'python' / 'python.exe'
    if codex.is_file():
        worker.BASE_SETTINGS['codexPath'] = str(codex)
    if python.is_file():
        worker.BASE_SETTINGS['pythonPath'] = str(python)

# 工作台可能使用机器上已安装的 Codex（而不是随包副本），此时由 Node 侧把路径传进来。
shared_codex = os.environ.get('WORKBENCH_CODEX_PATH', '').strip()
if shared_codex and Path(shared_codex).is_file():
    worker.BASE_SETTINGS['codexPath'] = shared_codex

shared_python = os.environ.get('WORKBENCH_PYTHON_PATH', '').strip()
if shared_python and Path(shared_python).is_file():
    worker.BASE_SETTINGS['pythonPath'] = shared_python

if __name__ == '__main__':
    raise SystemExit(server.main())
