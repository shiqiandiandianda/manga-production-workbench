import type {Chapter} from './scenes.ts';
export const SOURCE_PARSING_VERSION=2;
const heading=/^(?:#{1,6}\s*)?(?:第[零〇一二三四五六七八九十百千万两\d]+[章节集回]|Chapter\s+\d+\b)/i;
function titleKey(title:string){return title.replace(/^#{1,6}\s*/,'').replace(/\s+/g,'').replace(/[.·…]{2,}\d+$/,'').trim();}
function onlyTocMetadata(body:string){return body.split('\n').every(line=>!line.trim()||/^(?:正文|目录|目\s*录|第.{1,24}卷(?:[：: ].*)?|\d+)$/i.test(line.trim()));}
export function parseScript(text:string){
  const sections:{title:string;text:string;body:string}[]=[];let current:{title:string;text:string;body:string}|null=null;
  for(const line of text.replace(/\r\n?/g,'\n').split('\n')){
    if(heading.test(line.trim())){if(current?.text.trim())sections.push(current);current={title:line.trim(),text:line+'\n',body:''};}
    else{if(!current)current={title:'序言 / 正文',text:'',body:''};current.text+=line+'\n';current.body+=line+'\n';}
  }
  if(current?.text.trim())sections.push(current);
  const firstHeading=sections.findIndex(section=>heading.test(section.title));
  let ignoredTocEntries=0,ignoredPrefixChars=0,start=0;
  if(firstHeading>=0){
    let denseEnd=firstHeading;while(denseEnd<sections.length&&onlyTocMetadata(sections[denseEnd].body))denseEnd++;
    const denseCount=denseEnd-firstHeading;
    const laterTitles=new Set(sections.slice(denseEnd).map(section=>titleKey(section.title)));
    const repeated=sections.slice(firstHeading,denseEnd).filter(section=>laterTitles.has(titleKey(section.title))).length;
    const prefix=sections.slice(0,firstHeading).map(section=>section.text).join('');
    if(denseCount>=3&&repeated>=3&&(repeated/denseCount>=0.6||/目录|目\s*录|contents/i.test(prefix))){
      start=denseEnd;ignoredTocEntries=denseCount;ignoredPrefixChars=sections.slice(0,start).reduce((total,section)=>total+section.text.length,0);
    }
  }
  const selected=sections.slice(start);
  const chapters:Chapter[]=selected.map((section,index)=>({id:'chapter-'+(index+1),index:index+1,title:section.title,text:section.text}));
  const bodyChars=selected.reduce((total,section)=>total+section.body.trim().length,0);
  const headed=selected.filter(section=>heading.test(section.title));
  const headingOnly=headed.length>1&&headed.every(section=>onlyTocMetadata(section.body));
  return {chapters,ignoredTocEntries,ignoredPrefixChars,bodyChars,headingOnly,version:SOURCE_PARSING_VERSION};
}
