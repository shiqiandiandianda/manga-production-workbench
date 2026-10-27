"""Comic workbench adapter for the supplied 0.3.1 learning service."""
import argparse,copy,hashlib,json,os,re
import importlib.util
from pathlib import Path
from urllib.parse import unquote,urlparse
import server as workbench

def contract_for(key,version=None):
    project=workbench.LIBRARY.project(key)
    version=version or project.get('activeVersion')
    if not version:raise ValueError('该项目尚未启用排版风格，请先在学习库中学习、试排并启用')
    details=workbench.LIBRARY.version_details(key,version)
    result={'id':key,'name':project['name'],'version':version,'rules':{'policy':details['policy'],'style':details['style'],'referenceEpisodes':details['project'].get('referenceEpisodes',[])}}
    result['digest']=hashlib.sha256(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return result

def resolve_contract(value):
    frozen=value.get('contract')
    if frozen:
        current=contract_for(frozen.get('id'),frozen.get('version'))
        if frozen!=current:raise ValueError('冻结的排版规则与当前版本不一致，请保留原工程并核对规则版本')
        return current
    return contract_for(value.get('ruleId'))

class Handler(workbench.Handler):
    def do_GET(self):
        if not self.origin_ok():return self.send(403,{'error':'仅允许本机访问'})
        route=unquote(urlparse(self.path).path)
        if route in ('/api/health','/api/integration/status'):
            return self.send(200,{'app':'comic-layout-learning-workbench','version':'0.3.1','integrationVersion':1,'busy':bool(workbench.ACTIVE_JOBS or workbench.LIBRARY.active_learning),'root':str(workbench.ROOT),'dataRoot':str(workbench.DATA),'pid':os.getpid(),'dependencies':{name:importlib.util.find_spec(name) is not None for name in ('numpy','PIL','openpyxl')}})
        if route=='/api/integration/rules':
            projects={p['id']:p for p in workbench.read(workbench.DATA/'projects.json')}
            return self.send(200,{'entries':[{**p,'aliases':projects.get(p['id'],{}).get('aliases',[]),'builtin':False} for p in workbench.LIBRARY.status()['projects']]})
        image=re.fullmatch(r'/api/integration/artwork/([\w-]{1,90})/([\w-]{1,90})',route)
        if image:
            try:
                script=workbench.read(workbench.file_for('scripts',image[1]));batch_id=script.get('studioSource',{}).get('reflowBatchId','')
                if not re.fullmatch(r'[a-f0-9-]{36}',batch_id):raise ValueError('没有可用裁图')
                comic=Path(os.environ['COMIC_DATA_DIR']).resolve();batch=workbench.read(comic/'auto-layout-reflow'/(batch_id+'.json'))
                if batch.get('scriptId')!=script['id']:raise ValueError('裁图来源不一致')
                item=next(i for i in batch['items'] if i['key']==image[2]);file=Path(item['filePath']).resolve()
                if not file.is_relative_to(comic/'panel-slices'):raise ValueError('裁图路径无效')
                raw=file.read_bytes()
                if hashlib.sha256(raw).hexdigest()!=item['sha256']:raise ValueError('裁图已改变')
                return self.send(200,raw,'image/png')
            except (OSError,KeyError,ValueError,StopIteration):return self.send(404,{'error':'原裁图不可用，未替换原图'})
        return super().do_GET()

    def mutate(self,route,value):
        if route=='/api/integration/rules/resolve':return resolve_contract(value)
        if route=='/api/integration/import':
            contract=resolve_contract({'contract':value.get('layoutRuleContract')})
            shots=value.get('shots')
            if not isinstance(shots,list) or not 1<=len(shots)<=800:raise ValueError('固定分镜数量无效')
            keys=[s.get('key') for s in shots]
            if any(not isinstance(k,str) or not re.fullmatch(r'[\w-]{1,90}',k) for k in keys) or len(set(keys))!=len(keys):raise ValueError('原分镜编号缺失或重复')
            episode=value.get('episode')
            if not isinstance(episode,int) or not 1<=episode<=99999:raise ValueError('话数无效')
            signature=hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            identifier='studio-'+signature[:32]
            target=workbench.file_for('scripts',identifier)
            if target.exists():return {'id':identifier,'reused':True}
            source={'projectId':value.get('projectId'),'revision':value.get('revision'),'episode':episode}
            studio={**source,**{k:value[k] for k in ('planningBatchId','reflowBatchId') if value.get(k)},'mode':'preproduction-layout' if value.get('planningBatchId') else 'screen-crop-reflow'}
            script={'id':identifier,'projectId':contract['id'],'episode':episode,'title':str(value.get('title',''))[:180],'source':source,'shots':copy.deepcopy(shots),'studioSource':studio,'layoutRuleContract':contract}
            workbench.write(target,script)
            return {'id':identifier,'reused':False}
        if route=='/api/model/generate' and os.environ.get('AUTO_LAYOUT_TEST_NO_MODEL')=='1':raise ValueError('隔离验收禁止调用真实模型')
        return super().mutate(route,value)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=19848);args=parser.parse_args()
    server=workbench.ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print('自动排版服务 http://127.0.0.1:'+str(args.port),flush=True)
    server.serve_forever()
