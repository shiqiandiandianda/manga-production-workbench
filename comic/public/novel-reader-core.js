export const READER_DEFAULTS=Object.freeze({fontSize:20,theme:'paper',wide:false});

export function readerSettings(value={}){
 const font=Number(value?.fontSize);
 return {fontSize:Number.isFinite(font)?Math.min(32,Math.max(16,Math.round(font))):20,theme:value?.theme==='dark'?'dark':'paper',wide:value?.wide===true};
}

export function chapterParagraphs(text){
 return String(text).replace(/^\uFEFF/u,'').split(/\r\n|\n|\r/u).flatMap((text,index)=>text.trim()?[{line:index+1,text}]:[]);
}

export function findChapterMatches(paragraphs,query,limit=5000){
 const value=String(query).trim().slice(0,160),matches=[];
 if(!value)return {matches,limited:false};
 const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(escaped,'giu');
 for(const paragraph of paragraphs){pattern.lastIndex=0;let match;
  while((match=pattern.exec(paragraph.text))){if(matches.length>=limit)return {matches,limited:true};matches.push({line:paragraph.line,index:match.index,length:match[0].length});}
 }
 return {matches,limited:false};
}

export function novelReaderUrl(projectId,excerpt,name=''){
 return '/novel-reader.html?'+new URLSearchParams({projectId,chapter:String(excerpt.chapter),line:String(excerpt.line),...(name?{name}:{})});
}
