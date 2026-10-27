import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from reference_pack import pack_references, plan_groups
import codex_worker

ROOT = Path(__file__).resolve().parents[2] / 'verification/reference-packing-20261023'
ROOT.mkdir(parents=True, exist_ok=True)


class ReferencePackingTest(unittest.TestCase):
    def test_up_to_five_preserves_original_order_and_no_sheet(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temp:
            files = [str(Path(temp) / f'{n}.png') for n in range(5)]
            actual, notes, receipt = pack_references(temp, files, [])
            self.assertEqual(actual, files)
            self.assertEqual(notes, '')
            self.assertIsNone(receipt)
            self.assertFalse((Path(temp) / 'reference-pack').exists())

    def test_same_faction_and_minor_preferred_main_remains_single(self):
        refs = [{'role': 'character', 'characterRole': 'lead', 'name': '主角'}, {'role': 'style'}, {'role': 'character', 'faction': '甲方', 'characterRole': 'background'}, {'role': 'character', 'faction': '甲方', 'characterRole': 'background'}, {'role': 'character', 'faction': '乙方', 'characterRole': 'lead'}, {'role': 'scene'}]
        groups = plan_groups(refs)
        self.assertEqual(len(groups), 5)
        self.assertIn([0], groups)
        self.assertIn([2, 3], groups)
        self.assertIn([4], groups)

    def test_scene_merge_and_sixty_plus_edit_base_all_accounted_for(self):
        refs = [{'role': 'character', 'characterRole': 'lead'}] * 4 + [{'role': 'scene'}] * 2
        self.assertIn([4, 5], plan_groups(refs))
        refs = [{'base': True}] + [{'role': 'character', 'characterRole': 'lead'}] * 60
        groups = plan_groups(refs)
        self.assertEqual(len(groups), 5)
        self.assertEqual(sorted(i for group in groups for i in group), list(range(61)))
        self.assertIn([0], groups)
        self.assertIn([1], groups)
        self.assertLessEqual(max(map(len, groups)), 20)

    def fixtures(self, root, count=6):
        files, roles = [], []
        for index in range(count):
            file = root / f'reference-{index}.png'
            image = Image.new('RGB', (80 + index * 11, 130 - index * 10), (20 * index, 50, 200))
            image.putpixel((0, 0), (255, 0, 0))
            image.putpixel((image.width - 1, image.height - 1), (0, 255, 0))
            image.save(file)
            files.append(str(file))
            roles.append({'role': 'character', 'name': f'人物{index}', 'faction': '同门' if index in (2, 3) else '', 'characterRole': 'background' if index in (2, 3) else 'lead'})
        return files, roles

    def test_decoded_contact_sheet_full_images_labels_and_unchanged_sources(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temp:
            root = Path(temp)
            files, roles = self.fixtures(root)
            before = [hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in files]
            attached, notes, receipt = pack_references(root, files, roles)
            self.assertEqual(len(attached), 5)
            self.assertIn(files[0], attached)
            self.assertIn('R03', notes)
            self.assertIn('人物3', notes)
            self.assertIn('不得串用', notes)
            self.assertEqual([hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in files], before)
            self.assertEqual(len([s for a in receipt['attachments'] for s in a['sources']]), 6)
            sheet = next(a for a in receipt['attachments'] if a['merged'])
            self.assertEqual([s['name'] for s in sheet['sources']], ['人物2', '人物3'])
            with Image.open(sheet['file']) as image:
                image.load()
                self.assertLessEqual(max(image.size), 4096)
                for source in sheet['sources']:
                    tile = source['tile']
                    self.assertAlmostEqual(tile['w'] / tile['h'], source['width'] / source['height'], delta=.02)
                    self.assertEqual(image.getpixel((tile['x'], tile['y'])), (255, 0, 0))
                    self.assertEqual(image.getpixel((tile['x'] + tile['w'] - 1, tile['y'] + tile['h'] - 1)), (0, 255, 0))
            self.assertEqual(json.loads((root / 'reference-pack.json').read_text('utf-8')), receipt)
            # Durable synthetic visual evidence, separate from original fixtures.
            (ROOT / 'synthetic-contact-sheet.png').write_bytes(Path(sheet['file']).read_bytes())

    def test_actual_worker_transmits_five_paths_and_counts_edit_base(self):
        for edit in (False, True):
            with self.subTest(edit=edit), tempfile.TemporaryDirectory(dir=ROOT) as temp:
                root = Path(temp)
                files, roles = self.fixtures(root, 5 if edit else 6)
                native = root / 'native.png'
                Image.new('RGB', (240, 320), (77, 88, 99)).save(native)
                task = {'action': 'edit' if edit else 'generate', 'referenceFiles': files, 'referenceRoles': roles}
                base = root / 'base.png'
                if edit:
                    Image.new('RGB', (240, 320), '#aa7733').save(base)
                    task.update(basePanelPath=str(base), cropBox=[0, 0, 240, 320], editPrompt='测试修改')
                (root / 'input.json').write_text(json.dumps(task), 'utf-8')
                (root / 'request.txt').write_text('合成镜头原始提示词', 'utf-8')

                class Server:
                    def __init__(self):
                        self.calls = []
                    def rpc(self, method, params, timeout=30):
                        self.calls.append((method, params))
                        return {'thread': {'id': 't'}} if method == 'thread/start' else {'turn': {'id': 'u'}} if method == 'turn/start' else {}
                    def events(self):
                        yield {'method': 'item/completed', 'params': {'threadId': 't', 'turnId': 'u', 'item': {'type': 'imageGeneration', 'savedPath': str(native)}}}

                server = Server()
                with patch.object(codex_worker, 'emit'):
                    result = codex_worker.generate(server, root)
                prompt = next(p for m, p in server.calls if m == 'turn/start')['input'][0]['text']
                paths = json.loads(prompt.split('本任务本地图片路径清单（只读，JSON 数组，顺序对应图号）：\n')[-1])
                self.assertEqual(len(paths), 5)
                if edit:
                    self.assertEqual(paths[0], str(base.resolve()))
                self.assertIn('合成镜头原始提示词', prompt)
                receipt = json.loads((root / 'result.json').read_text('utf-8'))
                self.assertEqual(receipt['referencePacking']['sourceCount'], 6)
                self.assertEqual(receipt['timings']['referenceCount'], 5)


if __name__ == '__main__':
    unittest.main()
