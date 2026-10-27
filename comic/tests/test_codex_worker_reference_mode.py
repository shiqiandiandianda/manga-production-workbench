import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import codex_worker


def run_generation(mode):
    with tempfile.TemporaryDirectory(prefix="comic-worker-mode-") as temp:
        directory = Path(temp)
        original = directory / "native.png"
        reference = directory / "reference.png"
        Image.new("RGB", (6, 4), (30, 60, 90)).save(original)
        Image.new("RGB", (6, 4), (90, 60, 30)).save(reference)
        task = {"action": "generate", "referenceFiles": [str(reference)]}
        if mode:
            task["referenceMode"] = mode
        (directory / "input.json").write_text(json.dumps(task), encoding="utf-8")
        (directory / "request.txt").write_text("mode test", encoding="utf-8")

        class Server:
            def __init__(self):
                self.calls = []

            def rpc(self, method, params, timeout=30):
                self.calls.append((method, params))
                if method == "thread/start":
                    return {"thread": {"id": "t"}}
                if method == "turn/start":
                    return {"turn": {"id": "u"}}
                return {}

            def events(self):
                yield {"method": "item/completed", "params": {"threadId": "t", "turnId": "u", "item": {"type": "imageGeneration", "savedPath": str(original)}}}

        server = Server()
        with patch.object(codex_worker, "emit"):
            codex_worker.generate(server, directory)
        prompt = next(params for method, params in server.calls if method == "turn/start")["input"][0]["text"]
        manifest = json.loads((directory / "result.json").read_text("utf-8"))
        return prompt, manifest


class ReferenceModeTest(unittest.TestCase):
    def test_default_mode_still_inspects_every_reference(self):
        prompt, manifest = run_generation(None)
        self.assertIn("每张参考只查看一次", prompt)
        self.assertEqual(manifest["timings"]["referenceMode"], "view")
        self.assertEqual(manifest["timings"]["referenceCount"], 1)

    def test_direct_mode_hands_paths_to_imagegen_without_viewing(self):
        prompt, manifest = run_generation("direct")
        self.assertIn("不要先查看参考图", prompt)
        self.assertNotIn("每张参考只查看一次", prompt)
        self.assertIn("reference.png", prompt)
        self.assertEqual(manifest["timings"]["referenceMode"], "direct")


class BackgroundRecycleTest(unittest.TestCase):
    def test_result_returns_before_old_app_server_finishes_closing(self):
        import threading
        closing = threading.Event()
        release = threading.Event()

        class SlowServer:
            generation_started = False
            recycle_after_turn = False
            account_cache = {"connected": True}

            def drain(self):
                pass

            def close(self):
                closing.set()
                release.wait(5)

        session = codex_worker.WorkerSession(["codex"], server_factory=lambda *_: SlowServer())

        def fake_generate(server, directory, *_):
            server.recycle_after_turn = True
            return {"timings": {}}

        with tempfile.TemporaryDirectory() as temp, patch.object(codex_worker, "generate", fake_generate), patch.object(codex_worker, "emit"):
            import time
            started = time.monotonic()
            result = session.execute("generate", Path(temp))
            self.assertLess(time.monotonic() - started, 2, "result waited for the old app-server to exit")
            self.assertIn("totalMs", result["timings"])
            self.assertIsNone(session.server)
            self.assertTrue(closing.wait(2))
            release.set()


if __name__ == "__main__":
    unittest.main()
