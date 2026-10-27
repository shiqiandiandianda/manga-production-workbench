"""Read XLSX text only with the portable standard library. No formulas or macros are executed."""
import base64, io, json, posixpath, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
NS={"m":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL="{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
HEADER_NAMES={"画面描述","画面内容","画面","分镜内容","分镜","description"}
def main():
    input_data=json.load(sys.stdin)
    max_columns=input_data.get('maxColumns',64)
    if not isinstance(max_columns,int) or not 64<=max_columns<=256: raise ValueError('工作表列数范围无效')
    raw=base64.b64decode(input_data["dataBase64"],validate=True)
    if len(raw)>8*1024*1024: raise ValueError("分镜文件超过 8 MB")
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        entries=z.infolist()
        if len(entries)>3000 or sum(i.file_size for i in entries)>40*1024*1024:
            raise ValueError("工作簿解压内容过大")
        def xml(name):
            data=z.read(name)
            if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                raise ValueError("工作簿 XML 包含不支持的实体声明")
            return ET.fromstring(data)
        strings=[]
        if "xl/sharedStrings.xml" in z.namelist():
            strings=["".join(n.itertext()) if n.tag.endswith("}t") else "".join(t.text or "" for t in n.findall(".//m:t",NS))
                     for n in xml("xl/sharedStrings.xml").findall("m:si",NS)]
        rels={r.attrib["Id"]:r.attrib["Target"] for r in xml("xl/_rels/workbook.xml.rels")
              if r.attrib.get("TargetMode")!="External"}
        sheets=[]
        for sheet in xml("xl/workbook.xml").findall("m:sheets/m:sheet",NS):
            target=rels.get(sheet.attrib.get(REL),"")
            target=posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/"+target)
            if not target.startswith("xl/") or target not in z.namelist(): continue
            sheets.append((sheet.attrib.get("name",""),target))
        if not sheets: raise ValueError("工作簿没有可读取的工作表")
        selected=input_data.get("sheet","")
        warnings=[];inspecting=input_data.get('mode')=='inspect';snapshots=[];outline_snapshots=[]
        production_package=inspecting and {'话列表','分镜','台词','资产'}.issubset({name for name,_ in sheets})
        if selected and selected not in [s[0] for s in sheets] and not (production_package and selected.startswith('分镜 · 第')): raise ValueError("指定工作表不存在")
        for name,target in sheets:
            # A production workbook carries audit/asset/dialogue sheets, not additional shots.
            if production_package and name not in {'分镜','话列表','分话细纲','分集细纲','交付总览'}: continue
            if selected and selected!=name and not inspecting: continue
            table=[];row_numbers=[];cell_errors=[]
            for row in xml(target).findall("m:sheetData/m:row",NS):
                values={}
                for cell in row.findall("m:c",NS):
                    reference=cell.attrib.get("r","")
                    letters=re.match(r"([A-Z]+)",reference)
                    if not letters: continue
                    index=0
                    for c in letters[1]: index=index*26+ord(c)-64
                    if index>max_columns: continue
                    typ=cell.attrib.get("t","");value=cell.find("m:v",NS)
                    formula=cell.find("m:f",NS)
                    if formula is not None and value is None:
                        if not inspecting:raise ValueError(f"{name} 的 {reference} 是没有缓存值的公式；请粘贴为值后导入")
                        cell_errors.append({'cell':reference,'kind':'UNCACHED_FORMULA','value':'='+(formula.text or ''),'reason':'公式没有缓存值；不会执行公式，需要人工提供字面值'})
                    if typ=="inlineStr": text="".join(t.text or "" for t in cell.findall(".//m:is//m:t",NS))
                    elif typ=="s": text=strings[int(value.text)] if value is not None and value.text else ""
                    elif typ=="e":
                        if not inspecting:raise ValueError(f"{name} 的 {reference} 包含 Excel 错误值")
                        text=value.text or '' if value is not None else ''
                        cell_errors.append({'cell':reference,'kind':'EXCEL_ERROR','value':text,'reason':'单元格包含 Excel 错误值，需要人工提供正确字面值'})
                    else: text=value.text or "" if value is not None else ""
                    if inspecting and formula is not None and value is None:text='='+(formula.text or '')
                    values[index-1]=text
                if any(str(v).strip() for v in values.values()):
                    table.append([values.get(i,"") for i in range(max(values)+1)])
                    row_numbers.append(int(row.attrib.get("r",len(row_numbers)+1)))
                    if len(table)>(10000 if inspecting else 805): raise ValueError("工作表内容过多" if inspecting else "一次最多导入 800 个分镜")
            if production_package and name!='分镜':
                outline_snapshots.append({'name':name,'table':table,'rowNumbers':row_numbers})
                continue
            if inspecting:
                known=HEADER_NAMES|{'格号','镜头编号','镜头号','编号','code','台词','对白','dialogue','景别','shotSize','机位角度','镜头角度','cameraAngle','出现角色','当前场景','当前天气','当前时间','画面备注','特效字'}
                scored=[(len(known.intersection(v.strip() for v in r)),i) for i,r in enumerate(table[:5])]
                best=max(scored,key=lambda candidate:candidate[0],default=(0,-1));header_index=best[1] if best[0]>0 else -1
                headers=[v.strip() for v in table[header_index]] if header_index>=0 else []
                if production_package:
                    if '话' not in headers or not HEADER_NAMES.intersection(headers):
                        raise ValueError('生产表的“分镜”工作表缺少“话”或“画面内容”列')
                    episode_col=headers.index('话');groups={}
                    for values,source_row in zip(table[header_index+1:],row_numbers[header_index+1:]):
                        episode=values[episode_col].strip() if episode_col<len(values) else ''
                        if not episode: raise ValueError(f'分镜!{source_row} 缺少话号，请补齐后导入')
                        groups.setdefault(episode,[]).append((values,source_row))
                    for episode,records in groups.items():
                        numbers=[source_row for _,source_row in records];included=set(numbers)
                        snapshots.append({'name':f'分镜 · 第{episode}话','sourceName':'分镜','table':[table[header_index]]+[values for values,_ in records],'rowNumbers':[row_numbers[header_index]]+numbers,'headerIndex':0,'cellErrors':[e for e in cell_errors if int(re.search(r'\d+$',e['cell']).group()) in included]})
                else:
                    snapshots.append({'name':name,'table':table,'rowNumbers':row_numbers,'headerIndex':header_index,'cellErrors':cell_errors})
                continue
            header_index=next((i for i,r in enumerate(table[:5]) if HEADER_NAMES.intersection(v.strip() for v in r)),None)
            if header_index is None:
                if selected: raise ValueError("工作表前五行需要包含“画面描述”表头")
                continue
            headers=[h.strip() for h in table[header_index]]
            nonempty=[h for h in headers if h]
            if len(nonempty)!=len(set(nonempty)): raise ValueError("工作表存在重复表头")
            records=[{h:r[i] if i<len(r) else "" for i,h in enumerate(headers) if h}
                     for r in table[header_index+1:]]
            if not records: continue
            if len(sheets)>1: warnings.append("工作簿包含多个工作表，当前读取："+name+"。可在导入界面更换。")
            def column(index):
                result=""
                while index:
                    index,remainder=divmod(index-1,26);result=chr(65+remainder)+result
                return result
            return {"rows":records,"rowNumbers":row_numbers[header_index+1:],"headerRow":row_numbers[header_index],"columns":{h:column(i+1) for i,h in enumerate(headers) if h},"sheets":[s[0] for s in sheets],"sheet":name,"warnings":warnings}
        if inspecting:
            if not snapshots:raise ValueError('没有找到可导入的分镜数据')
            if production_package and selected.startswith('分镜 · 第') and selected not in [s['name'] for s in snapshots]:raise ValueError('指定话数不存在')
            return {'workbook':snapshots,'outlineWorkbook':outline_snapshots,'sheets':[s['name'] for s in snapshots],'sheet':selected if selected in [s['name'] for s in snapshots] else next((s['name'] for s in snapshots if s['headerIndex']>=0),snapshots[0]['name'])}
        raise ValueError("没有找到含“画面描述”表头的非空分镜表")
try:
    json.dump(main(),sys.stdout,ensure_ascii=False)
except Exception as e:
    print(str(e),file=sys.stderr)
    sys.exit(1)
