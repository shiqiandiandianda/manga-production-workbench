"""Silent setups and reveals must satisfy the real dialogue contract."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from native_style_layout import paragraph_groups
from layout_engine.dialogue import validate_dialogue_groups


class RevealParagraphTests(unittest.TestCase):
    def fixture(self, speeches, reveals=(), locations=None, local=True):
        shots = [{'key': f'S{i}', 'description': f'第{i}格观察桌上留下的字迹和人物反应。',
                  'dialogue': speech, 'location': locations[i] if locations else '客房'}
                 for i, speech in enumerate(speeches)]
        facts = [{'speech': s['dialogue'], 'description': s['description'], 'topic': '',
                  'question': False, **({'_combinationSignals': {'reveal': '认出'} if i in reveals else {}} if local else {})}
                 for i, s in enumerate(shots)]
        return shots, facts

    def check(self, speeches, reveals, expected, locations=None):
        shots, facts = self.fixture(speeches, reveals, locations)
        original = copy.deepcopy((shots, facts))
        groups, boundaries = paragraph_groups(shots, facts, 'verbatim-original-field-v1')
        self.assertEqual([(g['startShotCode'], g['endShotCode']) for g in groups], expected)
        links = [{'kind': 'scene_transition' if shots[i]['location'] != shots[i-1]['location']
                  else 'information_reveal' if i in reveals else 'continuation',
                  'reason': '原镜头认出眼前人物，保留铺垫及识别信息的独立理解停顿。'}
                 for i in range(1, len(shots))]
        self.assertTrue(validate_dialogue_groups({'panels': [], 'connections': links, 'dialogueGroups': groups}, {'shots': shots}))
        self.assertEqual((shots, facts), original)
        return groups

    def test_silent_opening_before_spoken_recognition(self):
        self.check(['', '大人，您怎么在这里？', '进来坐下说话。'], [1], [('S0', 'S2')])

    def test_silent_final_reveal(self):
        self.check(['仔细看这封信。', ''], [1], [('S0', 'S1')])

    def test_fully_silent_reveal_and_verbatim_anchor(self):
        groups = self.check(['', ''], [1], [('S0', 'S1')])
        self.assertEqual(groups[0]['sourceAnchors'][0]['quote'], '第0格观察桌上留下的字迹和人物反应。')

    def test_silent_setup_between_dialogue_and_reveal(self):
        self.check(['这里留下了一封信。', '', '我认出这个字迹了。'], [2], [('S0', 'S2')])

    def test_consecutive_silent_reveals(self):
        self.check(['', '', '', '真相终于明白了。'], [1, 2], [('S0', 'S3')])

    def test_scene_transition_is_not_bridged(self):
        self.check(['原来的房间。', '眼前是另一个人。'], [1], [('S0', 'S0'), ('S1', 'S1')], ['甲地', '乙地'])

    def test_unrelated_silent_gap_stays_outside_group(self):
        self.check(['先收好这封信。', '', '', '', '终于看清字迹了。'], [4], [('S0', 'S0'), ('S3', 'S4')])

    def test_legacy_path_retains_dialogue_only_grouping(self):
        shots, facts = self.fixture(['', '原来的接话。'], [1], local=False)
        groups, _ = paragraph_groups(shots, facts)
        self.assertEqual(groups[0]['startShotCode'], 'S1')


if __name__ == '__main__':
    unittest.main()
