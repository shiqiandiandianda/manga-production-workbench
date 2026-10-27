"""Comic workbench adapter for the supplied 0.3.1 learning service."""
import argparse,copy,hashlib,json,os,re
import importlib.util
from pathlib import Path
from urllib.parse import unquote,urlparse
import server as workbench
from execution_policy import native_execution

# unified-core-adapter-v2: one frozen contract implementation for import and execution.
def contract_for(key,version=None):
    return workbench.unified.freeze(workbench.ROOT,workbench.LIBRARY,key,version)

def resolve_contract(value):
    return workbench.unified.resolve(workbench.ROOT,workbench.LIBRARY,value)

class Handler(workbench.Handler):
    def do_GET(self):
        if not self.origin_ok():return self.send(403,{'error':'仅允许本机访问'})
        route=unquote(urlparse(self.path).path)
        if route in ('/api/health','/api/integration/status'):
            return self.send(200,{'app':'comic-layout-learning-workbench','version':'0.3.1','integrationVersion':1,'layoutAdapterVersion':2,'layoutExecution':native_execution(workbench.ROOT),'ruleContractFormat':'comic-unified-layout-rules','requestRecovery':'durable-request-v1','editorOrigin':os.environ.get('LAYOUT_PARENT_ORIGIN',os.environ.get('AUTO_LAYOUT_EDITOR_ORIGIN','http://127.0.0.1:18924')),'busy':bool(workbench.ACTIVE_JOBS or workbench.LIBRARY.active_learning or workbench.MODEL_REQUESTS.unresolved()),'root':str(workbench.ROOT),'dataRoot':str(workbench.DATA),'pid':os.getpid(),'dependencies':{name:importlib.util.find_spec(name) is not None for name in ('numpy','PIL','openpyxl')}})
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
        if route=='/api/integration/import':return super().mutate(route,value)
        if route=='/api/model/generate' and os.environ.get('AUTO_LAYOUT_TEST_NO_MODEL')=='1':raise ValueError('隔离验收禁止调用真实模型')
        return super().mutate(route,value)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=19848);args=parser.parse_args()
    server=workbench.ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print('自动排版服务 http://127.0.0.1:'+str(args.port),flush=True)
    server.serve_forever()
