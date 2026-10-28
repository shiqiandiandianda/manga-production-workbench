export const DEFAULT_POSITIVE_CONSTRAINTS=`画面干净通透，整体细节克制且有层次，主体与关键叙事区域清晰，背景细节适度简化。材质表现符合物体属性，平滑区域保持连续自然，粗糙、织物及破损区域保留必要的结构与纹理，避免无意义的碎小细节堆积。

远处人物、建筑和环境以可辨识的轮廓与主要结构为主，细节密度及边缘清晰度服从景深与空气透视。采用符合既定漫画画风的空间层次与自然景深，焦点区域细腻清晰，非焦点区域柔和过渡。

光影逻辑统一，色彩干净，明暗关系符合各格场景与光源设定。严格保持既定漫画画风和角色基础设定，各格构图及主副格安排遵循对应分镜。服装发型在连续场景中保持合理延续，并允许剧情和动作所需的变化。

保留符合剧情与既定画风的法术特效、雨雪、烟尘、飞溅、火星、污渍、破损、运动痕迹及漫画表现手法。保留关键叙事区域所需的局部高细节。只清除无物理、叙事或明确绘画设计依据的视觉噪点，不削弱剧情所需的动态表现。`;

export const DEFAULT_NEGATIVE_PROMPT=`无依据的碎小纹理、随机颗粒、杂色斑点、噪纹、随机锐化痕迹，人体畸形、头身比例错误、肢体扭曲、关节反折、多手多脚、多指少指、手指粘连、手掌结构错误、错误的抱拳及持物姿势，人物穿模、肢体穿透、衣物穿模、道具穿模，动作僵硬、无动作依据的重心失衡、物理接触错误，五官错位、脸部崩坏、角色串脸、人物错误融合、同格无依据的重复人物、无关群众同脸，不符合角色设定与透视关系的人物身高比例，无剧情或动作依据的服装发型变化，透视错误、遮挡关系混乱、场景结构错误、无剧情依据的物体悬浮、应出现的关键道具缺失、无分镜依据的多余人物及物体，不符合分镜设计的主体出框、关键叙事部位被意外裁切，分格混乱、格间图像误融合、人物道具或背景无设计依据地侵入相邻格、无分镜依据的重复画面，画风不统一、线条杂乱、颜色意外溢出，焦点区域意外失焦、本应清晰的关键叙事细节模糊、整体低清晰度，3D塑料质感、偏离既定漫画画风的过度写实，错误文字、乱码、未经要求的多余文字、错误气泡、气泡意外遮挡关键叙事区域、水印。
头发区域出现无依据的细碎三角色块、三角面拼接、低多边形切面、碎片化明暗斑块，发束结构破碎、断裂或走向混乱。`;

export const DEFAULT_IMAGE_CONSTRAINTS=`正向约束\n${DEFAULT_POSITIVE_CONSTRAINTS}\n\n\n负面提示词\n${DEFAULT_NEGATIVE_PROMPT}`;

// Append only at submission time; never write the defaults into imported source or saved overrides.
export function appendDefaultImageConstraints(prompt){
 return prompt.endsWith(DEFAULT_IMAGE_CONSTRAINTS)?prompt:[prompt,DEFAULT_IMAGE_CONSTRAINTS].filter(Boolean).join('\n\n');
}

export function resolveNegativePrompt(value){return typeof value?.negativePrompt==='string'?value.negativePrompt:'';}
export function negativePromptInstructions(value){return resolveNegativePrompt(value);}
