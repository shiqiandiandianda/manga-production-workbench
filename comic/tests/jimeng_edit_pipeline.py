import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "python"))
sys.path.insert(0, str(PROJECT / "tests"))
import codex_worker
from test_codex_worker import fake_app_server

class LocalSnapshotEditTest(unittest.TestCase):
    def test_edit_uses_only_local_snapshot_and_never_allocates_full_long_page(self):
        with tempfile.TemporaryDirectory(prefix="jimeng-python-test-", dir=PROJECT / ".runtime") as temporary:
            directory = Path(temporary)
            base = directory / "base_panel.png"
            generated = directory / "generated.png"
            Image.new("RGB", (20, 20), (10, 20, 30)).save(base)
            Image.new("RGB", (20, 20), (60, 100, 140)).save(generated)
            task = {"action": "edit", "basePanelPath": str(base), "cropBox": [0, 70000, 20, 20], "editPrompt": "修改光线", "referenceFiles": []}
            (directory / "input.json").write_text(json.dumps(task), encoding="utf-8")
            (directory / "request.txt").write_text("mock local edit", encoding="utf-8")
            server = fake_app_server(generated)
            with patch.object(codex_worker, "emit"):
                manifest = codex_worker.generate(server, directory)
            self.assertTrue(Path(manifest["alignedPath"]).is_file())
            self.assertNotIn("repairedPagePath", manifest)
            self.assertFalse((directory / "out" / "repaired_page.png").exists())
            turn = next(params for method, params, _ in server.records if method == "turn/start")
            image = next(item for item in turn["input"] if item["type"] == "localImage")
            self.assertEqual(Path(image["path"]), base.resolve())

    def test_crop_metadata_must_match_local_snapshot(self):
        with tempfile.TemporaryDirectory(prefix="jimeng-python-test-", dir=PROJECT / ".runtime") as temporary:
            directory = Path(temporary)
            base = directory / "base_panel.png"
            Image.new("RGB", (20, 20)).save(base)
            (directory / "input.json").write_text(json.dumps({"action": "edit", "basePanelPath": str(base), "cropBox": [0, 70000, 30, 20]}), encoding="utf-8")
            (directory / "request.txt").write_text("mock local edit", encoding="utf-8")
            with patch.object(codex_worker, "emit"):
                with self.assertRaisesRegex(ValueError, "快照尺寸"):
                    codex_worker.generate(fake_app_server(base), directory)

if __name__ == "__main__":
    unittest.main()
