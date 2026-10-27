import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import storyboard_worker as worker


class DesignContractTests(unittest.TestCase):
    def test_full_plan_is_data_and_unknown_top_level_is_removed(self):
        plan = {"format": "comic-design-plan-v2", "operations": [{"id": "shape", "tool": "panel.contour", "target": {"kind": "unit", "unitId": "E001-001"}, "args": {"reset": True}}], "execute": "never execute this"}
        result = worker.parse_design_plan("```json\n" + json.dumps(plan) + "\n```")
        self.assertNotIn("execute", result)
        self.assertEqual(result["operations"][0]["tool"], "panel.contour")

    def test_invalid_or_oversized_plan_is_rejected(self):
        for value in ("not json", "[]", '{"format":"old"}', json.dumps({"format": "comic-design-plan-v2", "operations": "code"}), "x" * (worker.MAX_RESULT_BYTES + 1)):
            with self.subTest(value=value[:50]), self.assertRaises(worker.bridge.BridgeError):
                worker.parse_design_plan(value)

    def test_existing_absolute_images_only_and_design_channel_only(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "synthetic.png"
            image.write_bytes(b"synthetic image fixture")
            self.assertEqual(worker.design_images([str(image)], "design-plan")[0]["type"], "localImage")
            with self.assertRaises(worker.bridge.BridgeError):
                worker.design_images([str(image)], "storyboard")
            with self.assertRaises(worker.bridge.BridgeError):
                worker.design_images(["relative.png"], "design-plan")
            forbidden = Path(directory) / "secret.txt"
            forbidden.write_text("synthetic")
            with self.assertRaises(worker.bridge.BridgeError):
                worker.design_images([str(forbidden)], "design-plan")


if __name__ == "__main__":
    unittest.main()
