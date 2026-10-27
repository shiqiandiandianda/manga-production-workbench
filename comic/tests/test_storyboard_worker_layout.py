import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import storyboard_worker as worker
bridge = worker.bridge


class LayoutPlanTests(unittest.TestCase):
    def test_layout_plan_keeps_whitelisted_fields(self):
        text = "```json\n" + json.dumps({"spreads": [{"spread": "solo-hero", "units": ["E001-001"], "pace": "breath", "mirror": True,
                                                       "slots": [{"emotion": "impact", "tension": 3, "breakout": "光柱冲出上边", "evil": "<x>"}],
                                                       "why": "主格", "hack": 1}]}, ensure_ascii=False) + "\n```"
        self.assertEqual(worker.parse_layout_plan(text), [{"spread": "solo-hero", "units": ["E001-001"], "pace": "breath", "mirror": True, "why": "主格",
                                                          "slots": [{"emotion": "impact", "breakout": "光柱冲出上边", "tension": 3}]}])

    def test_layout_plan_accepts_bare_array_and_rejects_bad_shapes(self):
        self.assertEqual(worker.parse_layout_plan(json.dumps([{"spread": "solo-mid", "units": ["E001-002"]}]))[0]["spread"], "solo-mid")
        for bad in ("不是 JSON", json.dumps({"spreads": []}), json.dumps({"spreads": [{"spread": 3, "units": []}]}), ""):
            with self.assertRaises(bridge.BridgeError):
                worker.parse_layout_plan(bad)

    def test_output_kind_accepts_layout_plan(self):
        self.assertIn("layout-plan", worker.OUTPUT_KINDS)


if __name__ == "__main__":
    unittest.main()
