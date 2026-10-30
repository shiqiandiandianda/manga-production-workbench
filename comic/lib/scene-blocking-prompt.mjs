export const SCENE_BLOCKING_PROMPT_VERSION=2;
export function sceneBlockingPrompt(record){
 if(record.prompt?.startsWith('【人物站位图模板 v2】')&&!record.source?.blocking&&!record.blocking&&!record.blockingDescription)return record.prompt;
 const info=record.source?.blocking||record.blocking||{},body=info.description||record.blockingDescription||/【场景初始站位】\n([\s\S]*?)(?=\n【|$)/u.exec(record.prompt||'')?.[1]||record.prompt||'',scene=info.scene||record.name||'当前场景';
 const characters=info.characters||[],references=info.references||[];
 const description=String(body).replace(/略俯视|高位斜俯视|斜俯视/gu,'正上方俯视');
 return `【人物站位图模板 v${SCENE_BLOCKING_PROMPT_VERSION}】
生成“${scene}”当前场景参考图对应的人物站位关系图，供使用这张场景图的后续分镜共用。
单幅16:9横向画面，二维动漫手绘、清晰线稿和平面色块。禁止3D国漫和写实渲染。

【附图用途】
${references.length?references.map(r=>`图${r.index}：${r.name}${r.state?' · '+r.state:''}；${r.role==='character'?'只参考本人外貌、发型、服装和体型，不照搬设定卡的站姿或排版':r.role==='scene'?'参考建筑、门窗、家具及通道的空间结构':'参考道具外观、结构和材质'}。`).join('\n'):'使用实际附带的场景、人物和道具图，人物身份与服装以对应资产为准。'}

【场景初始站位】
${description}

【固定俯视与姓名要求】
镜头统一从正上方向下俯视，以清楚交代人物位置、朝向、彼此距离和场景结构为目标，不使用平视、斜侧全景或人物特写。
展示完整身体及落脚位置，人物处于同一地面，比例统一；室内以俯视示意方式露出内部，屋顶不能遮住人物。门、桌、院墙和通道等主要空间锚点清楚可见。
在每个人物头部上方标出对应的真实中文姓名${characters.length?'：'+characters.map(p=>p.name).join('、'):''}。
姓名横向排列、清晰可读，浅色底深色字，靠近对应人物，不遮住人物或重要结构；必要时用短引线指向本人。每人对应一个标签，不漏标、不串名、不用“人物1”等占位名。
未提供姓名的配角使用分镜中的原有称呼（如百户、缇骑），群像按原有身份标识，不编造人名。
只标人物姓名，不生成对白、气泡、说明段落、分格或角色卡拼版。
本图只建立场景初始空间关系；后续动作、表情及镜头变化交给各格分镜。同一张场景参考图始终共用这一张站位图，再次使用原场景图时沿用原站位图；只有更换场景参考图时才新建站位图，不能因分镜顺序、人物动作或文字场景名称变化而另建。固定俯视与姓名规则优先于来源描述中的旧镜头措辞。`;
}
