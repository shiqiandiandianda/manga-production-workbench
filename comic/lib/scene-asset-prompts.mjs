// Scene assets describe one persistent space. Storyboard prose remains in the
// source record; only environmental facts belong in the image request.
import {isBlockingAsset} from '../public/scene-blocking.js';
import {sceneBlockingPrompt} from './scene-blocking-prompt.mjs';
const text=value=>typeof value==='string'?value.trim():'';
export const ASSET_VISUAL_PROMPT_VERSION=2;
export function asset2DStyle(style=''){
 const accents=[...new Set(text(style).match(/水墨|水彩|黑白|日漫|美漫|厚涂|淡彩/g)||[])];
 return '二维动漫手绘风格，清晰线稿、平面色块、赛璐璐上色，以手绘明暗表现空间和材质'+(accents.length?'；线色表现：'+accents.join('、'):'')+'。禁止3D国漫、三维建模、CG渲染、游戏引擎渲染、照片写实、PBR材质、塑料模型和微缩模型展示效果。参考图只约束造型、配色与空间，不能带入三维渲染风格。';
}
const environment=/门|窗|墙|梁|柱|廊|檐|屋|房|阁|亭|殿|院|室|宿舍|雅间|道路|林道|林荫道|山路|山门|石阶|台阶|围栏|栏杆|庭|地面|地板|砖|石板|树|竹|草|花坛|山体|山峰|岩壁|河|湖|天空|云|雾|桌|椅|凳|床|柜|架|屏风|灯|烛|茶|杯|碗|碟|餐具|早点|书|入口|出口|通道|光|阴影|日间|清晨|上午|中午|午后|黄昏|傍晚|夜|晴|阴天|雨|雪|风格|材质|木质|木构|木色|铜|青石/u;
const actor=/抬手|举手|摆手|挥手|侧头|望向|望两友|望宋|望叶|看向|目光|神色|眉眼|眉毛|嘴角|表情|落座|坐直|收拳|蓄势|步行|同行|走来|走去|交谈|说话|解释|倾听|听话|双手|左手|右手|手指|半张脸|背影|侧脸|腰间|身上/u;
const excludedLabel=/^(?:人物(?:与表情)?|角色|动作|站位|构图|情绪|对白|台词|气泡|版式|文字|不要|负向|其余随身道具|本次服装|服装与状态|附图说明|画风|候选外观补充|输出要求|观察机位|固定机位与轴线|反打机位与朝向|反打画面描述|空间细节与固定关系|同空间约束|二维画风|参考与补充规则)/u;
function sourceOnly(source){
 let value=text(source);
 const clean=/【空间设定】\s*([\s\S]*?)(?=\n【|$)/u.exec(value);if(clean)return clean[1];
 const legacy=/当前格分镜原文[^\n]*\n([\s\S]*)/u.exec(value);if(legacy)value=legacy[1];
 return value.replace(/\r/g,'').slice(0,30000);
}
export function sceneFacts(source,{name=''}={}){
 const value=sourceOnly(source),names=new Set();
 const cast=value.split('\n').filter(line=>/^(?:人物(?:与表情)?[：:]|【人物】)/u.test(line.trim())).join('\n');
 for(const match of cast.matchAll(/(?:^|[；;、\n：:])\s*([\p{Script=Han}]{2,8})[（(]/gu))names.add(match[1]);
 for(const match of value.matchAll(/附图\d+[（(]([\p{Script=Han}]{2,8})[·｜|]/gu))names.add(match[1]);
 const seats=[...new Set([...value.matchAll(/([东西南北]{1,2})席/gu)].map(m=>m[1]))],facts=[];
 if(seats.length)facts.push('圆桌'+seats.map(s=>s+'侧').join('、')+'保留清楚的空座与就座空间');
 let skip=false;
 for(let line of value.split('\n')){
  line=line.trim().replace(/^[-·•]\s*/u,'');if(!line)continue;
  const heading=/^(?:【([^】]+)】|([^：:]{1,18})[：:])/u.exec(line),label=heading&&(heading[1]||heading[2]);
  if(label){skip=excludedLabel.test(label);line=line.slice(heading[0].length);}
  if(skip||/^(?:制作漫画生产用|没有对应参考图|输出一张|分镜未指定|严格遵守|不绘制对白|结果是|来源文字|画一页|本段讲的是|第\d+排|统一画风|二维动漫|禁止3D)/u.test(line))continue;
  line=line.replace(/各人杯碗分开/gu,(seats.length===3?'三个':'各个')+'就座位置的杯碗分别摆放');
  for(let clause of line.split(/[，。；;]/u)){
   clause=clause.trim();if(!clause||/席.*朝[东西南北]/u.test(clause)||actor.test(clause)||/\d+\s*[:：]\s*\d+|\d+\s*[×x]\s*\d+|气泡|字幕|格子|画面张力|界面|水印|参考图|设定卡|漫画|3D|三维|CG|渲染|PBR/iu.test(clause))continue;
   if([...names].some(n=>clause.includes(n)))continue;
   if(environment.test(clause))facts.push(clause.replace(/^(?:画面|场景|地点|光影|光照|画面里的道具)[：:]\s*/u,''));
  }
 }
 return [...new Set(facts)].join('；').slice(0,9000)||'地点：'+(name||'当前场景')+'；尚无可靠的门窗、道路或陈设描述，依据地点用途制作简洁的原创空间候选';
}
const directionNames=['北','东北','东','东南','南','西南','西','西北'];
const opposite=d=>directionNames[(directionNames.indexOf(d)+4)%8];
function directionPair(value){
 const match=/(?:由|从)?(东北|东南|西北|西南|东|西|南|北)(?:侧|端|面|方)?[，,\s]*(?:向|往|朝)(东北|东南|西北|西南|东|西|南|北)/u.exec(value);
 return match&&match[1]!==match[2]?{from:match[1],to:match[2]}:null;
}
export function sceneCameraPlan(record){
 const camera=text(record.sceneMeta?.camera),explicit=directionPair(camera),reverse=directionPair(text(record.reverseCamera));
 if(explicit&&reverse&&(explicit.from!==reverse.to||explicit.to!==reverse.from))throw Error('正打与反打朝向不一致：请将反打设为'+explicit.to+'向'+explicit.from+'，或修改正打后重新生成');
 // A shot's screen coordinates never become room coordinates. Unspecified axes
 // use an explicit candidate axis shared by both requests.
 const pair=explicit||(reverse?{from:reverse.to,to:reverse.from}:{from:'南',to:'北'}),back={from:pair.to,to:pair.from};
 const overhead=/正俯|垂直俯|鸟瞰|顶视|90[°度]/u.test(camera),elevation=overhead?'斜俯视，保留俯看地面的需求并露出墙面与家具立面，避免垂直顶视导致反打只剩画面旋转':/俯/u.test(camera)?'轻度俯视，清楚看到桌面或地面，也能看到物件侧面':/仰/u.test(camera)?'低机位轻度仰视':'平视或轻度俯视';
 return {front:'相机A位于主要空间'+pair.from+'侧，朝'+pair.to+'观察；'+elevation,reverse:'相机B移动到主要空间'+back.from+'侧，朝'+back.to+'拍摄原相机A所在一侧；保持相近视高、焦距与俯仰幅度',axis:pair.from+'—'+pair.to+'轴线',explicit:Boolean(explicit),from:pair.from,to:pair.to,reverseFrom:back.from,reverseTo:back.to,opposite:opposite(pair.to)};
}
export function sceneAssetSpec(record){
 const original=text(record.prompt),facts=sceneFacts(original,{name:record.name}),meta=record.sceneMeta||{};
 const time=text(meta.time)||(facts.match(/清晨|黎明|上午|中午|午后|下午|傍晚|黄昏|深夜|夜晚|夜里|夜间/u)||[])[0]||'',weather=text(meta.weather)||(facts.match(/晴天|阴天|雨天|雪天|晴|小雨|大雨|下雪/u)||[])[0]||'';
 return {facts,time,weather,plan:sceneCameraPlan(record),indoor:/雅间|室内|宿舍|卧室|书房|大厅|殿内|屋内|房间/u.test(record.name+' '+facts)};
}
function common(record,project){
 const spec=sceneAssetSpec(record);
 return {spec,lines:['【空间设定】',spec.facts,'【时间与光照】',[spec.time&&'时间：'+spec.time,spec.weather&&'天气：'+spec.weather].filter(Boolean).join('；')||'采用空间设定中明确的时间与天气；没有明确依据时使用自然、清楚的候选光照。','光源在空间中的实际位置固定，反打后只改变它在画面中的投影位置；光照采用二维手绘色块与受控阴影。','【二维画风】',asset2DStyle(project?.style)]};
}
export function sceneFrontPrompt(record,project={}){
 if(isBlockingAsset(record))return sceneBlockingPrompt(record);
 const {spec,lines}=common(record,project);
 return ['绘制漫画生产用场景「'+record.name+'」的正打主景。16:9横版，单幅完整的二维动漫无人场景。',...lines,'【固定机位与轴线】',spec.plan.front,(!spec.plan.explicit?'原文未明确拍摄方位，本次以'+spec.plan.axis+'作为候选拍摄轴线；这不是原著已确认的方位。':'按明确的拍摄方位固定机位。')+(record.sceneMeta?.camera?'来源机位用途：'+record.sceneMeta.camera+'。':''),'【空间与陈设要求】',spec.indoor?'清楚呈现主要室内区域、门窗与固定家具；桌椅尺度合理，入口与活动通道畅通。不要添加没有依据的床、书桌或灯具。':'清楚呈现主路径或活动区域、入口出口、地形层级和资料中明确的固定地标。不要凭空添加石灯、牌坊或建筑。','先确定同一空间中固定物件的位置和朝向，再按机位判断可见部分；镜头身后或被遮挡的物件无需强行塞进画面。','【参考与补充规则】',record.referenceIds?.length?'已有场景参考只约束同一地点的建筑、陈设、造型和配色；改变观察位置时保持它们的空间关系。':'没有对应参考时只补足可使用的简洁空间；未明确的建筑外观、材质与装饰属于原创候选，不新增剧情设定。','【输出要求】','画满单幅连续场景，清晰线稿与平涂色块；无人物、人体局部、人物剪影、随身兵器、文字、对白气泡、水印、边框、多格拼贴和UI。'].join('\n');
}
export function sceneReversePrompt(record,project={}){
 if(isBlockingAsset(record))return sceneBlockingPrompt(record);
 const {spec,lines}=common(record,project),indoor=spec.indoor;
 const plan=record.scenePlan||spec.plan;
 const knownAxis=record.scenePlan||plan.explicit;
 const front=knownAxis?plan.front:'相机A是附图实际拍摄位置；以附图前景到远景的主空间轴线为准，不把未标明的机位强行认定为南侧';
 const reverse=knownAxis?plan.reverse:'相机B移动到附图主体的远端一侧，转向原相机A所在的近端区域；观察方向与附图相反，保持相近视高与焦距';
 return ['生成场景「'+record.name+'」的反向机位图。附图是本记录当前正视图，是同一空间的唯一视觉依据。16:9横版，单幅完整二维动漫空场景。','【本次摄影机任务】',front+'。',reverse+'。',record.reverseCamera?'用户指定反打机位：'+record.reverseCamera+'。保留与正打相反的观察方向，按指定位置判断视野。':'以相机B为实际拍摄位置，朝相机A所在区域观察。','相机必须跨到主体另一侧重新取景，不是原地转头，不是水平翻转，不是把正视图左右镜像；不得用旋转或微调原图充数。',...lines,'【反向可见区域】',indoor?'背景转为原相机A所在一侧的墙面和空间；原正打远端墙面现在位于相机B身后，不再照搬为反打背景。家具朝向新机位的一面、椅背或柜体的可见面以及前后遮挡顺序随新视角改变。':'沿原路径的相反方向观察来路，展现原相机A一侧的地形、路径延伸和固定地标朝向相机B的一面；不能继续画原正打的同一处远景尽头。',record.reverseDescription?'反打画面补充：'+sceneFacts(record.reverseDescription,{name:record.name}):'原图没有展示的反向区域，仅根据空间设定和建筑结构作简洁、合理的候选延续。','【固定关系与可见性】','建筑、道路、门窗、家具、地标的空间位置、朝向、数量、结构、尺度和配色保持一致；不能为了构图移动物件。屏幕左右可以随反向观察改变，但必须同时改变可见面、遮挡关系和背景区域。',record.reverseDetails?'空间细节与固定关系：'+sceneFacts(record.reverseDetails,{name:record.name}):'仅使用空间设定或附图中实际存在的物件，不默认添加门楼、树木、石灯或台阶。','镜头身后、画面外及完全遮挡的物件不画；门窗不要求全部入镜。沿用同一时间、天气和实际光源方向。','【输出自检】','对照正打：反打背景是否来自原机位一侧？物体可见面与遮挡是否改变？如果只换了左右、光色或裁切，仍然是错误结果，必须按相机B重新绘制。','整幅画面无人，无文字、对白气泡、水印、边框、多格拼贴或UI。'].join('\n');
}
export const PROP_CARD_LAYOUT_RULES='道具卡固定为3:2横版纯白底，所有内容在同一张图内一次生成。顶部只写道具名称。左侧约三分之二为完整主视图，主体尽量大，长条兵器沿横向完整摆放，剑尖、剑柄与护手均不裁断；右侧约三分之一自上而下固定为侧视图、背面视图、关键结构局部，标注对应的简短视图名称。各视图之间留白，均为同一件道具，结构、材质、颜色和纹样一致，不改成不同设计，不用正面缩放或镜像代替其他观察面。结构局部只放资料或参考中确实存在的连接、开合、镶嵌等细节，没有额外结构时留白，不捏造功能。';
export function propAssetPrompt(record,project={}){
 // A prop description can contain human anatomy (e.g. a hand-shaped pendant),
 // so preserve its structure rather than applying the scene extractor to it.
 let description=text(record.prompt).replace(/^.*(?:本次服装\s*\/|人物与表情|动作[：:]|其余随身道具|不要[：:]|画风[：:]).*$/gmu,'');
 description=description.split(/\n|[。；]/u).filter(s=>!/(?:3D|三维|CG|PBR|渲染|照片写实|游戏引擎)/iu.test(s)).join('。').trim();
 return ['绘制二维动漫道具设定：'+record.name+'。','只制作这一项独立道具，主体完整、轮廓清楚，结构、配色、纹样与功能细节以资料和对应参考为准。',description,'【统一道具卡版式】',PROP_CARD_LAYOUT_RULES,'画风：'+asset2DStyle(project?.style),'以清晰手绘线稿和平涂色块表现材质。来源中其他拼版指令仅作物件外观依据，最终以本次固定栏目为准。','参考仅用于保持同一物件的外形、结构和配色，不复制参考的摄影或三维渲染质感。','只允许道具名称和上述视图标签，不画持有者、手、人物、剧情场景、比例尺、无关文字、编号、对白气泡、水印或UI。未明确的结构只作为原创候选。'].filter(Boolean).join('\n');
}
