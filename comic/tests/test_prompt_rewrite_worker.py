import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import codex_worker as worker

class TextServer:
    def __init__(self, reply='{"prompt":"完整修订后的提示词"}', status="completed", terminal=True):
        self.calls, self.settled = [], []
        self.reply, self.status, self.terminal = reply, status, terminal
        self.generation_started = False
    def rpc(self, method, params, timeout=0):
        self.calls.append((method, params))
        if method == "thread/start": return {"thread":{"id":"thread-text"}}
        if method == "turn/start": return {"turn":{"id":"turn-text"}}
        raise AssertionError(method)
    def events(self, timeout=0):
        yield {"method":"item/completed","params":{"threadId":"other","turnId":"other","item":{"type":"agentMessage","text":"wrong"}}}
        yield {"method":"item/completed","params":{"threadId":"thread-text","turnId":"turn-text","item":{"type":"agentMessage","text":self.reply}}}
        if self.terminal: yield {"method":"turn/completed","params":{"threadId":"thread-text","turn":{"id":"turn-text","status":self.status}}}
    def settle_turn(self, thread, turn, completed=False):
        self.settled.append(completed)

class PromptRewriteTest(unittest.TestCase):
    def test_pasted_images_are_real_ordered_turn_attachments(self):
        with tempfile.TemporaryDirectory(dir=os.environ.get("COMIC_TEST_OUTPUT_DIR")) as tmp:
            directory = Path(tmp)
            (directory / "request.txt").write_text("参考图1的空间关系", encoding="utf-8")
            files = [directory / "reference-1.png", directory / "reference-2.png"]
            for file in files:
                file.write_bytes(b"fixture")
            (directory / "references.json").write_text(json.dumps([{"file":str(file)} for file in files]), encoding="utf-8")
            server = TextServer()
            with patch.object(worker,"progress"):
                worker.rewrite_prompt(server,directory)
            contents = server.calls[1][1]["input"]
            self.assertEqual([item["type"] for item in contents], ["text", "localImage", "localImage"])
            self.assertEqual([item["path"] for item in contents[1:]], [str(file.resolve()) for file in files])
            self.assertFalse(server.calls[0][1]["config"]["features.image_generation"])

    def run_text(self, server):
        with tempfile.TemporaryDirectory(dir=os.environ.get("COMIC_TEST_OUTPUT_DIR")) as tmp:
            directory=Path(tmp)
            (directory/"request.txt").write_text("原提示词和修改意见",encoding="utf-8")
            with patch.object(worker,"progress"): return worker.rewrite_prompt(server,directory)
    def test_text_only_readonly_schema_and_final_result(self):
        server=TextServer()
        self.assertEqual(self.run_text(server),{"prompt":"完整修订后的提示词"})
        options=server.calls[0][1]
        self.assertEqual(options["sandbox"],"read-only")
        self.assertFalse(options["config"]["features.image_generation"])
        self.assertFalse(options["config"]["features.shell_tool"])
        self.assertEqual(server.calls[1][1]["outputSchema"]["required"],["prompt"])
        self.assertEqual([item["type"] for item in server.calls[1][1]["input"]],["text"])
        self.assertTrue(server.generation_started)
        self.assertEqual(server.settled,[True])
    def test_invalid_interrupted_and_timeout_keep_original(self):
        for server in [TextServer(reply="[]"),TextServer(reply='{"prompt":""}'),TextServer(status="interrupted"),TextServer(terminal=False)]:
            with self.subTest(server=server):
                with self.assertRaises(worker.BridgeError): self.run_text(server)
                self.assertEqual(len(server.calls),2)
                self.assertEqual(len(server.settled),1)
    def test_submitted_text_task_is_never_replayed_on_connection_error(self):
        server=TextServer()
        server.recycle_after_turn=False
        server.close=lambda:None
        session=worker.WorkerSession.__new__(worker.WorkerSession)
        session.server=server
        session._prepare=lambda force=False:{"connected":True}
        def fail(*args):
            server.generation_started=True
            raise worker.BridgeError("broken","connection_lost","turn",True,True)
        with patch.object(worker,"rewrite_prompt",side_effect=fail) as run:
            with self.assertRaises(worker.BridgeError):session.execute("rewrite-prompt",Path("."))
            self.assertEqual(run.call_count,1)
if __name__=="__main__":unittest.main()
