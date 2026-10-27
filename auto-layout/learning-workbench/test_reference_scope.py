import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import server
from project_library import ProjectLibrary


class ReferenceScopeTests(unittest.TestCase):
    def setUp(self):
        scratch=Path(__file__).resolve().parent/'test-scratch';scratch.mkdir(exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=scratch);self.root=Path(self.temp.name)/'learning-workbench';self.data=self.root/'data'
        for folder in ['references','scripts','history','runs']:(self.data/folder).mkdir(parents=True,exist_ok=True)
        (self.data/'projects.json').write_text('[]',encoding='utf-8')
        self.data_patch=patch.object(server,'DATA',self.data);self.data_patch.start()
        self.library=ProjectLibrary(self.root,self.data,server.profile_for)
        self.library_patch=patch.object(server,'LIBRARY',self.library);self.library_patch.start()
        self.handler=object.__new__(server.Handler)

    def tearDown(self):
        self.library_patch.stop();self.data_patch.stop();self.temp.cleanup()

    def create(self,name):return self.handler.mutate('/api/projects',{'name':name})

    def reference(self,project,suffix,filename):
        record={'id':project['id']+'-'+suffix,'projectId':project['id'],'name':filename,'sourceSha256':'fixture','revisionId':None,'sourceWidth':200,'sourceHeight':700,
          'frames':[{'referenceFrameId':'R001','x':0,'y':0,'w':200,'h':260,'role':'main','review':'checked'},{'referenceFrameId':'R002','x':40,'y':330,'w':130,'h':210,'role':'support','review':'checked'}]}
        server.write(self.data/'references'/(record['id']+'.json'),record);return record

    def select(self,project,ids):return self.handler.mutate('/api/library/select',{'projectId':project['id'],'referenceIds':ids})

    def test_new_project_does_not_silently_select_every_upload(self):
        p=self.create('新项目');self.reference(p,'a','成品第21话.png');self.reference(p,'b','成品第22话.png')
        self.assertEqual(server.selected_references(p['id']),[])
        self.assertEqual(server.read(self.data/'reference-selections.json')[p['id']],[])

    def test_selected_files_persist_and_only_their_frames_enter_profile(self):
        p=self.create('A');a=self.reference(p,'a','第21话.png');self.reference(p,'b','第22话.png')
        self.select(p,[a['id']]);self.assertEqual([r['id'] for r in server.selected_references(p['id'])],[a['id']])
        profile=server.profile_for(p['id']);self.assertEqual(profile['referenceEpisodes'],[21]);self.assertEqual(profile['checkedCount'],2)
        self.assertEqual({s['referenceId'] for s in profile['samples']},{a['id']})
        self.assertEqual(server.read(self.data/'reference-selections.json')[p['id']],[a['id']])

    def test_empty_scope_remains_empty_after_more_uploads_and_blocks_learning(self):
        p=self.create('A');a=self.reference(p,'a','第1话.png');self.select(p,[a['id']]);self.select(p,[])
        self.reference(p,'b','第2话.png');self.assertEqual(server.profile_for(p['id'])['sourceFiles'],[])
        with patch.object(self.library,'learn',side_effect=AssertionError('must not start model')):
            with self.assertRaisesRegex(ValueError,'至少一份'):self.handler.mutate('/api/library/learn',{'projectId':p['id']})

    def test_projects_save_independent_scopes_and_reject_cross_project_files(self):
        a=self.create('A');b=self.create('B');ra=self.reference(a,'a','第1话.png');rb=self.reference(b,'b','第2话.png')
        self.select(a,[ra['id']]);self.select(b,[rb['id']]);before=(self.data/'reference-selections.json').read_bytes()
        with self.assertRaises(ValueError):self.select(a,[rb['id']])
        with self.assertRaises(ValueError):self.select(a,[ra['id'],ra['id']])
        self.assertEqual((self.data/'reference-selections.json').read_bytes(),before)
        self.select(a,[]);self.assertEqual([r['id'] for r in server.selected_references(b['id'])],[rb['id']])

    def test_episode_numbers_are_read_from_metadata_or_named_episodes(self):
        for ref,expected in [({'episode':'31','name':'原图.png'},31),({'name':'大周 第 21 话.png'},21),({'name':'preview_EP-003.jpg'},3),({'name':'手工选定的长图.png'},None),({'name':'20261023-1234.png'},None)]:
            self.assertEqual(server.reference_episode(ref),expected)

    def test_scope_changes_do_not_change_active_style_version(self):
        p=self.create('A');r=self.reference(p,'a','第1话.png');current=self.library.project(p['id']);current['activeVersion']='approved-existing';current['versions']=[{'id':'approved-existing','status':'active'}];self.library.update(current)
        before=(self.library.library/'projects.json').read_bytes();self.select(p,[r['id']]);self.select(p,[])
        self.assertEqual((self.library.library/'projects.json').read_bytes(),before)

    def test_existing_scope_can_be_saved_when_history_folder_is_missing(self):
        p=self.create('A');r=self.reference(p,'a','第1话.png');(self.data/'history').rmdir()
        self.select(p,[r['id']]);self.assertEqual([ref['id'] for ref in server.selected_references(p['id'])],[r['id']])
        self.assertTrue((self.data/'history').is_dir())


if __name__=='__main__':unittest.main()
