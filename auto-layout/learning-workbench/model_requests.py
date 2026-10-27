"""Durable request-to-job receipts, never a generated-result cache.

Reads never repair jobs or resume execution. A reserved/lost request stays
uncertain until its original job is known; a new token cannot bypass it.
"""
import hashlib,json,re,threading,time,uuid
from pathlib import Path

def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def safe(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,90}',value):raise ValueError('任务或请求编号无效')
    return value

class ModelRequests:
    def __init__(self,data):
        self.data=Path(data);self.directory=self.data/'model-requests';self.session=uuid.uuid4().hex;self.lock=threading.RLock()
    def fingerprint(self,script,effort,force_new):return digest({'script':script,'reasoningEffort':effort,'forceNew':force_new})
    def records(self):
        return [read(p) for p in sorted(self.directory.glob('*.json'))]
    def observation(self,receipt,script):
        job_id=safe(receipt['jobId']);path=self.data/'runs'/job_id/'job.json'
        job=read(path) if path.exists() else {}
        status=job.get('status','uncertain')
        if status not in ('done','failed','running','queued','preparing'):status='uncertain'
        if receipt.get('session')!=self.session and status not in ('done','failed'):status='uncertain'
        return {'requestFound':True,'requestId':receipt['requestId'],'scriptId':receipt['scriptId'],'jobId':job_id,
            'status':status,'sourceMatch':receipt['scriptDigest']==digest(script),
            'message':job.get('message') or '原请求已登记，状态尚不能确认；不会重新启动'}
    def unresolved(self):
        try:
            for r in self.records():
                p=self.data/'runs'/safe(r['jobId'])/'job.json'
                if not p.exists() or read(p).get('status') not in ('done','failed'):return True
            return False
        except (ValueError,KeyError,TypeError,OSError):return True
    def resolve(self,script,active,request_id=None,allow_preview=False,validate=None,job_id=None):
        with self.lock:
            if request_id:
                p=self.directory/(safe(request_id)+'.json')
                if p.exists():
                    r=read(p)
                    if r['scriptId']!=script['id']:raise ValueError('请求回执不属于当前分镜')
                    if job_id and r['jobId']!=job_id:raise ValueError('请求与任务编号不一致')
                    result=self.observation(r,script)
                    if result['status']!='done' or not allow_preview:return result
                    if not result['sourceMatch']:return {**result,'previewAvailable':False,'message':'原请求来源已变化，不能复用；原任务状态保留'}
                else:result={'requestFound':False,'scriptId':script['id'],'status':'not-found'}
            else:result={'requestFound':False,'scriptId':script['id'],'status':'not-found'}
            if job_id and not result.get('jobId'):
                folder=self.data/'runs'/safe(job_id)
                if not (folder/'fixed-script.json').exists() or digest(read(folder/'fixed-script.json'))!=digest(script):raise ValueError('原任务缺少匹配的完整来源快照，不能猜测恢复')
                job=read(folder/'job.json')
                status=job.get('status') if job.get('status') in ('done','failed') or active.get(script['id'])==job_id else 'uncertain'
                result.update(jobId=job_id,status=status,sourceMatch=True,legacyObservation=True)
                if status!='done' or not allow_preview:return result
            if script['id'] in active:
                return {**result,'jobId':safe(active[script['id']]),'status':'running','matchedActive':True}
            for r in self.records():
                if r['scriptId']!=script['id']:continue
                observed=self.observation(r,script)
                if observed['status'] not in ('done','failed'):return observed
            if not allow_preview:return result
            p=self.data/'drafts'/(safe(script['id'])+'.json')
            if not p.exists():return {**result,'previewPresent':False,'previewAvailable':False}
            packet=read(p)
            try:
                if validate is None:raise ValueError('缺少完整预览校验')
                validate(packet,script)
            except (ValueError,KeyError,TypeError,IndexError) as exc:
                return {**result,'previewPresent':True,'previewAvailable':False,'message':str(exc)}
            return {**result,'previewPresent':True,'previewAvailable':True,'scriptDigest':digest(script),'packet':packet}
    def dispatch(self,script,active,launch,request_id=None,effort='high',force_new=False,busy_learning=False):
        if effort not in ('high','inherit') or type(force_new) is not bool:raise ValueError('任务设置无效')
        request_id=safe(request_id or uuid.uuid4().hex)
        fingerprint=self.fingerprint(script,effort,force_new)
        with self.lock:
            path=self.directory/(request_id+'.json')
            if path.exists():
                r=read(path)
                if r['fingerprint']!=fingerprint:raise ValueError('同一请求编号的来源或设置已变化，未启动新任务')
                return self.observation(r,script)
            if script['id'] in active:return {'jobId':active[script['id']],'scriptId':script['id'],'status':'running','deduplicated':True}
            state=self.resolve(script,active)
            if state.get('jobId'):return state
            if active or busy_learning or self.unresolved():raise ValueError('仍有原任务运行或状态待确认；未启动重复任务')
            if script.get('studioSource') and (self.data/'drafts'/(safe(script['id'])+'.json')).exists():
                raise ValueError('当前来源已有预览，未覆盖旧稿；请保存后刷新面板，重新排版会另建来源批次')
            job_id='model-'+time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]
            r={'format':'comic-layout-request-v1','requestId':request_id,'scriptId':script['id'],'scriptDigest':digest(script),
                'fingerprint':fingerprint,'reasoningEffort':effort,'forceNew':force_new,'jobId':job_id,'session':self.session,
                'purpose':'idempotency-and-observation-only-not-result-cache','created':time.time()}
            self.directory.mkdir(parents=True,exist_ok=True)
            temp=path.with_suffix('.json.tmp');temp.write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
            active[script['id']]=job_id
            try:result=launch(job_id,lambda:active.pop(script['id'],None))
            except Exception:
                active.pop(script['id'],None)
                # Keep the reservation. Launch may have happened before a lost ACK.
                raise
            return {**result,'requestId':request_id}
