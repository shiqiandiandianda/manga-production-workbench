import argparse,hashlib,json,time
from pathlib import Path
import layout_agent as native
from native_style_layout import generate,style_book
from layout_engine.model_pipeline import save
read=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
def run(request,data,styles,out):
    started=time.perf_counter();out=Path(out);out.mkdir(parents=True,exist_ok=True)
    if (out/'geometry.json').exists():raise ValueError('已有结果，不能覆盖或重复执行')
    native.DATA=Path(data).resolve()
    manifest=read(native.DATA/'manifest.json')
    for rel,expected in manifest['files'].items():
        if hashlib.sha256((native.DATA/rel).read_bytes()).hexdigest()!=expected:raise ValueError('冻结资料摘要失配：'+rel)
    script=native.approved_script(request);profile=native.profile_for(script);evidence=native.palette_for(script);book=style_book(styles)
    prepared=time.perf_counter();packet=generate(script,profile,evidence,book);generated=time.perf_counter()
    save(out/'geometry.json',packet);save(out/'fixed-script.json',script);save(out/'style-trace.json',packet['nativeStyleTrace']);save(out/'style-book.json',book)
    elapsed=time.perf_counter()-started
    timing={'status':'done','engine':'dazhou-native-style-v1','elapsedSeconds':round(elapsed,6),'preparationSeconds':round(prepared-started,6),
        'selectionGeometryValidationSeconds':round(generated-prepared,6),'modelCalls':0,'patchCalls':0,'panels':len(packet['panels']),
        'styles':packet['generator']['stylesSelected'],'overlaps':len(packet['overlapDecisions']),'scope':'冻结文件核验到几何文件写入；不含浏览器绘制',
        'styleBookDigest':packet['generator']['styleBookDigest']}
    save(out/'timing.json',timing);print(json.dumps(timing,ensure_ascii=False),flush=True)
    return packet
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--data',required=True);p.add_argument('--styles',required=True);p.add_argument('--out',required=True);a=p.parse_args();run(read(a.input),a.data,a.styles,a.out)
