"""Offline portable-install checks; never reads or copies account credentials."""
from pathlib import Path
import hashlib,importlib,json,subprocess,sys
ROOT=Path(__file__).resolve().parent

def sha256(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        while chunk:=stream.read(1048576):h.update(chunk)
    return h.hexdigest()

def main():
    errors=[]
    manifest=json.loads((ROOT/'程序文件校验.json').read_text(encoding='utf-8-sig'))
    for item in manifest['files']:
        path=ROOT/item['path']
        if not path.is_file() or sha256(path)!=item['sha256']:errors.append('文件缺失或变化：'+item['path'])
    for module in ['PIL.Image','pypdf','olefile','server','worker']:
        try:importlib.import_module(module)
        except Exception as error:errors.append('运行组件无法载入：'+module+' / '+str(error))
    try:
        run=subprocess.run([str(ROOT/'runtime/Codex/codex.exe'),'--version'],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if run.returncode:errors.append('Codex 程序不能启动。')
        else:print(run.stdout.strip())
    except (OSError,subprocess.TimeoutExpired):errors.append('Codex 程序缺失或未能启动。')
    try:
        import worker
        settings=worker.settings()
        for name in ['codexPath','pythonPath']:
            if not Path(settings[name]).is_file():errors.append('程序路径不可用：'+name)
    except Exception as error:errors.append('本地配置无法读取：'+str(error))
    if errors:
        for error in errors:print(error)
        print('检查未通过；如果你没有主动修改程序，请完整重新解压。')
        return 1
    print('程序完整性与本地组件检查通过。')
    print('首次使用请双击“登录Codex.cmd”，登录自己的账号；随后启动网页并检查连接。')
    return 0

if __name__=='__main__':raise SystemExit(main())
