import test from 'node:test';
import assert from 'node:assert/strict';
import {assetNovelTerms,assetNovelSourceDocuments,findAssetNovelDescriptions,assetNovelDescriptionsMarkup} from '../public/asset-novel-descriptions.js';
import {assetProvenance} from '../public/asset-provenance.js';

const row=(role,name,extra={})=>({role,name,state:'',sources:[],uses:[],...extra});
const document=(text,chapter=84)=>({text,chapter,name:'小说原文/第'+chapter+'章.txt',url:'/original'});

test('人物描述优先于普通提及；相邻代词服饰保留行号，不借用另一个人的衣服',()=>{
 const text='第84章\n测试人物走进了庭院。\n他身穿青色长衫，面容清瘦。\n另一位客人穿着红色官服。\n测试人物说：“先坐下。”';
 const result=findAssetNovelDescriptions(row('character','测试人物'),[document(text)]);
 assert.equal(result.excerpts[0].quote,'他身穿青色长衫，面容清瘦。');assert.equal(result.excerpts[0].line,3);assert.equal(result.excerpts[0].descriptive,true);assert.ok(!result.excerpts.some(e=>e.quote.includes('客人穿着')));assert.equal(result.descriptionCount,1);
});

test('场景按地点实体查找环境陈设，道具按名称查找材质形状，其他地点不会抢占',()=>{
 const docs=[document('角色甲在金府里喝茶。\n金府十分华丽，朱红木柱高大。\n苍竹堂的内厅宽敞明亮，窗边摆着木桌。\n青玉佩通体碧绿，边缘刻着竹叶花纹。')];
 const scene=findAssetNovelDescriptions(row('scene','测试城 · 苍竹堂',{state:'测试城·苍竹堂内厅'}),docs);assert.equal(scene.excerpts[0].line,3);assert.ok(scene.excerpts.every(e=>!e.quote.includes('金府')));assert.ok(assetNovelTerms(row('scene','测试城 · 苍竹堂')).includes('苍竹堂'));
 const prop=findAssetNovelDescriptions(row('prop','青玉佩'),docs);assert.equal(prop.excerpts[0].line,4);assert.ok(prop.descriptionCount>0);
 assert.ok(assetNovelTerms(row('prop','九封信与高手名单')).includes('九封信'));assert.ok(assetNovelTerms(row('prop','文房四宝')).includes('砚台'));
});

test('没有外观描写时只展示真实剧情依据，不把分镜提示词和别人的描述当作原文',()=>{
 const asset=row('scene','五羊城·蛇王府',{sources:[{novelLocation:'第145章 第3—5行',description:'厅堂有红漆柱，豪华木桌。',dialogue:'分镜对白'}]});
 const result=findAssetNovelDescriptions(asset,[document('第145章\n金府的朱红木柱高大华丽。\n陆小凤和蛇王在喝酒。\n\n薛冰坐在一旁斟酒。',145)]);
 assert.equal(result.descriptionCount,0);assert.equal(result.excerpts[0].line,3);assert.ok(!result.excerpts.some(e=>e.quote.includes('金府')||e.quote.includes('豪华木桌')));
 const html=assetNovelDescriptionsMarkup({id:'p'},asset,result);assert.match(html,/未找到明确的环境与陈设描写/);assert.match(html,/相关剧情原文/);assert.doesNotMatch(html,/描写原句/);
});

test('同一府邸的厅堂和阁楼分开，缺少外观描写时优先当前场景对应的原文',()=>{
 const asset=row('scene','五羊城·蛇王府',{state:'五羊城 · 蛇王府厅堂',sources:[{scene:'五羊城·蛇王府厅堂',novelLocation:'第145章 第2—2行'},{scene:'五羊城·蛇王府阁楼',novelLocation:'第146章 第2—2行'}]}),result=findAssetNovelDescriptions(asset,[document('第145章\n陆小凤和蛇王在喝酒。',145),document('第146章\n蛇王府阁楼上灯火明亮，窗边放着木桌。',146)]);
 assert.equal(result.descriptionCount,0);assert.equal(result.excerpts[0].quote,'陆小凤和蛇王在喝酒。');assert.ok(!result.excerpts.some(e=>e.quote.includes('阁楼')));
});

test('检索覆盖同工程其他附带章节，排除制作文档，已读原件优先于未核对的摘录',()=>{
 const asset=row('prop','青玉佩',{sources:[{novelLocation:'第84章 第4行',novelQuote:'资料中的摘录'}]}),project={id:'p',productionPackage:{manifest:[{relativePath:'小说原文/第85章.txt'},{relativePath:'小说原文/第84章.txt'},{relativePath:'制作分镜.txt'}]}};
 const docs=assetNovelSourceDocuments(project,asset);assert.deepEqual(docs.map(d=>d.chapter),[84,85]);assert.ok(docs.every(d=>d.url.includes('/novel-source?chapter=')));
 const result=findAssetNovelDescriptions(asset,[document('青玉佩已经不见了。'),document('青玉佩通体碧绿，雕着花纹。',85)]);assert.equal(result.excerpts[0].chapter,85);assert.equal(result.excerpts[0].descriptive,true);assert.ok(!result.excerpts.some(e=>e.quote.includes('资料中的摘录')));
 const fallback=findAssetNovelDescriptions(asset,[]);assert.equal(fallback.excerpts[0].imported,true);assert.equal(fallback.descriptionCount,0);assert.match(assetNovelDescriptionsMarkup(project,asset,fallback),/未核对原件/);
});

test('引文和上下文转义HTML；重复来源去重，文件行号和完整上下文可核查',()=>{
 const quote='测试人物身穿黑色长衫。<img src=x onerror="bad()">',asset=row('character','测试人物'),result=findAssetNovelDescriptions(asset,[document('上一段\n'+quote+'\n下一段'),document(quote,85)]),html=assetNovelDescriptionsMarkup({id:'p'},asset,result);
 assert.equal(result.excerpts.length,1);assert.equal(result.excerpts[0].quote,quote);assert.equal(result.excerpts[0].contextStart,1);assert.equal(result.excerpts[0].contextEnd,3);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/line=2/);assert.match(html,/<mark>测试人物<\/mark>/);
});

test('场景来源按完整状态及标点匹配原始格，不回退到屏段首格的其他房间',()=>{
 const first={id:'E076-001',segmentId:'S1',source:{file:'分镜.json',row:1},production:{},original:{'当前场景':'五羊城·金府书房','画面内容':'金府内容','原文摘录':'金府对白'}};
 const target={...structuredClone(first),id:'E076-010',source:{file:'分镜.json',row:10},original:{'当前场景':'五羊城·蛇王府厅堂','画面内容':'蛇王和陆小凤喝酒','原著位置':'第145章 第89—99行','原文摘录':'陆小凤和蛇王在喝酒。'}};
 const project={productionPackage:{episodes:[{episode:76,segments:[{id:'S1'}],panelRecords:[first,target]}]},shots:[{id:'shot',description:'首格的错误后备内容'}]},panel={id:'panel',productionSegment:'S1',shotId:'shot'};
 const sources=assetProvenance(project,panel,{role:'scene',name:'五羊城·蛇王府',state:'五羊城 · 蛇王府厅堂'});assert.equal(sources.length,1);assert.equal(sources[0].code,'E076-010');assert.equal(sources[0].novelQuote,target.original['原文摘录']);
 assert.deepEqual(assetProvenance(project,panel,{role:'scene',name:'不存在的场景',state:'不存在的房间'}),[]);
});
