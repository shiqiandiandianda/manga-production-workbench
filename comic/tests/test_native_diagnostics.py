import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import codex_worker
from native_diagnostics import TurnDiagnostics, safe_text


class NativeDiagnosticsTest(unittest.TestCase):
    def test_stream_without_turn_completion_requires_remote_check(self):
        with tempfile.TemporaryDirectory(prefix='comic-diagnostic-test-') as temp:
            root=Path(temp)
            (root/'input.json').write_text('{"referenceFiles":[]}',encoding='utf-8')
            (root/'request.txt').write_text('synthetic test',encoding='utf-8')
            class Server:
                def rpc(self,method,params,timeout=30):return {'thread':{'id':'t'}} if method=='thread/start' else {'turn':{'id':'u'}}
                def events(self):return iter([])
            with patch.object(codex_worker,'emit'),self.assertRaises(codex_worker.BridgeError) as raised:codex_worker.generate(Server(),root)
            event=codex_worker.error_event(raised.exception)
            self.assertFalse(event['generationEnded'])
            self.assertEqual(event['requiredAction'],'inspect_existing_job_and_remote_state')
            self.assertIn('不要重复提交',event['message'])
            self.assertEqual(event['diagnostics']['classification'],'remote_state_unknown')

    def test_diagnostic_disk_failure_does_not_replace_actual_no_image_failure(self):
        with tempfile.TemporaryDirectory(prefix='comic-diagnostic-test-') as temp:
            root=Path(temp)
            (root/'input.json').write_text('{"referenceFiles":[]}',encoding='utf-8')
            (root/'request.txt').write_text('synthetic test',encoding='utf-8')
            class Server:
                def rpc(self,method,params,timeout=30):return {'thread':{'id':'t'}} if method=='thread/start' else {'turn':{'id':'u'}}
                def events(self):
                    yield {'method':'turn/completed','params':{'threadId':'t','turnId':'u','turn':{'id':'u','status':'completed'}}}
            original=Path.write_text
            def write(path,*args,**kwargs):
                if path.name=='native-diagnostics.json':raise OSError('synthetic disk full')
                return original(path,*args,**kwargs)
            with patch.object(codex_worker,'emit'),patch.object(Path,'write_text',write),self.assertRaises(codex_worker.BridgeError) as raised:codex_worker.generate(Server(),root)
            self.assertEqual(raised.exception.code,'native_image_missing')
            self.assertEqual(raised.exception.diagnostics['classification'],'completed_without_image')

    def test_completed_without_image_preserves_final_answer_and_manual_retry(self):
        with tempfile.TemporaryDirectory(prefix='comic-diagnostic-test-') as temp:
            root=Path(temp)
            (root/'input.json').write_text(json.dumps({'referenceFiles':[]}), encoding='utf-8')
            (root/'request.txt').write_text('synthetic test', encoding='utf-8')
            class Server:
                def rpc(self, method, params, timeout=30):
                    return {'thread':{'id':'t'}} if method=='thread/start' else {'turn':{'id':'u'}}
                def events(self):
                    for method,item in [('item/completed',{'type':'imageView'}),('item/completed',{'type':'agentMessage','text':'工具当前不可用，请检查渠道。 Bearer fake-secret-value'}),('turn/completed',None)]:
                        yield {'method':method,'params':{'threadId':'t','turnId':'u','item':item or {},'turn':{'id':'u','status':'completed'}}}
            with patch.object(codex_worker,'emit'), self.assertRaises(codex_worker.BridgeError) as raised:
                codex_worker.generate(Server(),root)
            event=codex_worker.error_event(raised.exception)
            self.assertEqual(event['code'],'native_image_missing')
            self.assertFalse(event['retryable'])
            self.assertTrue(event['generationEnded'])
            self.assertEqual(event['requiredAction'],'review_and_explicit_resubmit')
            d=event['diagnostics']
            self.assertEqual(d['classification'],'completed_without_image')
            self.assertEqual(d['referenceViews'],1)
            self.assertEqual(d['imageStarted'],0)
            self.assertIn('工具当前不可用',d['finalReply'])
            self.assertNotIn('fake-secret-value',json.dumps(d))
            self.assertEqual(json.loads((root/'native-diagnostics.json').read_text('utf-8'))['finalReply'],d['finalReply'])
            self.assertFalse((root/'result.json').exists())
            log=(root/'app-server-events.jsonl').read_text('utf-8')
            self.assertIn('reply',log)
            self.assertNotIn('fake-secret-value',log)

    def test_image_failure_is_logged_before_exception(self):
        with tempfile.TemporaryDirectory(prefix='comic-diagnostic-test-') as temp:
            root=Path(temp)
            (root/'input.json').write_text('{"referenceFiles":[]}',encoding='utf-8')
            (root/'request.txt').write_text('synthetic test',encoding='utf-8')
            class Server:
                def rpc(self,method,params,timeout=30):return {'thread':{'id':'t'}} if method=='thread/start' else {'turn':{'id':'u'}}
                def events(self):
                    yield {'method':'item/completed','params':{'threadId':'t','turnId':'u','item':{'type':'imageGeneration','failure':{'code':'provider_failure','message':'explicit failure'}}}}
            with patch.object(codex_worker,'emit'),self.assertRaises(codex_worker.BridgeError) as raised:codex_worker.generate(Server(),root)
            self.assertEqual(raised.exception.code,'native_image_failed')
            self.assertIn('explicit failure',(root/'app-server-events.jsonl').read_text('utf-8'))
            d=json.loads((root/'native-diagnostics.json').read_text('utf-8'))
            self.assertEqual(d['classification'],'native_image_failed')
            self.assertFalse(d['remoteEnded'])

    def test_classification_distinguishes_turn_failure_and_uncertain_transport(self):
        d=TurnDiagnostics()
        self.assertEqual(d.snapshot()['classification'],'remote_state_unknown')
        self.assertEqual(d.snapshot()['retry']['action'],'inspect_existing_job_and_remote_state')
        d.observe('item/started',{'item':{'type':'imageGeneration'}})
        self.assertEqual(d.snapshot(completed=True)['classification'],'image_event_without_saved_path')
        d.observe('turn/completed',{'turn':{'status':'failed','error':{'code':'x','message':'provider explanation'}}})
        self.assertEqual(d.snapshot(completed=True)['classification'],'turn_failed')
        self.assertEqual(d.snapshot()['lastError']['message'],'provider explanation')

    def test_only_agent_answer_is_collected_and_text_is_bounded_redacted(self):
        d=TurnDiagnostics()
        d.observe('item/completed',{'item':{'type':'reasoning','text':'private reasoning'}})
        d.observe('item/completed',{'item':{'type':'agentMessage','phase':'analysis','text':'analysis'}})
        self.assertEqual(d.snapshot()['finalReply'],'')
        d.observe('item/completed',{'item':{'type':'agentMessage','text':'A'*13000}})
        self.assertEqual(len(d.snapshot()['lastAgentReply']),12000)
        self.assertEqual(d.snapshot()['finalReply'],'')
        d.observe('turn/completed',{'turn':{'status':'completed'}})
        self.assertEqual(len(d.snapshot()['finalReply']),12000)
        for secret in ['sk-abcdefghi123','sk_proj_abcdefghi123','Bearer testing-value','eyJabc.def.ghi','api_key=testing-value']:
            self.assertNotIn('testing-value',safe_text(secret))
            self.assertNotIn('abcdefghi123',safe_text(secret))

    def test_commentary_is_not_reported_as_final_answer(self):
        d=TurnDiagnostics()
        d.observe('item/completed',{'item':{'type':'agentMessage','phase':'commentary','text':'I will inspect references'}})
        d.observe('turn/completed',{'turn':{'status':'completed'}})
        self.assertEqual(d.snapshot(completed=True)['finalReply'],'')
        self.assertEqual(d.snapshot()['lastAgentReply'],'I will inspect references')
        d.observe('item/completed',{'item':{'type':'agentMessage','phase':'final_answer','text':'Actual final explanation'}})
        self.assertEqual(d.snapshot()['finalReply'],'Actual final explanation')
        self.assertTrue(d.snapshot()['finalReplyExplicit'])


if __name__=='__main__':unittest.main()
