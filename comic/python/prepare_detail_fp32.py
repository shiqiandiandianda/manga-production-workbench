"""Promote official ONNX floating-point types to FP32 in a separate local copy."""
from pathlib import Path
import argparse
import hashlib
import json
import onnx
from onnx import TensorProto, AttributeProto, numpy_helper
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
source, target = Path(args.input), Path(args.output)
if source.resolve() == target.resolve():
    raise ValueError('转换必须另存文件，保留官方模型')
expected = '979fa0f8247ceffdc66281bfabd0666dbbfb60b8585710a5514de033a8d8619f'
if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
    raise ValueError('原文件不是已核验的官方2倍FDAT-M ONNX，请先核对版本')
target.parent.mkdir(parents=True,exist_ok=True)
model = onnx.load(str(source))
low = {TensorProto.FLOAT16, TensorProto.BFLOAT16}
counts = {'tensors':0,'types':0,'casts':0}

def tensor(t):
    if t.data_type in low:
        name = t.name
        converted = numpy_helper.from_array(numpy_helper.to_array(t).astype(np.float32), name=name)
        t.CopyFrom(converted)
        counts['tensors'] += 1

def value(v):
    if v.type.HasField('tensor_type') and v.type.tensor_type.elem_type in low:
        v.type.tensor_type.elem_type = TensorProto.FLOAT
        counts['types'] += 1

def graph(g):
    for t in g.initializer:
        tensor(t)
    for v in list(g.input)+list(g.output)+list(g.value_info):
        value(v)
    for node in g.node:
        for a in node.attribute:
            if a.type == AttributeProto.TENSOR:
                tensor(a.t)
            elif a.type == AttributeProto.TENSORS:
                for t in a.tensors:
                    tensor(t)
            elif a.type == AttributeProto.GRAPH:
                graph(a.g)
            elif a.type == AttributeProto.GRAPHS:
                for sub in a.graphs:
                    graph(sub)
            elif node.op_type in ('Cast','RandomNormal','RandomUniform','RandomNormalLike','RandomUniformLike','EyeLike','Bernoulli') and a.name in ('to','dtype') and a.i in low:
                a.i = TensorProto.FLOAT
                counts['casts'] += 1

graph(model.graph)
onnx.checker.check_model(model)
onnx.save(model,str(target))
report={'source':str(source),'output':str(target),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'conversion':'BF16 and FP16 tensors, value types and cast destinations promoted to FP32; original retained','counts':counts}
target.with_suffix('.manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=True))
