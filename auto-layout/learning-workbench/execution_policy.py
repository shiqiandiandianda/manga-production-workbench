"""User-selected, local-only Dazhou native style execution policy."""
import json,re
from pathlib import Path
def native_execution(root):
    path=Path(root).parent/'native-style-policy.json'
    default={'enabled':False,'engine':'original','autoReturn':False,'projects':[]}
    if not path.exists():return default
    c=json.loads(path.read_text(encoding='utf-8-sig'))
    if c.get('enabled') is not True:return default
    if c.get('engine')!='dazhou-native-style-v1' or c.get('projects')!=['dazhou'] or not re.fullmatch(r'[\w-]{1,100}',c.get('styleBookVersion','')):
        raise ValueError('专用固有排版规则的执行配置无效')
    return {**c,'modelCalls':0,'mainStyles':3,'supportStyles':5,'overlapStyles':7}
def native_book_path(root,version):
    if not re.fullmatch(r'[\w-]{1,100}',str(version)):raise ValueError('固有款式版本路径无效')
    return Path(root).parent/'styles/dazhou'/(version+'.json')
