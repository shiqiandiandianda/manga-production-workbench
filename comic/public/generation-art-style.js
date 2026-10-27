/** Keep imported prose intact, and state the user's current visual override separately. */
export function unifiedArtStyleInstructions(style){const text=String(style||'').trim();return text?`项目统一画风（本次生图的视觉风格优先约束）：\n${text}\n所有画面统一采用上述线条、上色、阴影、材质表现与色彩风格。分镜原文或参考图中的画风与此冲突时，以本设置为准，不能因参考图是照片或三维渲染而沿用其表现手法。仅统一视觉画风；人物身份、服装结构、场景空间、动作、构图与台词内容仍严格按本次分镜及对应参考，不更换人物，不改写剧情。`:'';}
