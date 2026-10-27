from artwork_framing import frame_artwork
import copy
import hashlib
import json
import math
import re
import statistics


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def learned_profile(references):
    samples = []
    gaps, overlaps, group_sizes, relationships = [], [], [], []
    for ref in references:
        all_frames = sorted(ref['frames'],key=lambda p:(p['y'],p['x']))
        source_indices = {p['referenceFrameId']:i for i,p in enumerate(all_frames)}
        accepted = [p for p in ref["frames"] if p.get("review") == "checked"]
        accepted.sort(key=lambda p: (p["y"], p["x"]))
        width = ref["sourceWidth"]
        last_main = None
        for i, p in enumerate(accepted):
            q = {k: round(p[k] / width, 5) for k in ("x", "y", "w", "h")}
            q.update(referenceId=ref["id"], frameId=p["referenceFrameId"], role=p.get("role", "support"))
            samples.append(q)
            if q["role"] == "main":
                if last_main is not None and all(f.get('review')=='checked' for f in all_frames[source_indices[accepted[last_main]['referenceFrameId']]:source_indices[p['referenceFrameId']]+1]):
                    group_sizes.append(i - last_main)
                last_main = i
            if i and source_indices[p['referenceFrameId']] == source_indices[accepted[i-1]['referenceFrameId']]+1:
                prev = accepted[i-1]
                gap = (p["y"] - prev["y"] - prev["h"]) / width
                ix=max(0,min(prev['x']+prev['w'],p['x']+p['w'])-max(prev['x'],p['x']))
                iy=max(0,min(prev['y']+prev['h'],p['y']+p['h'])-max(prev['y'],p['y']))
                area=ix*iy
                relationships.append({'id':ref['id']+':'+prev['referenceFrameId']+'>'+p['referenceFrameId'],'referenceId':ref['id'],'fromFrameId':prev['referenceFrameId'],'toFrameId':p['referenceFrameId'],'gapRatio':round(gap,5),'horizontalShiftRatio':round((p['x']-prev['x'])/width,5),'intersectionAreaRatioOfSmaller':round(area/min(prev['w']*prev['h'],p['w']*p['h']),5),'relation':'overlap' if area and iy/width>.02 else 'boundary_uncertain' if area else 'staggered' if gap<0 else 'separated','measurement':'相邻已核对候选；无精确脚本映射，不自动赋予转场语义'})
                if .04 < gap < 1.5:
                    gaps.append(gap)
                elif -.45 < gap < -.02:
                    overlaps.append(-gap)
    mains = [s for s in samples if s["role"] == "main" and s["h"] > s["w"]]
    supports = [s for s in samples if s["role"] == "support" and .35 < s["h"] / s["w"] < 2.8]
    return {
        "version": digest({'samples':samples,'relationships':relationships,'methodVersion':'relationships-v1'})[:12], "referenceCount": len(references), "checkedCount": len(samples),
        "methodVersion":"relationships-v1",
        "candidateCount": sum(len(r["frames"]) for r in references),
        "samples": samples, "mainSamples": mains, "supportSamples": supports,
        "relationships":relationships,
        "groupSizes": [n for n in group_sizes if 2 <= n <= 6],
        "positiveGapRatio": statistics.median(gaps) if gaps else .16,
        "overlapRatio": statistics.median(overlaps) if overlaps else 0,
        "policy": {"canvasWidth": 1280, "minimumPortraitRatio": .7, "independentGroupGap": 320},
        "method": "同时归纳单格与相邻格的二维组合、实际交叠、错位和间隙；局部原图核实的组合优先。主格身份不等于转场，不能把统一大间隙施加给全部画格。不是权重训练，候选几何仍存在测量误差。",
    }


def scene_color(shot):
    context = str(shot.get("location", "")) + str(shot.get("time", ""))
    if any(t in context for t in ("夜", "墓", "坟")):
        return "#102130"
    if any(t in context for t in ("船", "海", "竹林", "户外", "码头")):
        return "#d6e3df"
    return "#bdad99"


def importance(shot):
    text = str(shot.get("description", "")) + str(shot.get("note", ""))
    score = 0
    reasons = []
    for word in ("长剑出鞘", "横斩", "踹", "撞", "倒地", "抓住", "掐", "杀", "纷纷跪", "全景", "众人", "走到门口", "推开"):
        if word in text:
            score += 2
            reasons.append(word)
    if str(shot.get("shotSize", "")) in ("全景", "远景", "大远景"):
        score += 2
        reasons.append("脚本的环境或人物关系展示")
    return score, reasons


def plan_layout(script, profile, project_id="dazhou", variant=0):
    if not script.get("shots"):
        raise ValueError("分镜为空")
    if not profile["mainSamples"] or not profile["supportSamples"]:
        raise ValueError("先在参考学习中核对至少一个竖幅主格和一个副格")
    width = 1280
    panels = []
    since_main = 0
    group_index = 0
    groups = profile["groupSizes"] or [3]
    for index, shot in enumerate(script["shots"]):
        score, reasons = importance(shot)
        previous = script["shots"][index-1] if index else None
        scene_change = previous is not None and (shot.get("location"), shot.get("time")) != (previous.get("location"), previous.get("time"))
        interval = groups[(group_index + variant) % len(groups)]
        role = "main" if index == 0 or (since_main >= 1 and (scene_change or score >= 4 or since_main >= interval)) else "support"
        pool = profile["mainSamples"] if role == "main" else profile["supportSamples"]
        sample = pool[(index * 3 + score + variant) % len(pool)]
        if role == "main":
            w = 1280
            ratio = max(1.16, min(1.85, sample["h"] / sample["w"]))
            h = round(w * ratio)
            x = 0
            since_main = 0
            group_index += 1
        else:
            w = round(max(.5, min(.79, sample["w"])) * width)
            ratio = max(1.12, min(1.75, sample["h"] / sample["w"]))
            if shot.get("shotSize") in ("特写", "大特写", "极特写") and index % 5 == 3:
                ratio = .83
            h = round(w * ratio)
            x = round(min(1-w/width, max(0, sample["x"])) * width)
            since_main += 1
        gap = max(120, min(340, round(profile["positiveGapRatio"] * width)))
        overlap = False
        if panels:
            prev = panels[-1]
            if role == "main" or scene_change:
                gap = max(320, gap)
            elif prev["role"] == "support" and not scene_change and profile["overlapRatio"] and index % 4 == 2:
                gap = -round(min(profile["overlapRatio"] * width, min(prev["h"], h) * .15))
                overlap = True
            y = max(prev["y"] + 80, prev["y"] + prev["h"] + gap)
        else:
            y = 0
        panels.append({
            "key": shot["key"], "sourceShotCode": str(shot["code"]), "readingOrder": index+1,
            "role": role, "x": x, "y": y, "w": w, "h": h, "shape": "rectangle", "border": 2, "feather": 0,
            "reference": {"id": sample["referenceId"], "frameId": sample["frameId"]},
            "placementReason": ("首个正文竖幅主格" if index == 0 else "场景变化" if scene_change else "、".join(reasons) if reasons else "同场景阅读组合") + ("；局部叠格候选" if overlap else ""),
        })
    # The policy is an existing Agent requirement, not a measured sample claim.
    if sum(p["h"] > p["w"] for p in panels) / len(panels) < .7:
        for p in panels:
            if p["h"] <= p["w"]:
                delta = round(p["w"] * 1.12) - p["h"]
                p["h"] += delta
                for later in panels[p["readingOrder"]:]:
                    later["y"] += delta
                if sum(q["h"] > q["w"] for q in panels) / len(panels) >= .7:
                    break
    packet = {
        "format": "comic-layout-geometry", "version": 1, "projectId": project_id,
        "episode": script["episode"], "title": script["title"],
        "source": copy.deepcopy(script["source"]), "sourcePanelKeys": [s["key"] for s in script["shots"]],
        "scriptContentDigest": digest(script["shots"]),
        "canvas": {"width": width, "height": max(p["y"]+p["h"] for p in panels)},
        "policy": {"preservePanelCount": True, "preserveReadingOrder": True, "composition": "source", "lettering": "downstream"},
        "profileVersion": profile["version"], "panels": panels,
    }
    packet["backgrounds"] = backgrounds(packet, script)
    validate_geometry(packet, script)
    return packet


def backgrounds(packet, script):
    groups = []
    start = 0
    for i, shot in enumerate(script["shots"]):
        key = (shot.get("location", ""), shot.get("time", ""))
        if i and key != (script["shots"][i-1].get("location", ""), script["shots"][i-1].get("time", "")):
            groups.append((start, i-1))
            start = i
    groups.append((start, len(script["shots"])-1))
    result = [];top=0
    for j, (a,b) in enumerate(groups):
        color=scene_color(script['shots'][a]);next_color=scene_color(script['shots'][groups[j+1][0]]) if j<len(groups)-1 else color
        boundary=packet['panels'][b+1]['y']-160 if j<len(groups)-1 else packet['canvas']['height']
        changing=j<len(groups)-1 and next_color!=color
        bottom=boundary-80 if changing else boundary
        result.append({"x": 0, "y": top, "w": 1280, "h": bottom-top, "color": color, "endColor": None, "mode": "solid", "name": str(script["shots"][a].get("location") or "叙事段落"), "reason": "规则试排按脚本场景和时间分段"})
        if changing:result.append({'x':0,'y':bottom,'w':1280,'h':160,'color':color,'endColor':next_color,'mode':'linear','name':'场景留白过渡','reason':'在相邻场景之间的正留白连接底色'})
        top=boundary+80 if changing else boundary
    return result


def validate_geometry(packet, script=None):
    user_constraints=None
    if packet.get('nativeUserConstraints') is not None or packet.get('generator',{}).get('mode')=='native-style-rules':
        from native_user_constraints import trusted_constraints
        user_constraints=trusted_constraints(packet)
    from native_user_constraints import dimension_errors
    errors = dimension_errors(packet,script,user_constraints)
    if packet.get("format") != "comic-layout-geometry" or packet.get("version") != 1:
        errors.append("不支持的几何布局格式")
    panels = packet.get("panels", [])
    if not isinstance(panels, list) or any(not isinstance(p, dict) for p in panels):
        raise ValueError("画格应为对象数组")
    width = packet.get("canvas", {}).get("width")
    height = packet.get("canvas", {}).get("height")
    if width != 1280 or not isinstance(height, (int,float)) or not math.isfinite(height) or height <= 0:
        errors.append("画布应为1280宽、有效正高度")
        height = 0
    expected = [s["key"] for s in script["shots"]] if script else packet.get("sourcePanelKeys", [])
    if not expected or [p.get("key") for p in panels] != expected or len(set(expected)) != len(expected):
        errors.append("格数、镜号或顺序与固定分镜不一致")
    if script and packet.get("scriptContentDigest") != digest(script["shots"]):
        errors.append("分镜正文版本已变化")
    if script and packet.get("source") != script["source"]:
        errors.append("来源身份或文件校验值发生变化")
    if packet.get("sourcePanelKeys") != expected:
        errors.append("固定镜号清单发生变化")
    if packet.get("policy") != {"preservePanelCount": True, "preserveReadingOrder": True, "composition": "source", "lettering": "downstream"}:
        errors.append("布局职责策略发生变化")
    allowed = {"key", "sourceShotCode", "readingOrder", "role", "x", "y", "w", "h", "shape", "border", "feather", "reference", "placementReason"}
    numeric_ok = True
    for i,p in enumerate(panels):
        if p.get("readingOrder") != i+1:
            errors.append(f"第{i+1}格阅读序号不一致")
        if script and (i >= len(script["shots"]) or str(p.get("sourceShotCode")) != str(script["shots"][i]["code"])):
            errors.append(f"第{i+1}格原镜号改变")
        if set(p) - allowed:
            errors.append(f"第{i+1}格混入格内构图或未支持字段")
        vals = [p.get(k) for k in ("x","y","w","h")]
        if any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in vals):
            errors.append(f"{p.get('key')}坐标不是有效数值")
            numeric_ok = False
            continue
        x,y,w,h = vals
        if x<0 or y<0 or w<=0 or h<=0 or x+w>1280.01 or y+h>height+.01:
            errors.append(f"{p.get('key')}画格超出画布或尺寸无效")
        if p.get("shape") != "rectangle" or p.get("role") not in ("main","support"):
            errors.append(f"{p.get('key')}画格类型无效")
        art=frame_artwork(script["shots"][i]) if script and i<len(script["shots"]) else None
        if art:
            aw,ah=art.get("width"),art.get("height")
            if not all(isinstance(n,(int,float)) and math.isfinite(n) and n>0 for n in (aw,ah)) or abs(h-w*ah/aw)>1.01:errors.append(str(p.get("key"))+"必须保留已有图片真实比例")
        if p.get("role") == "main" and (h<w if user_constraints else h<=w) and not art:
            errors.append(f"{p.get('key')}主格需要竖幅")
        if any(not isinstance(p.get(k),(int,float)) or not math.isfinite(p[k]) or p[k]<0 for k in ("border","feather")):
            errors.append(f"{p.get('key')}边框或羽化无效")
        prev_y = panels[i-1].get("y", -1) if i else -1
        if i and ((isinstance(prev_y,(int,float)) and y<=prev_y) or p.get("role")==panels[i-1].get("role")=="main"):
            errors.append(f"{p.get('key')}阅读位置倒序或主格相邻")
    if panels and numeric_ok:
        first = panels[0]
        first_art=frame_artwork(script["shots"][0]) if script else None
        if first.get("role") != "main" or ((first.get("h",0)<first.get("w",0) if user_constraints else first.get("h",0)<=first.get("w",0)) and not first_art):
            errors.append("第一格必须为竖幅主格")
        next_main = next((i for i,p in enumerate(panels[1:],1) if p.get("role")=="main"),len(panels))
        if any(p.get("w",0)*p.get("h",0)>=first.get("w",0)*first.get("h",0) for p in panels[1:next_main]):
            errors.append("首格面积必须大于同组副格")
        new_panels=[p for i,p in enumerate(panels) if not (script and frame_artwork(script["shots"][i]))]
        if new_panels and sum((p.get("h",0)>=p.get("w",0) if user_constraints else p.get("h",0)>p.get("w",0)) for p in new_panels)/len(new_panels)<.7:
            errors.append("当前Agent预设要求至少70%竖格")
    bgs = packet.get("backgrounds")
    if not isinstance(bgs, list) or not bgs:
        errors.append("缺少背景分段")
    else:
        end = 0
        for bg in bgs:
            if not isinstance(bg, dict) or any(not isinstance(bg.get(k),(int,float)) or not math.isfinite(bg[k]) for k in ("x","y","w","h")):
                errors.append("背景坐标无效")
                continue
            if bg['x']!=0 or bg['w']!=1280 or abs(bg['y']-end)>.01 or bg['h']<=0:
                errors.append("背景必须连续覆盖画布")
            end = bg['y']+bg['h']
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", str(bg.get("color"))) or bg.get("mode") not in ('solid','linear'):
                errors.append("背景颜色或模式无效")
            if bg.get('mode')=='solid' and bg.get('endColor') is not None:
                errors.append('纯色背景endColor必须为空')
            if bg.get('mode')=='linear':
                if not re.fullmatch(r'#[0-9a-fA-F]{6}',str(bg.get('endColor'))):errors.append('渐变结束色无效')
                if numeric_ok and any(min(bg['y']+bg['h'],p['y']+p['h'])-max(bg['y'],p['y'])>.01 for p in panels):errors.append('换色渐变跨过正文画格，应放在安全留白')
        if abs(end-height)>.01:
            errors.append("背景高度与画布不一致")
        for previous,current in zip(bgs,bgs[1:]):
            if previous.get('mode')=='linear' and str(previous.get('endColor')).lower()!=str(current.get('color')).lower():errors.append('渐变结束色未连接下一段背景')
            if previous.get('mode')=='solid' and str(previous.get('color')).lower()!=str(current.get('color')).lower():errors.append('不同底色之间缺少安全留白渐变')
    if packet.get('generator',{}).get('mode') in ('model-generated','native-style-rules') and numeric_ok:
        has_rhythm=packet.get('generator',{}).get('rhythmVersion')=='relationships-v1'
        main=None;bottom=0
        for i,p in enumerate(panels):
            if p.get('role')=='main':
                if not has_rhythm and i and p['y']-bottom<319.99:errors.append(p['key']+'新主格组前净间距小于320')
                main=p
            elif main and p['w']*p['h']>=main['w']*main['h']:errors.append(p['key']+'副格面积不小于同组主格')
            if not has_rhythm and i and script and (script['shots'][i].get('location'),script['shots'][i].get('time'))!=(script['shots'][i-1].get('location'),script['shots'][i-1].get('time')) and p['y']-bottom<319.99:errors.append(p['key']+'转场净间距小于320')
            if not has_rhythm and i and p['y']<bottom and not any(t in p.get('placementReason','') for t in ('叠','嵌')):errors.append(p['key']+'叠格缺少明确依据')
            bottom=max(bottom,p['y']+p['h'])
        if any(len({(q['w'],q['h']) for q in panels[i:i+3]})==1 for i in range(max(0,len(panels)-2))):errors.append('连续三格同尺寸')
        keys=[p['key'] for p in panels]; coverage=[]
        for section in packet.get('sections',[]):
            try:
                a,b=keys.index(section['startShotCode']),keys.index(section['endShotCode'])
                coverage.extend(keys[a:b+1])
            except (ValueError,KeyError):errors.append('叙事段落引用未知画格')
        if coverage!=keys:errors.append('叙事段落未按顺序连续覆盖正文')
        if has_rhythm:
            from .rhythm import validate_rhythm
            try:validate_rhythm(packet,script)
            except (ValueError,KeyError) as exc:errors.append(str(exc))
    if errors:
        raise ValueError("；".join(dict.fromkeys(errors)))
    return True


def public_profile(profile):
    return {k:v for k,v in profile.items() if k not in ("samples","mainSamples","supportSamples","relationships")}
