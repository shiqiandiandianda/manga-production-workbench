import mammoth from 'mammoth/mammoth.browser.js';

export function decodeScript(bytes:ArrayBuffer):string {
  const data=new Uint8Array(bytes);
  if(data[0]===0xff&&data[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(data);
  if(data[0]===0xfe&&data[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(data);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}
  catch{return new TextDecoder('gb18030',{fatal:true}).decode(data);}
}
export async function readScript(file:{name:string;size:number;arrayBuffer:()=>Promise<ArrayBuffer>}):Promise<string> {
  if(file.size>25*1024*1024)throw new Error('文件超过 25 MB，请分卷或移除 Word 中的大图后再导入。');
  const bytes=await file.arrayBuffer();
  let text:string;
  if(/\.docx$/i.test(file.name)){
    const signature=new Uint8Array(bytes);
    if(signature[0]!==0x50||signature[1]!==0x4b)throw new Error('这个文件不是有效的 DOCX。请在 Word 中另存为“Word 文档（.docx）”后重试。');
    try{text=(await mammoth.extractRawText({arrayBuffer:bytes})).value;}
    catch{throw new Error('Word 正文读取失败。请取消文档密码或保护，在 Word 中另存为新的 .docx 后重试。');}
  }else if(/\.(txt|md|markdown)$/i.test(file.name)){
    try{text=decodeScript(bytes);}catch{throw new Error('文本编码无法识别，请另存为 UTF-8 TXT 后重试。');}
  }else throw new Error('请选择 DOCX、TXT 或 Markdown；旧版 .doc 和 PDF 请先转换成 DOCX。');
  text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if(!text.trim())throw new Error('文件没有可读取的正文。若内容是扫描图片，请先在 Word 中转为可编辑文字。');
  if(text.length>5000000)throw new Error('正文超过 500 万字符，请分卷导入。');
  return text;
}
