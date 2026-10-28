import copy,json,hashlib,os,shutil,tempfile,threading,unittest
from pathlib import Path
import unified_layout as rules

ROOT=Path(__file__).resolve().parent
def put(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')

class Library:
    def __init__(self,folder):
        self.library=folder;self.lock=threading.RLock();self.writes=0
        put(folder/'projects.json',{'projects':[{'id':'work','name':'测试作品','activeVersion':'current','versions':[{'id':'current','status':'active'}]}]})
    def project(self,key):return next(p for p in rules.read(self.library/'projects.json')['projects'] if p['id']==key)
    def update(self,project):
        self.writes+=1;state=rules.read(self.library/'projects.json');state['projects']=[project if p['id']==project['id'] else p for p in state['projects']];put(self.library/'projects.json',state)
    def version_folder(self,key,version):
        if not any(v['id']==version for v in self.project(key)['versions']):raise ValueError('版本未登记')
        return self.library/key/'versions'/version

class FrozenRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT);self.addCleanup(self.temp.cleanup)
        self.library=Library(Path(self.temp.name)/'library');self.folder=self.library.library/'work/versions/old';self.data=self.folder/'data'
        put(self.folder/'project.json',{'id':'work','name':'测试作品','version':'old','status':'active'})
        put(self.data/'learning-profile.json',{'version':'v1','policy':{'gap':1.0},'sourceFiles':[],'samples':[],'relationships':[]})
        put(self.data/'learned-style.json',{'summary':'旧版规则原文'});put(self.data/'references/ref.json',{'evidence':'已核对依据'})
        self.manifest={str(p.relative_to(self.data)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in self.data.rglob('*.json')}
        put(self.data/'manifest.json',{'files':self.manifest})
        self.contract=rules.learned_contract(self.library.project('work'),'old',self.data)
    def resolve(self,contract=None):return rules.resolve(ROOT,self.library,{'contract':contract or self.contract})
    def unchanged(self,action):
        before=(self.library.library/'projects.json').read_bytes()
        with self.assertRaises((ValueError,FileNotFoundError)):action()
        self.assertEqual(before,(self.library.library/'projects.json').read_bytes());self.assertEqual(self.library.writes,0)
    def test_restore_exact_version_preserves_contract_default_and_trial_state(self):
        before=(self.library.library/'projects.json').read_bytes();self.assertEqual(self.resolve(),self.contract)
        p=self.library.project('work');self.assertEqual(p['activeVersion'],'current');entry=p['versions'][1]
        self.assertEqual(entry['id'],'old');self.assertEqual(entry['status'],'frozen-compatible');self.assertNotIn('trialPassed',entry)
        backup=next((self.library.library/'backups').glob('*.local.json'));self.assertEqual(backup.read_bytes(),before)
        self.assertEqual(rules.freeze(ROOT,self.library,'work','old'),self.contract)
    def test_retry_and_concurrent_resolves_do_not_duplicate_registration(self):
        errors=[]
        def resolve():
            try:self.resolve()
            except Exception as e:errors.append(e)
        threads=[threading.Thread(target=resolve) for _ in range(4)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(errors,[]);self.assertEqual(self.library.writes,1);self.assertEqual(len(self.library.project('work')['versions']),2)
    def test_candidate_registry_entry_is_not_promoted_by_snapshot(self):
        p=self.library.project('work');p['versions'].append({'id':'old','status':'candidate','trialPassed':False});self.library.update(p);self.library.writes=0
        self.unchanged(lambda:self.resolve())
    def test_unapproved_snapshot_is_rejected(self):
        put(self.folder/'project.json',{'id':'work','name':'测试作品','version':'old','status':'candidate'})
        self.unchanged(lambda:self.resolve())
    def test_snapshot_identity_mismatch_is_rejected(self):
        put(self.folder/'project.json',{'id':'other','name':'测试作品','version':'old','status':'active'})
        self.unchanged(lambda:self.resolve())
    def test_corrupt_contract_is_rejected_before_registry_write(self):
        c=copy.deepcopy(self.contract);c['rules']['style']['summary']='被改过的规则'
        self.unchanged(lambda:self.resolve(c))
    def test_self_consistent_different_contract_is_not_accepted_as_old(self):
        c=copy.deepcopy(self.contract);c['rules']['style']['summary']='另一套规则';c['digest']=rules.digest({k:v for k,v in c.items() if k!='digest'})
        self.unchanged(lambda:self.resolve(c))
    def test_all_reference_files_are_checked_not_only_two_rule_files(self):
        put(self.data/'references/ref.json',{'evidence':'已改变'})
        self.unchanged(lambda:self.resolve())
    def test_missing_rule_in_manifest_is_rejected(self):
        del self.manifest['learning-profile.json'];put(self.data/'manifest.json',{'files':self.manifest})
        self.unchanged(lambda:self.resolve())
    def test_manifest_path_escape_is_rejected(self):
        self.manifest['../outside.json']='a'*64;put(self.data/'manifest.json',{'files':self.manifest})
        self.unchanged(lambda:self.resolve())
    def test_registered_compatible_version_is_rechecked_after_file_change(self):
        self.resolve();put(self.data/'references/ref.json',{'evidence':'随后变化'})
        with self.assertRaisesRegex(ValueError,'校验失败'):self.resolve()

if __name__=='__main__':unittest.main()
