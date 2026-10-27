"""Current V41 storyboard input contract. The standalone storyboard_worker was removed upstream.
The original fake-worker suite is retained in the repair audit; current transport contracts are
covered by test_codex_worker.py and text-only XLSX import contracts are exercised here.
"""
import unittest,zipfile,io,json,base64,subprocess,sys,tempfile
from pathlib import Path
from xml.sax.saxutils import escape
SCRIPT=Path(__file__).resolve().parents[1]/'python/storyboard_xlsx.py'
def book(rows,workbook=None):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w') as z:
  z.writestr('xl/workbook.xml',workbook or '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="第12话" sheetId="1" r:id="rId1"/></sheets></workbook>')
  z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
  xml='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
  for n,row in enumerate(rows,1):
   xml+='<row r="%d">'%n
   for col,text in enumerate(row):xml+='<c r="%s%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'%(chr(65+col),n,escape(text))
   xml+='</row>'
  z.writestr('xl/worksheets/sheet1.xml',xml+'</sheetData></worksheet>')
 return out.getvalue()
def parse(raw):
 return subprocess.run([sys.executable,str(SCRIPT)],input=json.dumps({'dataBase64':base64.b64encode(raw).decode()}).encode(),capture_output=True)
class CurrentStoryboardImportTests(unittest.TestCase):
 def test_preserves_novel_description_dialogue_and_source_row(self):
  text='  白蛇赠宝。\n保留原文与符号 <>&';dialogue='切记，先保管好。'
  result=parse(book([['第12话制作资料'],['格号','画面内容','台词'],['1',text,dialogue]]));self.assertEqual(result.returncode,0,result.stderr.decode());data=json.loads(result.stdout);self.assertEqual(data['rows'][0]['画面内容'],text);self.assertEqual(data['rows'][0]['台词'],dialogue);self.assertEqual(data['rowNumbers'],[3]);self.assertEqual(data['headerRow'],2)
 def test_duplicate_columns_rejected(self):
  result=parse(book([['画面内容','画面内容'],['甲','乙']]));self.assertNotEqual(result.returncode,0);self.assertIn('重复表头',result.stderr.decode())
 def test_no_storyboard_header_rejected(self):
  result=parse(book([['其他列'],['不是分镜']]));self.assertNotEqual(result.returncode,0);self.assertIn('分镜',result.stderr.decode())
 def test_xml_entity_rejected_without_external_read(self):
  xml='<!DOCTYPE workbook [<!ENTITY xxe SYSTEM "file:///never-read-private-file">]><workbook/>'
  result=parse(book([['画面内容'],['原文']],xml));self.assertNotEqual(result.returncode,0);self.assertIn('实体',result.stderr.decode())
 def test_invalid_binary_rejected_without_partial_success(self):
  result=parse(b'not-an-xlsx');self.assertNotEqual(result.returncode,0);self.assertFalse(result.stdout)
if __name__=='__main__':unittest.main(verbosity=2)
