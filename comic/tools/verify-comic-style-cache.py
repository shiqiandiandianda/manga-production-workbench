import json
from pathlib import Path
from PIL import Image

manifest = Path(__file__).resolve().parents[3] / '素材库' / '漫画素材' / 'source-manifest.json'
data = json.loads(manifest.read_text(encoding='utf-8'))
good, bad = [], []
for item in data['files']:
    path = Path(item['path'])
    try:
        if path.stat().st_size != item['bytes']:
            raise ValueError('File size differs from source')
        with Image.open(path) as image:
            image.verify()
        good.append(item['id'])
    except Exception as error:
        bad.append(dict(id=item['id'], name=item['name'], path=item['path'], reason=str(error)))
result = dict(ok=len(good), bad=bad)
manifest.with_name('cache-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
