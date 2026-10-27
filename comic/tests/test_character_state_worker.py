import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import storyboard_worker as worker

class CharacterStateWorkerTest(unittest.TestCase):
    def test_state_and_source_fields_survive_text_worker_allowlist(self):
        row = {column: '' for column in worker.COLUMNS}
        row.update(episode=1, page=1, bindings=[])
        state = '阿青:' + '白衣细节' * 150
        row['internal'] = {'角色状态': state, '原著位置': '第1章第3段', '道具状态': '古戒:左手·隐去', '未知字段': '不会采用'}
        result = worker.parse_rows(json.dumps([row], ensure_ascii=False))[0]
        self.assertEqual(result['internal']['角色状态'], state)
        self.assertEqual(result['internal']['原著位置'], '第1章第3段')
        self.assertEqual(result['internal']['道具状态'], '古戒:左手·隐去')
        self.assertNotIn('未知字段', result['internal'])
        self.assertEqual([key for key in worker.COLUMNS if key in result], list(worker.COLUMNS))

if __name__ == '__main__':
    unittest.main()
