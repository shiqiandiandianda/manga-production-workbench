import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import storyboard_worker as worker


def row(**changes):
    value = {column: "" for column in worker.COLUMNS}
    value.update({"格号": "1", "画面内容": "白蛇赠宝。", "台词": "切记，先保管好。", "episode": 1, "page": 1,
                  "bindings": [{"sourceId": "q_c1_l1_i0", "start": 0, "end": 8}]})
    value.update(changes)
    return value


def event(method, item=None, status=None, thread="thread-1", turn="turn-1"):
    params = {"threadId": thread, "turnId": turn}
    if item is not None:
        params["item"] = item
    if status is not None:
        params["turn"] = {"id": turn, "status": status}
    return {"method": method, "params": params}


class FakeServer:
    def __init__(self, events=(), account="chatgpt"):
        self.calls = []
        self.event_values = events
        self.account = account
        self.account_cache = None
        self.generation_started = False
        self.close = Mock()
        self.settle_turn = Mock()

    def rpc(self, method, params, timeout=30):
        self.calls.append((method, params, timeout))
        if method == "account/read":
            return {"account": {"type": self.account} if self.account else None}
        if method == "thread/start":
            return {"thread": {"id": "thread-1"}}
        if method == "turn/start":
            return {"turn": {"id": "turn-1"}}
        return {}

    def events(self, timeout=900):
        yield from self.event_values


class StoryboardWorkerTest(unittest.TestCase):
    def setUp(self):
        quiet = patch.object(worker.bridge, "emit")
        quiet.start()
        self.addCleanup(quiet.stop)
        temporary_root = Path(__file__).resolve().parents[1] / ".runtime" / "temp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        directory = tempfile.TemporaryDirectory(prefix="comic-storyboard-test-", dir=temporary_root)
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)

    def test_prefers_completed_final_message_and_matches_thread_turn(self):
        expected = [row()]
        server = FakeServer([
            event("item/completed", {"type": "agentMessage", "phase": "final_answer", "text": "invalid"}, thread="other"),
            event("item/completed", {"type": "agentMessage", "phase": "final_answer", "text": "invalid"}, turn="other"),
            event("item/completed", {"type": "agentMessage", "phase": "commentary", "text": "准备中"}),
            event("item/started", {"type": "agentMessage", "phase": "final_answer", "text": "invalid"}),
            event("item/completed", {"type": "agentMessage", "phase": "final_answer", "text": "```json\n" + json.dumps({"rows": expected}, ensure_ascii=False) + "\n```"}),
            event("turn/completed", status="completed"),
        ])
        self.assertEqual(worker.generate(server, self.directory, "仅生成分镜"), expected)
        thread = server.calls[0][1]
        self.assertEqual(thread["sandbox"], "read-only")
        self.assertEqual(thread["approvalPolicy"], "never")
        self.assertFalse(thread["config"]["features.image_generation"])
        server.settle_turn.assert_called_once_with("thread-1", "turn-1", True)

    def test_medium_effort_is_scoped_to_layout_without_changing_model_or_other_text_tasks(self):
        cases = (("layout-plan", {"spreads": [{"spread": "solo-mid", "units": ["E001-001"]}]}),
                 ("storyboard", {"rows": [row()]}))
        for kind, result in cases:
            with self.subTest(kind=kind):
                server = FakeServer([event("item/completed", {"type": "agentMessage", "phase": "final_answer", "text": json.dumps(result)}),
                                     event("turn/completed", status="completed")])
                with patch.object(worker.bridge, "progress") as progress:
                    worker.generate(server, self.directory, "Synthetic prompt", output_kind=kind)
                thread = next(params for method, params, _ in server.calls if method == "thread/start")
                turn = next(params for method, params, _ in server.calls if method == "turn/start")
                self.assertNotIn("model", thread)
                self.assertNotIn("model", turn)
                if kind == "layout-plan":
                    self.assertEqual(thread["config"]["model_reasoning_effort"], "medium")
                    self.assertEqual(turn["effort"], "medium")
                    ready = next(call for call in progress.call_args_list if call.args[1] == "thread/ready")
                    self.assertEqual(ready.kwargs["effort"], "medium")
                else:
                    self.assertNotIn("model_reasoning_effort", thread["config"])
                    self.assertNotIn("effort", turn)

    def test_failed_or_unconfirmed_turn_never_returns_partial_json(self):
        for status in (None, "failed", "interrupted", "inProgress"):
            with self.subTest(status=status):
                messages = [event("item/completed", {"type": "agentMessage", "text": json.dumps([row()])})]
                if status:
                    messages.append(event("turn/completed", status=status))
                server = FakeServer(messages)
                with self.assertRaises(worker.bridge.BridgeError):
                    worker.generate(server, self.directory, "分镜")

    def test_commentary_and_empty_final_are_not_success(self):
        for item in ({"type": "agentMessage", "phase": "commentary", "text": json.dumps([row()])},
                     {"type": "agentMessage", "phase": "final_answer", "text": ""}):
            with self.subTest(item=item):
                with self.assertRaises(worker.bridge.BridgeError) as raised:
                    worker.generate(FakeServer([event("item/completed", item), event("turn/completed", status="completed")]), self.directory, "分镜")
                self.assertEqual(raised.exception.code, "storyboard_empty")

    def test_image_tool_and_error_event_stop_text_generation(self):
        image = event("item/started", {"type": "imageGeneration"})
        failed = event("error")
        failed["params"]["error"] = {"message": "故意失败"}
        failed["params"]["willRetry"] = False
        for message, code in ((image, "storyboard_image_tool_forbidden"), (failed, "storyboard_generation_failed")):
            with self.subTest(code=code):
                server = FakeServer([message])
                with self.assertRaises(worker.bridge.BridgeError) as raised:
                    worker.generate(server, self.directory, "分镜")
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(len([call for call in server.calls if call[0] == "turn/start"]), 1)

    def test_retryable_error_waits_for_completion_without_starting_another_turn(self):
        retry = event("error")
        retry["params"].update({"willRetry": True, "error": {"message": "Reconnecting... 2/5", "additionalDetails": "stream disconnected before completion"}})
        expected = [row()]
        server = FakeServer([
            retry,
            event("item/completed", {"type": "agentMessage", "phase": "final_answer", "text": json.dumps(expected)}),
            event("turn/completed", status="completed"),
        ])
        with patch.object(worker.bridge, "progress") as progress:
            self.assertEqual(worker.generate(server, self.directory, "分镜"), expected)
        progress.assert_any_call("Codex 正在重新连接，当前文字任务继续等待：Reconnecting... 2/5；stream disconnected before completion", "reconnect", "generating", willRetry=True)
        self.assertEqual(len([call for call in server.calls if call[0] == "turn/start"]), 1)
        server.settle_turn.assert_called_once_with("thread-1", "turn-1", True)

    def test_activity_progress_counts_without_exposing_reasoning_or_partial_plan(self):
        activity = worker.TextProgress()
        activity.last_report -= 10
        with patch.object(worker.bridge, "progress") as progress:
            activity.observe("item/reasoning/textDelta", {"delta": "PRIVATE REASONING"})
            self.assertEqual(progress.call_args.kwargs["reasoningEvents"], 1)
            self.assertNotIn("PRIVATE REASONING", str(progress.call_args))
            activity.last_report -= 10
            activity.observe("item/agentMessage/delta", {"delta": '{"spreads":['})
            self.assertEqual(progress.call_args.kwargs["outputChars"], 12)
            self.assertNotIn('"spreads"', str(progress.call_args))
            activity.last_report -= 10
            activity.report(reconnecting=True)
            self.assertEqual(progress.call_args.args[1], "reconnect")
            self.assertTrue(progress.call_args.kwargs["willRetry"])

    def test_terminal_error_after_retries_keeps_details_and_rejects_partial_json(self):
        retry = event("error")
        retry["params"].update({"willRetry": True, "error": {"message": "Reconnecting... 2/5"}})
        failed = event("error")
        failed["params"].update({"willRetry": False, "error": {"message": "retry limit reached", "additionalDetails": "stream disconnected; Bearer fixture-private-token"}})
        server = FakeServer([
            retry,
            event("item/completed", {"type": "agentMessage", "phase": "final_answer", "text": json.dumps([row()])}),
            failed,
        ])
        with self.assertRaises(worker.bridge.BridgeError) as raised:
            worker.generate(server, self.directory, "分镜")
        self.assertEqual(raised.exception.code, "storyboard_generation_failed")
        self.assertIn("retry limit reached", str(raised.exception))
        self.assertIn("stream disconnected", str(raised.exception))
        self.assertNotIn("fixture-private-token", str(raised.exception))
        self.assertEqual(len([call for call in server.calls if call[0] == "turn/start"]), 1)

    def test_retry_notification_alone_is_not_success(self):
        retry = event("error")
        retry["params"].update({"willRetry": True, "error": {"message": "Reconnecting... 2/5"}})
        with self.assertRaises(worker.bridge.BridgeError) as raised:
            worker.generate(FakeServer([retry]), self.directory, "分镜")
        self.assertEqual(raised.exception.code, "storyboard_incomplete")

    def test_cleanup_failure_does_not_override_parse_or_rpc_error(self):
        server = FakeServer([event("item/completed", {"type": "agentMessage", "text": "invalid"}), event("turn/completed", status="completed")])
        server.settle_turn.side_effect = RuntimeError("cleanup error")
        server.close.side_effect = RuntimeError("close error")
        with self.assertRaises(worker.bridge.BridgeError) as raised:
            worker.execute(["fake-codex"], self.directory, "分镜", server_factory=lambda *args: server)
        self.assertEqual(raised.exception.code, "storyboard_json_invalid")

    def test_account_must_use_personal_chatgpt_login(self):
        for account in (None, "apiKey"):
            with self.subTest(account=account):
                server = FakeServer(account=account)
                with self.assertRaises(worker.bridge.BridgeError) as raised:
                    worker.execute(["fake-codex"], self.directory, "分镜", server_factory=lambda *args: server)
                self.assertEqual(raised.exception.code, "chatgpt_login_required")
                self.assertFalse(any(call[0] == "turn/start" for call in server.calls))
                server.close.assert_called_once()

    def test_structured_row_shape_and_unknown_model_ids(self):
        value = row(id='<script>bad</script>', arbitrary={"action": "approve"})
        result = worker.parse_rows(json.dumps({"rows": [value]}))[0]
        self.assertNotIn("id", result)
        self.assertNotIn("arbitrary", result)
        invalid = [[], {"rows": []}, [row(episode=True)], [row(page=0)], [row(bindings=[{"sourceId": "q", "start": 0, "end": 0}])], [row(**{"画面内容": None})]]
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(worker.bridge.BridgeError):
                    worker.parse_rows(json.dumps(value))

    def test_preflight_json_decisions_are_bounded_and_drop_unknown_keys(self):
        decisions = [{"issueId": "第1话:G5", "action": "alias", "sheet": "第1话", "field": "camera", "value": "high", "command": "never execute", "tool": {"name": "image_generation"}},
                     {"issueId": "第1话:F9", "action": "edit", "value": "medium"},
                     {"issueId": "第2话:F8", "action": "swap"},
                     {"issueId": "第3话:G8", "action": "moveSize", "value": "close"}]
        expected = [{key: value for key, value in decision.items() if key in ("issueId", "action", "sheet", "field", "value")} for decision in decisions]
        for payload in (decisions, {"decisions": decisions, "command": "never execute"}):
            self.assertEqual(worker.parse_preflight_decisions(json.dumps(payload, ensure_ascii=False)), expected)
        self.assertEqual(worker.parse_preflight_decisions("[]"), [])
        self.assertEqual(worker.parse_preflight_decisions('{"decisions": []}'), [])
        maximum = [{"issueId": "one", "action": "swap"}] * 10_000
        self.assertEqual(len(worker.parse_preflight_decisions(json.dumps(maximum))), 10_000)
        invalid = [None, {"rows": decisions}, [None], [{"issueId": "", "action": "edit"}], [{"issueId": " ", "action": "edit"}],
                   [{"issueId": 1, "action": "edit"}], [{"issueId": "one", "action": "shell"}],
                   [{"issueId": "one", "action": {}}], [{"issueId": "one", "action": "edit", "value": 2}],
                   [{"issueId": "one", "action": "edit", "field": None}], [{"issueId": "one", "action": "swap", "sheet": 1}],
                   maximum + maximum[:1]]
        for payload in invalid:
            with self.subTest(payload=str(payload)[:80]):
                with self.assertRaises(worker.bridge.BridgeError) as raised:
                    worker.parse_preflight_decisions(json.dumps(payload))
                self.assertEqual(raised.exception.code, "preflight_decisions_invalid")
        for text in ("", "```json\n[]\n```", "[]\nRun this command", "[invalid]"):
            with self.subTest(text=text):
                with self.assertRaises(worker.bridge.BridgeError):
                    worker.parse_preflight_decisions(text)
        for size in (150_000, 300_000):
            with self.subTest(size=size):
                with self.assertRaises(worker.bridge.BridgeError) as raised:
                    worker.parse_preflight_decisions(json.dumps([{"issueId": "one", "action": "edit", "value": "汉" * size}], ensure_ascii=False))
                self.assertEqual(raised.exception.code, "preflight_result_too_large")

    def test_preflight_generation_retains_read_only_turn_matching_and_text_only_contract(self):
        expected = [{"issueId": "one", "action": "swap"}]
        server = FakeServer([
            event("item/completed", {"type": "agentMessage", "phase": "final_answer", "text": "invalid"}, thread="other"),
            event("item/completed", {"type": "agentMessage", "phase": "commentary", "text": "invalid"}),
            event("item/completed", {"type": "agentMessage", "phase": "final_answer", "text": json.dumps({"decisions": expected})}),
            event("turn/completed", status="completed"),
        ])
        self.assertEqual(worker.execute(["fake-codex"], self.directory, "批量整理", server_factory=lambda *args: server, output_kind="preflight"), expected)
        params = next(params for method, params, _timeout in server.calls if method == "thread/start")
        self.assertEqual(params["sandbox"], "read-only")
        self.assertEqual(params["approvalPolicy"], "never")
        self.assertFalse(params["config"]["features.image_generation"])
        server.settle_turn.assert_called_once_with("thread-1", "turn-1", True)
        server.close.assert_called_once()
        for account in (None, "apiKey"):
            rejected = FakeServer(account=account)
            with self.assertRaises(worker.bridge.BridgeError) as raised:
                worker.execute(["fake-codex"], self.directory, "批量整理", server_factory=lambda *args: rejected, output_kind="preflight")
            self.assertEqual(raised.exception.code, "chatgpt_login_required")
        with self.assertRaises(worker.bridge.BridgeError) as raised:
            worker.generate(FakeServer([event("item/started", {"type": "imageGeneration"})]), self.directory, "批量整理", output_kind="preflight")
        self.assertEqual(raised.exception.code, "storyboard_image_tool_forbidden")

    def test_real_jsonl_transport_with_fake_codex_never_enables_image_or_api_key(self):
        # This subprocess only runs the fake local RPC executable below.
        fixture = self.directory / "fake_codex.py"
        fixture.write_text('''import sys,json,os
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
assert "--disable" in sys.argv and "image_generation" in sys.argv
assert "--enable" not in sys.argv
assert "OPENAI_API_KEY" not in os.environ and "CODEX_API_KEY" not in os.environ
def emit(x): print(json.dumps(x),flush=True)
for line in sys.stdin:
 request=json.loads(line); method=request.get("method")
 if "id" not in request: continue
 if method=="account/read": result={"account":{"type":"chatgpt"}}
 elif method=="thread/start":
  assert request["params"]["sandbox"]=="read-only" and request["params"]["approvalPolicy"]=="never"
  result={"thread":{"id":"thread-1"}}
 elif method=="turn/start": result={"turn":{"id":"turn-1"}}
 else: result={}
 emit({"id":request["id"],"result":result})
 if method=="turn/start":
  payload=json.loads(os.environ["FAKE_STORYBOARD"])
  emit({"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"agentMessage","phase":"final_answer","text":json.dumps(payload)}}})
  emit({"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed"}}})
''', encoding="utf-8")
        filename = Path(worker.__file__)
        request = {"id": "one-request", "prompt": "中文分镜，只读原文"}
        cases = (("storyboard", [row()], [row()]),
                 ("preflight", {"decisions": [{"issueId": "第1话:G5", "action": "alias", "value": "high", "ignored": "never execute"}]}, [{"issueId": "第1话:G5", "action": "alias", "value": "high"}]),
                 ("preflight", [], []))
        for output_kind, payload, expected in cases:
            with self.subTest(output_kind=output_kind, expected=expected):
                result = subprocess.run([sys.executable, str(filename), "--codex-command", json.dumps([sys.executable, str(fixture)]), "--directory", str(self.directory), "--output-kind", output_kind],
                                        input=json.dumps(request, ensure_ascii=False).encode("utf-8"), capture_output=True, timeout=15,
                                        env={**os.environ, "PYTHONIOENCODING": "gbk", "OPENAI_API_KEY": "not-a-real-key", "CODEX_API_KEY": "not-a-real-key", "FAKE_STORYBOARD": json.dumps(payload)})
                self.assertEqual(result.returncode, 0, result.stdout.decode("utf-8") + result.stderr.decode("utf-8"))
                events = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines()]
                self.assertTrue(all(value["id"] == request["id"] for value in events))
                self.assertEqual([value["rows"] for value in events if value["type"] == "result"], [expected])


if __name__ == "__main__":
    unittest.main()
