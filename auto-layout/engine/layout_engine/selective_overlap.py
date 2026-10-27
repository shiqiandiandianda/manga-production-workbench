"""Versioned necessity evidence for future layouts; old packets stay valid under old rules."""

RULES='''
用户本轮叠格要求优先：默认采用紧密分离或错位，只有叠合比两种替代更有必要时才叠。全话可以零处，不设置次数或比例目标；保留原主副格、竖幅、景别、构图、节奏和学习来源。
普通接话、重复评价、同人续说、落手/端茶等装饰或状态动作，优先分离；同场、同景别、直接因果、反应或动作标签均不足以单独证明需要叠格。不为减少留白或增加变化而叠。
对每处实际叠格，先比较相同剧情下的小间距分离和错位。necessityLevel若只是optional，应改为分离/错位并移除该叠格决策；仅在具体动作即时打断、因果冲击或必要焦点转移明显需要紧扣时可标required。
separationCost具体说明不用叠合、改成紧密分离或错位会损失什么本镜头叙事效果，至少12字；不重复“增强层次/同场/有因果/视觉变化”等通用话术。sourceAnchors恰好引用前后两格各一条description或dialogue连续原文，标正确shotCode；不得添加、改写或虚构剧情来证明必要性。
仍须逐处写原景别尺度、双方保护内容、叠角与叠深依据；不得统一右下或固定叠深。找不到安全遮让位置就分离，不以比例合格代替主体保护。所有实际遮挡继续标pending_artwork，不宣称已通过成图避让。此要求不改气泡、不改剧情、不生成或裁切图片。
'''

def selective_prompt(prompt):
    prompt=prompt.replace('主动评估并在合适处采用角部错位轻叠','只在叙事确有必要且优于紧密分离时采用角部错位轻叠')
    prompt=prompt.replace('也不能继续整话一律避叠。','全话没有必要的叠格时允许零处。')
    return prompt+RULES

def validate_selective_overlap(packet,script):
    shots={s['key']:s for s in script['shots']} if script else {}
    errors=[]
    for d in packet.get('overlapDecisions',[]):
        label=str(d.get('toShotCode','未知格'))+'叠格必要性：'
        if d.get('necessityLevel')!='required':errors.append(label+'可有可无的叠格应改为紧密分离或错位')
        cost=d.get('separationCost')
        if not isinstance(cost,str) or len(cost.strip())<12:errors.append(label+'缺少与紧密分离/错位比较的具体叙事损失')
        anchors=d.get('sourceAnchors');pair=[d.get('fromShotCode'),d.get('toShotCode')]
        if not isinstance(anchors,list) or len(anchors)!=2 or [a.get('shotCode') for a in anchors if isinstance(a,dict)]!=pair:
            errors.append(label+'须按前后顺序各引用一条本格原文');continue
        for a in anchors:
            shot=shots.get(a['shotCode']);quote=a.get('quote')
            if not shot:errors.append(label+'引用了非本话镜号');continue
            fields=[str(shot.get(k,'')) for k in ('description','dialogue')]
            if not isinstance(quote,str) or not quote or not any(quote in field for field in fields) or len(quote)<4 and (quote not in fields or not any(c.isalnum() for c in quote)):
                errors.append(label+'原文引用不属于对应画格或短句被截断')
    if errors:raise ValueError('；'.join(dict.fromkeys(errors)))
    return True
