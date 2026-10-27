// Dependency-free .xlsx reader and writer. The bundled runtime has no npm packages,
// so this covers what storyboard tables need: text and numbers, several sheets,
// header styles, column widths, frozen header rows, filters and dropdown lists.
import zlib from 'node:zlib';

const CRC_TABLE=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}return table;})();
export function crc32(buffer){if(typeof zlib.crc32==='function')return zlib.crc32(buffer)>>>0;let c=0xffffffff;for(const byte of buffer)c=CRC_TABLE[(c^byte)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}

/* ---------------- ZIP ---------------- */
export function readZip(buffer){
  if(!Buffer.isBuffer(buffer))buffer=Buffer.from(buffer);
  let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}}
  if(end<0)throw new Error('不是有效的 xlsx 文件（找不到压缩目录）');
  const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16),files=new Map();let p=offset;
  for(let i=0;i<count;i++){
    if(buffer.readUInt32LE(p)!==0x02014b50)throw new Error('xlsx 压缩目录损坏');
    const method=buffer.readUInt16LE(p+10),compressed=buffer.readUInt32LE(p+20),nameLength=buffer.readUInt16LE(p+28),extraLength=buffer.readUInt16LE(p+30),commentLength=buffer.readUInt16LE(p+32),local=buffer.readUInt32LE(p+42);
    const name=buffer.toString('utf8',p+46,p+46+nameLength);p+=46+nameLength+extraLength+commentLength;
    if(buffer.readUInt32LE(local)!==0x04034b50)throw new Error('xlsx 文件条目损坏');
    const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),data=buffer.subarray(start,start+compressed);
    if(method!==0&&method!==8)throw new Error('xlsx 使用了不支持的压缩方式');
    files.set(name,{method,data});
  }
  return {has:name=>files.has(name),names:()=>[...files.keys()],read(name){const entry=files.get(name);if(!entry)return null;const bytes=entry.method===8?zlib.inflateRawSync(entry.data):entry.data;if(bytes.length>200*1024*1024)throw new Error('xlsx 内容过大');return bytes.toString('utf8');}};
}
export function writeZip(entries){
  const locals=[],centrals=[];let offset=0;
  for(const {name,data} of entries){
    const raw=Buffer.isBuffer(data)?data:Buffer.from(data,'utf8'),deflated=zlib.deflateRawSync(raw),nameBytes=Buffer.from(name,'utf8'),crc=crc32(raw);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(0,10);local.writeUInt32LE(crc,14);local.writeUInt32LE(deflated.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(nameBytes.length,26);local.writeUInt16LE(0,28);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);central.writeUInt16LE(8,10);central.writeUInt32LE(0,12);central.writeUInt32LE(crc,16);central.writeUInt32LE(deflated.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(nameBytes.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,nameBytes,deflated);centrals.push(central,nameBytes);offset+=30+nameBytes.length+deflated.length;
  }
  const centralSize=centrals.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,...centrals,end]);
}

/* ---------------- XML helpers ---------------- */
const decode=text=>text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi,(_,e)=>e[0]==='#'?String.fromCodePoint(e[1]==='x'||e[1]==='X'?parseInt(e.slice(2),16):parseInt(e.slice(1),10)):{lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}[e.toLowerCase()]);
// Strip characters XML 1.0 forbids, so a stray control byte cannot corrupt the workbook.
const escape=value=>String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g,'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const attr=(tag,name)=>{const m=new RegExp(`\\s${name}="([^"]*)"`).exec(tag);return m?decode(m[1]):null;};
const stripPrefix=xml=>xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g,'<$1');
const textOf=xml=>{let out='';for(const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g))out+=m[1]?decode(m[1]):'';return out;};
export function columnIndex(ref){const letters=/^[A-Z]+/.exec(ref)[0];let n=0;for(const c of letters)n=n*26+c.charCodeAt(0)-64;return n-1;}
export function columnName(index){let n=index+1,s='';while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}

/** Returns [{name, rows}] where rows is an array of arrays (strings, numbers, booleans or null). */
export function readXlsx(buffer){
  const zip=readZip(buffer),workbook=zip.read('xl/workbook.xml');if(!workbook)throw new Error('不是有效的 xlsx 文件（缺少工作簿）');
  const rels=stripPrefix(zip.read('xl/_rels/workbook.xml.rels')||''),targets=new Map();
  for(const m of rels.matchAll(/<Relationship\b[^>]*>/g)){const id=attr(m[0],'Id'),target=attr(m[0],'Target');if(id&&target)targets.set(id,target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,''));}
  const shared=[];const sharedXml=zip.read('xl/sharedStrings.xml');
  if(sharedXml)for(const m of stripPrefix(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g))shared.push(m[1]?textOf(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g,'')):'');
  const sheets=[];
  for(const m of stripPrefix(workbook).matchAll(/<sheet\b[^>]*>/g)){
    const name=attr(m[0],'name'),rid=attr(m[0],'r:id')??attr(m[0],'id');const path=targets.get(rid);const xml=path&&zip.read(path);if(!xml)continue;
    const rows=[];
    for(const row of stripPrefix(xml).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)){
      if(!row[2])continue;const index=Number(attr(' '+row[1],'r'))-1;const cells=[];
      for(const cell of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
        const ref=attr(' '+cell[1],'r'),type=attr(' '+cell[1],'t'),body=cell[2]||'';const col=ref?columnIndex(ref):cells.length;
        const v=/<v>([\s\S]*?)<\/v>/.exec(body);let value=null;
        if(type==='s')value=v?shared[Number(v[1])]??'':'';
        else if(type==='inlineStr')value=textOf(body);
        else if(type==='str'||type==='e')value=v?decode(v[1]):'';
        else if(type==='b')value=v?v[1]==='1':null;
        else if(v){const n=Number(v[1]);value=Number.isFinite(n)?n:decode(v[1]);}
        cells[col]=value;
      }
      rows[Number.isInteger(index)&&index>=0?index:rows.length]=Array.from(cells,v=>v===undefined?null:v);
    }
    sheets.push({name,rows:Array.from(rows,r=>r||[])});
  }
  return sheets;
}

/* ---------------- Writer ---------------- */
// Style indexes used by sheet specs.
export const STYLE={normal:0,header:1,wrap:2,clientHeader:3,productionHeader:4,error:5,warning:6,info:7,title:8,clientCell:9,number:10};
const STYLES_XML=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="14"/><name val="Microsoft YaHei"/></font></fonts>
<fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFBDD7EE"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6E0B4"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF8CBAD"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F7FC"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const cellXml=(ref,value,style)=>{
  const s=style?` s="${style}"`:'';
  if(value===null||value===undefined||value==='')return style?`<c r="${ref}"${s}/>`:'';
  if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if(typeof value==='boolean')return `<c r="${ref}"${s} t="b"><v>${value?1:0}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
};
/**
 * sheet spec: {name, rows:[[value|{v,s}]], widths:[number], freeze:{row,col}, filter:true|{row}, merges:['A1:C1'],
 *   validations:[{range:'F2:F5000', list:['a','b']} | {range, formula:'$A$1:$A$9'} | {range, decimal:[min,max]} | {range, whole:[min,max]}], hidden:true}
 */
export function writeXlsx(sheets){
  if(!sheets.length)throw new Error('工作簿至少需要一张表');
  const names=new Set();for(const sheet of sheets){if(!sheet.name||sheet.name.length>31||/[\\/?*:[\]]/.test(sheet.name)||names.has(sheet.name))throw new Error('工作表名称无效：'+sheet.name);names.add(sheet.name);}
  const entries=[];
  const sheetXml=sheet=>{
    const rows=sheet.rows||[];let maxCol=0;
    const body=rows.map((row,r)=>{if(!row)return '';maxCol=Math.max(maxCol,row.length);const cells=row.map((item,c)=>{const value=item&&typeof item==='object'&&!Array.isArray(item)?item.v:item,style=item&&typeof item==='object'&&!Array.isArray(item)?item.s:0;return cellXml(columnName(c)+(r+1),value,style);}).join('');const height=sheet.heights?.[r];return `<row r="${r+1}"${height?` ht="${height}" customHeight="1"`:''}>${cells}</row>`;}).join('');
    const freeze=sheet.freeze?(()=>{const {row=0,col=0}=sheet.freeze,ref=columnName(col)+(row+1);return `<sheetViews><sheetView workbookViewId="0"><pane${col?` xSplit="${col}"`:''}${row?` ySplit="${row}"`:''} topLeftCell="${ref}" activePane="${row&&col?'bottomRight':row?'bottomLeft':'topRight'}" state="frozen"/></sheetView></sheetViews>`;})():'<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const cols=sheet.widths?.length?`<cols>${sheet.widths.map((w,i)=>w?`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`:'').join('')}</cols>`:'';
    const filterRow=sheet.filter===true?1:sheet.filter?.row;const filter=filterRow&&maxCol?`<autoFilter ref="A${filterRow}:${columnName(maxCol-1)}${Math.max(filterRow,rows.length)}"/>`:'';
    const merges=sheet.merges?.length?`<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>`:'';
    const validations=sheet.validations?.length?`<dataValidations count="${sheet.validations.length}">${sheet.validations.map(v=>{
      if(v.list){const formula='"'+v.list.join(',')+'"';if(formula.length>255)throw new Error('下拉选项过长：'+v.range);return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.range}"><formula1>${escape(formula)}</formula1></dataValidation>`;}
      if(v.formula)return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${v.range}"><formula1>${escape(v.formula)}</formula1></dataValidation>`;
      const [kind,[min,max]]=v.decimal?['decimal',v.decimal]:['whole',v.whole];return `<dataValidation type="${kind}" operator="between" allowBlank="1" showErrorMessage="1" sqref="${v.range}"><formula1>${min}</formula1><formula2>${max}</formula2></dataValidation>`;
    }).join('')}</dataValidations>`:'';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${freeze}<sheetFormatPr defaultRowHeight="16"/>${cols}<sheetData>${body}</sheetData>${filter}${merges}${validations}</worksheet>`;
  };
  sheets.forEach((sheet,i)=>entries.push({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(sheet)}));
  const filterNames=sheets.map((sheet,i)=>{const row=sheet.filter===true?1:sheet.filter?.row;const maxCol=Math.max(0,...(sheet.rows||[]).map(r=>r?.length||0));return row&&maxCol?`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escape(sheet.name)}'!$A$${row}:$${columnName(maxCol-1)}$${Math.max(row,(sheet.rows||[]).length)}</definedName>`:'';}).join('');
  entries.unshift(
    {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`},
    {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`},
    {name:'docProps/core.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>漫画制作工作台</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/,'Z')}</dcterms:created></cp:coreProperties>`},
    {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${Math.max(0,sheets.findIndex(s=>s.active))}"/></bookViews><sheets>${sheets.map((sheet,i)=>`<sheet name="${escape(sheet.name)}" sheetId="${i+1}"${sheet.hidden?' state="hidden"':''} r:id="rId${i+1}"/>`).join('')}</sheets>${filterNames?`<definedNames>${filterNames}</definedNames>`:''}</workbook>`},
    {name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {name:'xl/styles.xml',data:STYLES_XML}
  );
  return writeZip(entries);
}
