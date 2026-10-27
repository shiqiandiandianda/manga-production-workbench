import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import tempfile
from unittest.mock import patch
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"python"))
import codex_worker

class VirtualDriveReferenceTest(unittest.TestCase):
    @staticmethod
    def unsupported_volume():
        error=OSError('virtual volume final-path query unavailable')
        error.winerror=1005
        return error

    def test_explicit_reference_can_be_read_when_final_path_query_is_unsupported(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'中文 空格参考.png'
            file.write_bytes(b'original reference bytes')
            with patch.object(Path,'resolve',side_effect=self.unsupported_volume()):
                self.assertEqual(codex_worker.reference_path(file),Path(os.path.abspath(file)))
                self.assertEqual(codex_worker.ReferenceDigestCache().digest(file),codex_worker.hashlib.sha256(file.read_bytes()).hexdigest())
                items=codex_worker.path_turn_inputs('prompt',[file])
                self.assertIn(str(Path(os.path.abspath(file))),json.loads(items[0]['text'].split('\n')[-1]))

    def test_other_os_errors_are_not_hidden(self):
        error=PermissionError('denied')
        error.winerror=5
        with patch.object(Path,'resolve',side_effect=error):
            with self.assertRaises(PermissionError):codex_worker.reference_path('missing.png')

    def test_missing_files_still_fail_on_unsupported_volume(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(Path,'resolve',side_effect=self.unsupported_volume()):
                with self.assertRaises(FileNotFoundError):codex_worker.reference_path(Path(temp)/'missing.png')

    def test_output_validation_retains_strict_resolution(self):
        with patch.object(Path,'resolve',side_effect=self.unsupported_volume()):
            with self.assertRaises(OSError):codex_worker.verify_saved_path('output.png',Path('.'))

class WorkerEncodingTest(unittest.TestCase):
    def test_jsonl_stays_utf8_with_windows_legacy_encoding(self):
        worker=Path(__file__).resolve().parents[1]/"python"
        source="import sys;sys.path.insert(0,sys.argv[1]);from codex_worker import emit;emit({'message':'GPT Image 正在生成镜头图片'})"
        result=subprocess.run([sys.executable,"-c",source,str(worker)],env={**os.environ,"PYTHONIOENCODING":"gbk"},capture_output=True,check=True)
        self.assertEqual(json.loads(result.stdout.decode("utf-8"))["message"],"GPT Image 正在生成镜头图片")

class FirstImageCompletionTest(unittest.TestCase):
    def test_valid_native_image_completes_without_waiting_for_another_generation(self):
        with tempfile.TemporaryDirectory(prefix="comic-worker-test-") as temp:
            directory=Path(temp)
            original=directory/"native.png"
            Image.new("RGB",(6,4),(30,60,90)).save(original)
            (directory/"input.json").write_text(json.dumps({"action":"generate","referenceFiles":[]}),encoding="utf-8")
            (directory/"request.txt").write_text("native image test",encoding="utf-8")
            class Server:
                def __init__(self):self.calls=[]
                def rpc(self,method,params,timeout=30):
                    self.calls.append((method,params))
                    if method=="thread/start":return {"thread":{"id":"test-thread"}}
                    if method=="turn/start":return {"turn":{"id":"test-turn"}}
                    return {}
                def events(self):
                    yield {"method":"item/completed","params":{"threadId":"test-thread","turnId":"test-turn","item":{"type":"imageGeneration","status":"completed","savedPath":str(original)}}}
                    raise AssertionError("worker waited beyond the first completed native image")
            server=Server()
            with patch.object(codex_worker,"emit"):
                codex_worker.generate(server,directory)
            manifest=json.loads((directory/"result.json").read_text("utf-8"))
            self.assertTrue(manifest["imageToolSeen"])
            self.assertEqual(Path(manifest["savedPath"]).read_bytes(),original.read_bytes())
            self.assertEqual(Path(manifest["savedPath"]).resolve(), original.resolve())
            self.assertEqual(list((directory/"out").iterdir()), [])
            self.assertEqual(server.calls[-1],("turn/interrupt",{"threadId":"test-thread","turnId":"test-turn"}))

    def test_path_input_has_no_image_attachment_and_preserves_chinese_paths(self):
        with tempfile.TemporaryDirectory(prefix="comic-worker-test-") as temp:
            file=Path(temp)/"中文 参考.png"
            Image.new("RGB",(6,4),(30,60,90)).save(file)
            items=codex_worker.path_turn_inputs("view_image required",[file],"imagegen/SKILL.md")
            self.assertEqual([item["type"] for item in items],["text","skill"])
            self.assertNotIn("localImage", json.dumps(items))
            self.assertNotIn("base64", json.dumps(items))
            self.assertIn(str(file.resolve()),json.loads(items[0]["text"].split("\n")[-1]))



# Fake only the transport; receive, account invalidation, drain and settle_turn
# remain the production methods. No Codex process or generation is started.
from collections import deque
import queue
from unittest.mock import Mock


def fake_app_server(image=None, before_events=(), turn_error=None):
    server = codex_worker.AppServer.__new__(codex_worker.AppServer)
    server.messages = queue.Queue()
    server.notifications = deque()
    server.sequence = 0
    server.account_cache = None
    server.generation_started = False
    server.recycle_after_turn = False
    server.send = Mock()
    server.close = Mock()
    server.account = {"type": "chatgpt"}
    server.thread_count = 0
    server.records = []

    def reply(method, params, timeout=30):
        server.records.append((method, params, timeout))
        if method == "account/read":
            return {"account": server.account}
        if method == "thread/start":
            server.thread_count += 1
            server.thread_id = f"thread-{server.thread_count}"
            server.directory = Path(params["cwd"])
            return {"thread": {"id": server.thread_id}}
        if method == "turn/start":
            if turn_error:
                raise turn_error
            server.turn_id = f"turn-{server.thread_count}"
            return {"turn": {"id": server.turn_id}}
        if method == "turn/interrupt":
            server.notifications.append({"method": "turn/completed", "params": {"threadId": server.thread_id, "turn": {"id": server.turn_id, "status": "interrupted"}}})
        return {}

    def events():
        yield from before_events
        yield {"method": "item/completed", "params": {"threadId": server.thread_id, "turnId": server.turn_id, "item": {"type": "imageGeneration", "status": "completed", "savedPath": str(image or server.directory / "native.png")}}}
        raise AssertionError("events consumed after first native image")

    server.rpc = Mock(side_effect=reply)
    server.events = events
    return server


def write_task(directory, references=()):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "input.json").write_text(json.dumps({"action": "generate", "referenceFiles": [str(p) for p in references]}), encoding="utf-8")
    (directory / "request.txt").write_text("mock native generation", encoding="utf-8")


def write_image(filename):
    Image.new("RGB", (6, 4), (30, 60, 90)).save(filename)
    return filename


class PersistentWorkerTest(unittest.TestCase):
    def setUp(self):
        quiet = patch.object(codex_worker, "emit")
        quiet.start()
        self.addCleanup(quiet.stop)

    def test_connection_probe_uses_same_thread_setup_but_never_starts_a_turn(self):
        with tempfile.TemporaryDirectory(prefix="connection-fake-") as temp:
            server = fake_app_server()
            session = codex_worker.WorkerSession(["fake"], server_factory=Mock(return_value=server))
            self.addCleanup(session.close)
            result = session.execute("probe", Path(temp), force=True)
            self.assertTrue(result["sessionReady"])
            self.assertFalse(result["turnStartSent"])
            methods = [m for m, _, _ in server.records]
            self.assertEqual(methods, ["account/read", "thread/start", "thread/unsubscribe"])
            self.assertFalse((Path(temp) / "input.json").exists())

    def test_low_commit_memory_stops_before_starting_codex_or_sending_a_turn(self):
        with patch.object(codex_worker, "available_commit_mb", return_value=100), patch.object(codex_worker.subprocess, "Popen") as start:
            with self.assertRaises(codex_worker.BridgeError) as raised:
                codex_worker.AppServer(["fake"])
            self.assertEqual(raised.exception.code, "system_memory_low")
            self.assertFalse(raised.exception.may_have_started)
            self.assertFalse(raised.exception.retryable)
            start.assert_not_called()

    def test_closed_transport_reports_rpc_stage_exit_code_and_redacts_stderr(self):
        server = fake_app_server()
        server.current_stage = "thread/start"
        server.process = Mock()
        server.process.poll.return_value = 3221225495
        server.stderr = "memory allocation failed; Bearer secret-example"
        server.messages.put({"_closed": True})
        with self.assertRaises(codex_worker.BridgeError) as raised:
            server.receive(.01)
        self.assertEqual(raised.exception.stage, "thread/start")
        self.assertIn("3221225495", str(raised.exception))
        self.assertIn("memory allocation failed", str(raised.exception))
        self.assertNotIn("secret-example", str(raised.exception))

    def test_status_reuses_connection_force_refreshes_and_account_update_invalidates(self):
        server = fake_app_server()
        factory = Mock(return_value=server)
        session = codex_worker.WorkerSession(["fake"], server_factory=factory)
        self.addCleanup(session.close)
        self.assertTrue(session.execute("status")["connected"])
        server.account = None
        self.assertTrue(session.execute("status")["cached"])
        self.assertFalse(session.execute("status", force=True)["connected"])
        server.account = {"type": "chatgpt"}
        server.messages.put({"method": "account/updated", "params": {}})
        result = session.execute("status")
        self.assertTrue(result["connected"])
        self.assertNotIn("cached", result)
        factory.assert_called_once()
        reads = [entry for entry in server.records if entry[0] == "account/read"]
        self.assertEqual(len(reads), 3)
        self.assertTrue(all(entry[2] == 30 for entry in reads))

    def test_queue_empty_becomes_typed_rpc_or_generation_timeout(self):
        for stage, code in (("account/read", "app_server_timeout"), ("image_generation", "image_generation_timeout")):
            with self.subTest(stage=stage):
                server = fake_app_server()
                server.messages = Mock()
                server.messages.get.side_effect = queue.Empty
                with self.assertRaises(codex_worker.BridgeError) as raised:
                    if stage == "account/read":
                        codex_worker.AppServer.rpc(server, stage, {}, timeout=30)
                    else:
                        list(codex_worker.AppServer.events(server, timeout=0.1))
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(raised.exception.stage, stage)
                self.assertTrue(str(raised.exception))
                self.assertEqual(raised.exception.may_have_started, stage == "image_generation")
                if stage == "account/read":
                    self.assertIn("30 秒", str(raised.exception))
                    self.assertGreater(server.messages.get.call_args.kwargs["timeout"], 29)

    def test_workspace_routing_rpc_error_keeps_diagnostic_and_30_second_budget(self):
        server = fake_app_server()
        server.rpc = Mock(wraps=lambda *args, **kwargs: codex_worker.AppServer.rpc(server, *args, **kwargs))
        diagnostic = "workspace routing discovery timed out: route discovery service unavailable"
        server.messages.put({"id": 1, "error": {"code": -32000, "message": diagnostic}})
        with self.assertRaises(codex_worker.BridgeError) as raised:
            codex_worker.account_status(server)
        event = codex_worker.error_event(raised.exception)
        self.assertEqual(event["code"], "workspace_routing_timeout")
        self.assertEqual(event["stage"], "account/read")
        self.assertTrue(event["retryable"])
        self.assertFalse(event["mayHaveStarted"])
        self.assertIn(diagnostic, event["message"])
        server.rpc.assert_called_once_with("account/read", {"refreshToken": False}, timeout=30)
        self.assertIsNone(server.account_cache)

    def test_server_reused_but_every_shot_has_a_distinct_ephemeral_thread(self):
        with tempfile.TemporaryDirectory(prefix="comic-worker-test-") as temp:
            directories = [Path(temp) / "one", Path(temp) / "two"]
            for directory in directories:
                write_task(directory)
                write_image(directory / "native.png")
            server = fake_app_server()
            factory = Mock(return_value=server)
            session = codex_worker.WorkerSession(["fake"], server_factory=factory)
            self.addCleanup(session.close)
            results = [session.execute("generate", directory) for directory in directories]
            factory.assert_called_once()
            starts = [p for method, p, _ in server.records if method == "thread/start"]
            turns = [p for method, p, _ in server.records if method == "turn/start"]
            self.assertEqual(len(starts), 2)
            self.assertTrue(all(p["ephemeral"] is True for p in starts))
            self.assertEqual([p["cwd"] for p in starts], [str(d.resolve()) for d in directories])
            self.assertEqual([p["threadId"] for p in turns], ["thread-1", "thread-2"])
            self.assertNotEqual(results[0]["savedPath"], results[1]["savedPath"])
            self.assertEqual([m for m, _, _ in server.records].count("account/read"), 1)
            self.assertEqual([m for m, _, _ in server.records].count("thread/unsubscribe"), 2)
            server.close.assert_not_called()

    def test_old_or_unidentified_image_and_turn_completion_events_are_ignored(self):
        with tempfile.TemporaryDirectory(prefix="comic-worker-test-") as temp:
            directory = Path(temp)
            write_task(directory)
            original = write_image(directory / "native.png")
            stale = []
            for ids in ({"threadId": "old-thread", "turnId": "turn-1"}, {"threadId": "thread-1", "turnId": "old-turn"}, {"threadId": "thread-1"}, {"turnId": "turn-1"}):
                stale.append({"method": "item/completed", "params": {**ids, "item": {"type": "imageGeneration", "savedPath": str(directory / "missing.png")}}})
                stale.append({"method": "turn/completed", "params": {**ids, "turn": {"status": "completed"}}})
            result = codex_worker.generate(fake_app_server(original, stale), directory)
            self.assertEqual(Path(result["savedPath"]).read_bytes(), original.read_bytes())
            logged = [json.loads(line) for line in (directory / "app-server-events.jsonl").read_text("utf-8").splitlines()]
            self.assertEqual(len(logged), 1)
            self.assertEqual(logged[0]["threadId"], "thread-1")
            self.assertEqual(logged[0]["turnId"], "turn-1")

    def test_outside_damaged_and_reference_images_are_rejected_after_interrupt_and_cleanup(self):
        for kind, code in (("outside", "generation_failed"), ("damaged", "generation_failed"), ("reference", "reference_image_reused")):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory(prefix="comic-worker-test-") as temp:
                root = Path(temp)
                directory = root / "job"
                write_task(directory)
                original = root / "outside.png" if kind == "outside" else directory / "native.png"
                if kind == "damaged":
                    original.write_bytes(b"not a decoded image")
                else:
                    write_image(original)
                if kind == "reference":
                    write_task(directory, [original])
                before = original.read_bytes()
                server = fake_app_server(original)
                with patch.dict(os.environ, {"CODEX_HOME": str(root / "codex-home")}), self.assertRaises(codex_worker.BridgeError) as raised:
                    codex_worker.generate(server, directory)
                self.assertEqual(raised.exception.code, code)
                self.assertTrue(raised.exception.may_have_started)
                methods = [m for m, _, _ in server.records]
                self.assertEqual(methods.count("turn/interrupt"), 1)
                self.assertEqual(methods[-1], "thread/unsubscribe")
                self.assertFalse(server.recycle_after_turn)
                self.assertEqual(original.read_bytes(), before)
                self.assertFalse((directory / "result.json").exists())

    def test_prepare_reconnects_at_most_once(self):
        failure = codex_worker.BridgeError("routing unavailable", "workspace_routing_timeout", "initialize", True)
        for recover in (True, False):
            with self.subTest(recover=recover):
                factory = Mock(side_effect=[failure, fake_app_server()] if recover else failure)
                session = codex_worker.WorkerSession(["fake"], server_factory=factory)
                try:
                    if recover:
                        self.assertTrue(session.execute("status")["connected"])
                    else:
                        with self.assertRaises(codex_worker.BridgeError):
                            session.execute("status")
                    self.assertEqual(factory.call_count, 2)
                finally:
                    session.close()

    def test_sent_turn_start_is_not_retried_when_response_is_lost(self):
        with tempfile.TemporaryDirectory(prefix="comic-worker-test-") as temp:
            directory = Path(temp)
            write_task(directory)
            failure = codex_worker.BridgeError("turn/start response lost", "app_server_timeout", "turn/start", True, True)
            server = fake_app_server(turn_error=failure)
            factory = Mock(return_value=server)
            session = codex_worker.WorkerSession(["fake"], server_factory=factory)
            with self.assertRaises(codex_worker.BridgeError) as raised:
                session.execute("generate", directory)
            self.assertIs(raised.exception, failure)
            factory.assert_called_once()
            self.assertEqual([m for m, _, _ in server.records].count("turn/start"), 1)
            server.close.assert_called_once()
            self.assertIsNone(session.server)
            self.assertTrue(server.recycle_after_turn)
            self.assertFalse((directory / "result.json").exists())

    def test_settle_turn_recycles_unconfirmed_and_unsubscribes_only_confirmed_turns(self):
        for confirmed in (True, False):
            with self.subTest(confirmed=confirmed):
                server = fake_app_server()
                server.rpc = Mock(return_value={})
                server.receive = Mock(side_effect=queue.Empty)
                server.notifications.append({"method": "turn/completed", "params": {"threadId": "old-thread", "turnId": "turn-1"}})
                if confirmed:
                    server.notifications.append({"method": "turn/completed", "params": {"threadId": "thread-1", "turn": {"id": "turn-1"}}})
                server.settle_turn("thread-1", "turn-1", interrupt_requested=True)
                self.assertEqual(server.recycle_after_turn, not confirmed)
                if confirmed:
                    server.rpc.assert_called_once_with("thread/unsubscribe", {"threadId": "thread-1"}, timeout=10)
                else:
                    server.rpc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
