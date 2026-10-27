import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
import storyboard_worker as worker
bridge = worker.bridge


def storyboard_row(**extra):
    row = {column: "" for column in worker.COLUMNS}
    row.update({"格号": "1", "画面内容": "叶麟拔剑", "episode": 1, "page": 1, "bindings": []})
    row.update(extra)
    return row


class BeatSheetTests(unittest.TestCase):
    def test_beat_sheet_keeps_whitelisted_fields_and_coerces_numbers(self):
        text = "```json\n" + json.dumps({"rows": [{"episode": "12", "order": 1, "beat": "承钩", "intensity": 3, "summary": "接上话", "panels": 2, "evil": "<x>"}]}, ensure_ascii=False) + "\n```"
        self.assertEqual(worker.parse_beat_sheet(text), [{"episode": 12, "order": 1, "intensity": 3, "panels": 2, "beat": "承钩", "summary": "接上话"}])

    def test_beat_sheet_requires_episode_and_beat(self):
        with self.assertRaises(bridge.BridgeError):
            worker.parse_beat_sheet(json.dumps({"rows": [{"order": 1, "summary": "缺话数"}]}))
        with self.assertRaises(bridge.BridgeError):
            worker.parse_beat_sheet("不是 JSON")

    def test_storyboard_rows_keep_internal_columns_only_from_whitelist(self):
        rows = worker.parse_rows(json.dumps({"rows": [storyboard_row(internal={"节拍": "高潮", "强度": 5, "站位": "叶麟:左", "情绪": "", "危险": "x", "氛围": True})]}, ensure_ascii=False))
        self.assertEqual(rows[0]["internal"], {"节拍": "高潮", "强度": "5", "站位": "叶麟:左"})
        rows = worker.parse_rows(json.dumps({"rows": [storyboard_row()]}, ensure_ascii=False))
        self.assertNotIn("internal", rows[0])

    def test_output_kind_accepts_beatsheet(self):
        self.assertIn("beatsheet", worker.OUTPUT_KINDS)


if __name__ == "__main__":
    unittest.main()
