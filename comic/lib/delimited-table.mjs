const fail=message=>{throw Object.assign(Error(message),{status:400});};
export function delimitedTable(text){
 const trimmed=text.replace(/^\uFEFF/,'');if(!trimmed.trim())fail('分镜表没有内容');
 if(trimmed.trimStart().startsWith('|')){const cells=line=>line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(v=>v.trim().replaceAll('\\|','|'));const entries=trimmed.split(/\r?\n/).map((line,i)=>({line,row:i+1})).filter(v=>v.line.trim()&&!/^\s*\|?[\s:|\-]+\|?\s*$/.test(v.line));return {table:entries.map(v=>cells(v.line)),rowNumbers:entries.map(v=>v.row)};}
 const delimiter=trimmed.includes('\t')?'\t':',',table=[],rowNumbers=[];let row=[],cell='',quoted=false,line=1,start=1;
 for(let i=0;i<trimmed.length;i++){const c=trimmed[i];if(c==='"'){if(quoted&&trimmed[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){const newline=c==='\r'&&trimmed[i+1]==='\n'?'\r\n':c;if(newline.length===2)i++;if(quoted)cell+=newline;else{row.push(cell);if(row.some(v=>v.trim())){table.push(row);rowNumbers.push(start);}row=[];cell='';start=line+1;}line++;}else cell+=c;}
 if(quoted)fail('分镜表中的引号没有闭合');row.push(cell);if(row.some(v=>v.trim())){table.push(row);rowNumbers.push(start);}if(table.length<2)fail('请包含表头和至少一行分镜');return {table,rowNumbers};
}
