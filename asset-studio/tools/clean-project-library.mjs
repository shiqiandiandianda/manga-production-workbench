import fs from 'node:fs';

const base = 'http://127.0.0.1:18909';
const projectId = 'project_ea8b8f5d-8a90-4a6f-86bf-5b015c46f0cb';
const files = [
  'D:/漫画工具整体代码/data/asset-library/character/CHAR_001_叶麟_CO003_太玄预备杂役道袍_正面_标准卡_v1.png',
  'D:/漫画工具整体代码/data/asset-library/character/CHAR_002_王长生_CO002_世家少年常服_正面_标准卡_v1.png',
  'D:/漫画工具整体代码/data/asset-library/character/CHAR_003_宋凌天_CO001_世家少年常服_正常_标准卡_v1.png',
  'D:/漫画工具整体代码/data/asset-library/character/宋凌天｜灵剑峰内门道袍_1792475074396.png',
  'D:/漫画工具整体代码/data/asset-library/prop/宋凌天｜灵剑峰内门道袍_服装设计_1792473338651.png',
  'D:/漫画工具整体代码/data/asset-library/prop/宋凌天｜灵剑峰内门道袍_手部卡_1792474996660.png',
  'D:/漫画工具整体代码/data/asset-library/prop/宋凌天｜手部卡_竖版_1792474133855.png',
  'D:/漫画工具整体代码/data/asset-library/prop/蓝虹剑_PR004_比例修正_标注.png',
  'D:/漫画工具整体代码/data/asset-library/standard/宋凌天_CO005_拼装_3840.png'
];
for (const file of files) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
}

async function project() {
  return await (await fetch(`${base}/api/projects/${projectId}`)).json();
}

let p = await project();
console.log('before', p.revision, p.assetLibrary?.assetIds?.length);

let response = await fetch(`${base}/api/projects/${projectId}/asset-library`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({type: 'clear', revision: p.revision})
});
console.log('clear', response.status);
if (!response.ok) {
  console.error((await response.text()).slice(0, 600));
  process.exit(1);
}

for (const file of files) {
  p = await project();
  response = await fetch(`${base}/api/projects/${projectId}/asset-library`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({type: 'images', filePaths: [file], revision: p.revision})
  });
  const text = await response.text();
  console.log('add', file.split('/').pop(), response.status, text.slice(0, 160));
  if (!response.ok) process.exit(1);
}

p = await project();
console.log('after', p.revision, p.assetLibrary?.assetIds?.length);
