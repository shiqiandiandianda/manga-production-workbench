"""Reversible detachment of a foreign uploaded reference from a story project."""
import copy
from pathlib import Path
from uuid import uuid4


def detach(app,pid,cid,reason='外部图片误加入小说项目'):
    from server import APIError,now
    import worker
    with app.lock:
        project=app.project(pid);character=app.character(project,cid)
        if any(j.get('projectId')==pid and j['status'] in {'queued','running'} and (j.get('characterId')==cid or j.get('kind') in {'project_auto','analyze'}) for j in app.state['jobs']):raise APIError('该角色或项目正在制作，请等待完成后移出。',409)
        chapters=(project.get('chapterAnalysis') or {}).get('chapters',[])
        if any(a.get('characterId')==cid for ch in chapters for seg in ch.get('segments',[]) for a in seg.get('appearances',[])):raise APIError('该角色有剧情出场绑定，请先核对绑定，不能作为误加入的外部参考移出。',409)
        archive_id='detached_'+uuid4().hex[:12];directory=app.data/'archives/detached-characters'
        if directory.is_symlink() or not directory.resolve().is_relative_to(app.data.resolve()):raise APIError('移出记录目录无效。')
        directory.mkdir(parents=True,exist_ok=True)
        archive={'id':archive_id,'projectId':pid,'projectName':project['name'],'character':copy.deepcopy(character),'reason':reason,'detachedAt':now()}
        worker.atomic_json(directory/(archive_id+'.json'),archive)
        summary={k:archive[k] for k in ['id','projectId','projectName','reason','detachedAt']};summary.update(characterId=cid,name=character['name'],references=copy.deepcopy(character.get('references',[])))
        project['characters'][:]=[c for c in project['characters'] if c['id']!=cid];project['updatedAt']=now();app.state.setdefault('detachedCharacters',[]).append(summary);app.save()
        return {'detached':copy.deepcopy(summary),'projectId':pid}


def restore(app,archive_id):
    from server import APIError,ID_RE,now
    import json
    with app.lock:
        summary=app.find(app.state.get('detachedCharacters',[]),archive_id,'移出记录')
        path=app.data/'archives/detached-characters'/(archive_id+'.json')
        if not ID_RE.fullmatch(archive_id) or path.is_symlink() or not path.resolve().is_relative_to((app.data/'archives/detached-characters').resolve()):raise APIError('移出记录路径无效。')
        archive=json.loads(path.read_text(encoding='utf-8'));project=app.project(archive['projectId']);character=archive['character']
        if any(c['id']==character['id'] for c in project['characters']):raise APIError('角色已经存在，未重复恢复。',409)
        if any(j.get('projectId')==project['id'] and j['status'] in {'queued','running'} and j.get('kind') in {'project_auto','analyze'} for j in app.state['jobs']):raise APIError('项目正在拆解或批量制作，请等待完成。',409)
        project['characters'].append(copy.deepcopy(character));project['updatedAt']=now();app.state['detachedCharacters'].remove(summary);app.save()
        return {'characterId':character['id'],'projectId':project['id'],'restored':True}
