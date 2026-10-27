"""Recoverable library removal; source scripts, drafts and jobs remain untouched."""
import json,re,uuid,datetime
from pathlib import Path

class ScriptArchive:
    def __init__(self,data):
        self.data=Path(data);self.index=self.data/'script-archive.json'
    def entries(self):
        return json.loads(self.index.read_text(encoding='utf-8')) if self.index.exists() else {}
    def _file(self,kind,key):
        if not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,90}',key):raise ValueError('分镜ID无效')
        return self.data/kind/(key+'.json')
    def _save(self,entries):
        temp=self.index.with_suffix('.'+uuid.uuid4().hex+'.tmp')
        temp.write_text(json.dumps(entries,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(self.index)
    def archive(self,key,expected_script,expected_packet,busy=False):
        if busy:raise ValueError('这份排版任务仍在运行，请完成后再删除')
        script=json.loads(self._file('scripts',key).read_text(encoding='utf-8-sig'))
        draft=self._file('drafts',key)
        packet=json.loads(draft.read_text(encoding='utf-8-sig')) if draft.exists() else None
        if script!=expected_script or packet!=expected_packet:raise ValueError('分镜或排版结果已有更新，请重新打开后再删除')
        entries=self.entries()
        if key in entries:return entries[key]
        stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
        folder=self.data/'deleted-scripts'/uuid.uuid4().hex;folder.mkdir(parents=True)
        snapshot=folder/'snapshot.json'
        snapshot.write_text(json.dumps({'script':script,'packet':packet,'deletedAt':stamp},ensure_ascii=False,indent=2),encoding='utf-8')
        entry={'id':key,'projectId':script['projectId'],'episode':script['episode'],'title':script['title'],'deletedAt':stamp,'snapshot':str(snapshot.relative_to(self.data))}
        entries[key]=entry;self._save(entries);return entry
    def restore(self,key):
        self._file('scripts',key)
        entries=self.entries()
        if key in entries:
            entries.pop(key);self._save(entries)
        return {'id':key,'restored':True}
