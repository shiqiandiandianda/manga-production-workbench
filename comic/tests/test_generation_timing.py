import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"python"))
import codex_worker

class GenerationTimingTest(unittest.TestCase):
    def setUp(self):
        parent=Path(__file__).resolve().parents[1]/"test-temp"
        parent.mkdir(exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(prefix="generation-timing-",dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name)
        self.output=self.directory/"native.png"
        Image.new("RGB",(6,4),(30,60,90)).save(self.output)
        self.references=[]
        for index in range(2):
            filename=self.directory/("参考"+str(index)+".png")
            Image.new("RGB",(6,4),(40+index,70,100)).save(filename)
            self.references.append(str(filename))
        (self.directory/"input.json").write_text(json.dumps({"action":"generate","referenceFiles":self.references}),encoding="utf-8")
        (self.directory/"request.txt").write_text("合成固定分镜：人物与原文必须保留",encoding="utf-8")

    def server(self,allowed=("low","high")):
        directory=self.directory
        class Server:
            def __init__(self):self.clock=0;self.calls=[]
            def rpc(self,method,params,timeout=30):
                self.calls.append((method,params));self.clock+=.1
                if method=="thread/start":return {"thread":{"id":"thread"},"model":"gpt-6.1-sol","reasoningEffort":"ultra"}
                if method=="model/list":return {"data":[{"model":"gpt-6.1-sol","supportedReasoningEfforts":[{"reasoningEffort":value} for value in allowed]}],"nextCursor":None}
                if method=="turn/start":return {"turn":{"id":"turn"}}
                return {}
            def events(self):
                def event(method,item):return {"method":method,"params":{"threadId":"thread","turnId":"turn","item":item}}
                self.clock+=10;yield event("item/started",{"type":"imageView","id":"view-1"})
                self.clock+=1;yield event("item/completed",{"type":"imageView","id":"view-1"})
                self.clock+=3;yield event("item/started",{"type":"imageGeneration","id":"image-1"})
                self.clock+=20;yield event("item/completed",{"type":"imageGeneration","id":"image-1","savedPath":str(directory/"native.png")})
                raise AssertionError("No second image or extra turn wait is allowed")
            def settle_turn(self,*args,**kwargs):
                self.clock+=2
                return {"completed":True,"completedMonotonic":self.clock,"receivedAt":"2026-10-12T12:00:00+00:00"}
        return Server()

    def generate(self,server,effort="low"):
        with patch.dict(os.environ,{"COMIC_CODEX_GENERATION_EFFORT":effort}),patch.object(codex_worker.time,"monotonic",side_effect=lambda:server.clock),patch.object(codex_worker,"emit"):
            return codex_worker.generate(server,self.directory)

    def test_event_timings_split_preimage_native_and_output_without_double_counting(self):
        server=self.server();result=self.generate(server);timings=result["timings"]
        self.assertEqual(timings["imageGenerationMs"],20000)
        self.assertEqual(timings["preImageMs"],14300)
        self.assertEqual(timings["outputMs"],2100)
        self.assertEqual(timings["totalMs"],36400)
        self.assertEqual(timings["preImageMs"]+timings["imageGenerationMs"]+timings["outputMs"],timings["totalMs"])
        self.assertEqual(timings["inheritedDispatchEffort"],"ultra")
        self.assertEqual(timings["dispatchEffort"],"low")
        self.assertTrue(timings["turnCompletionObserved"])
        self.assertEqual(timings["dispatchModel"],"gpt-6.1-sol")
        events=[json.loads(line) for line in (self.directory/"app-server-events.jsonl").read_text("utf-8").splitlines()]
        self.assertEqual([event["elapsedMs"] for event in events],[10300,11300,14300,34300])
        self.assertTrue(all(event["receivedAt"] and event["itemId"] for event in events))

    def test_effort_override_changes_only_turn_parameter_and_keeps_prompt_reference_order_and_global_config(self):
        config=self.directory/"config.toml";config.write_text('model="gpt-6.1-sol"\nmodel_reasoning_effort="ultra"\n',encoding="utf-8")
        before=config.read_bytes();low=self.server();high=self.server()
        self.generate(low,"low");self.generate(high,"high")
        a=next(params for method,params in low.calls if method=="turn/start")
        b=next(params for method,params in high.calls if method=="turn/start")
        self.assertEqual(a["input"],b["input"]);self.assertEqual(a["effort"],"low");self.assertEqual(b["effort"],"high")
        self.assertEqual(json.loads(a["input"][0]["text"].split("\n")[-1]),self.references)
        self.assertNotIn("model",a);self.assertEqual(config.read_bytes(),before)
        self.generate(low,"low");self.assertEqual(sum(method=="model/list" for method,_ in low.calls),1)

    def test_invalid_and_verified_unsupported_effort_fail_before_any_inference(self):
        for value,allowed,code in [("garbage",("low",),"invalid_generation_effort"),("high",("low",),"unsupported_generation_effort")]:
            server=self.server(allowed)
            with self.assertRaises(codex_worker.BridgeError) as caught:self.generate(server,value)
            self.assertEqual(caught.exception.code,code);self.assertFalse(caught.exception.may_have_started)
            self.assertFalse(any(method=="turn/start" for method,_ in server.calls))

    def test_missing_advertised_efforts_do_not_falsely_reject_a_valid_turn_parameter(self):
        result=self.generate(self.server(()));self.assertFalse(result["timings"]["effortCatalogChecked"])

if __name__=="__main__":unittest.main()
