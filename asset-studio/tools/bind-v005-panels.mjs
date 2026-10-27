import fs from 'node:fs';

const base = 'http://127.0.0.1:18909';
const projectId = 'project_ea8b8f5d-8a90-4a6f-86bf-5b015c46f0cb';
const casts = JSON.parse(fs.readFileSync('D:/漫画工具整体代码/data/v005-panel-casts.json', 'utf8'));

const assetByCostume = {
  'CH003-CO001': 'asset_c41a6235-55f2-4a00-a56a-489db91398b0',
  'CH003-CO002': 'asset_c41a6235-55f2-4a00-a56a-489db91398b0',
  'CH003-CO003': 'asset_c41a6235-55f2-4a00-a56a-489db91398b0',
  'CH003-CO004': 'asset_c41a6235-55f2-4a00-a56a-489db91398b0',
  'CH003-CO005': 'asset_b76f0ccf-6f81-43e1-b28b-894221695cf4',
  'CH002-CO002': 'asset_aa5a7563-27dc-4f0d-948d-4d6e9ce02859',
  'CH001-CO003': 'asset_aed638b1-6b27-46ef-a0c3-4c4d64a7da2a'
};
const fallback = {
  CH003: 'asset_c41a6235-55f2-4a00-a56a-489db91398b0',
  CH002: 'asset_aa5a7563-27dc-4f0d-948d-4d6e9ce02859',
  CH001: 'asset_aed638b1-6b27-46ef-a0c3-4c4d64a7da2a'
};

const project = await (await fetch(`${base}/api/projects/${projectId}`)).json();
fs.mkdirSync('D:/漫画工具整体代码/data/project-backups', {recursive: true});
fs.writeFileSync(
  `D:/漫画工具整体代码/data/project-backups/${projectId}-${Date.now()}.json`,
  JSON.stringify(project, null, 2)
);

const shots = new Map((project.shots || []).map(shot => [shot.id, shot]));
let panelsChanged = 0;
let shotsChanged = 0;
let panelsWithRefs = 0;
const missing = [];

for (const page of project.pages || []) {
  for (const panel of page.panels || []) {
    const code = panel.name || '';
    const cast = casts[code];
    if (!cast || !cast.length) continue;
    const refs = [];
    for (const item of cast) {
      const assetId = assetByCostume[`${item.character}-${item.costume}`] || fallback[item.character];
      if (assetId && !refs.includes(assetId)) refs.push(assetId);
      if (!assetId) missing.push(`${code}:${item.character}-${item.costume}`);
    }
    if (!refs.length) continue;
    const before = JSON.stringify(panel.referenceIds || []);
    panel.referenceIds = refs;
    if (JSON.stringify(panel.referenceIds) !== before) panelsChanged += 1;
    panelsWithRefs += 1;
    const shot = shots.get(panel.shotId);
    if (shot) {
      const shotBefore = JSON.stringify(shot.referenceIds || []);
      shot.referenceIds = refs;
      if (JSON.stringify(shot.referenceIds) !== shotBefore) shotsChanged += 1;
    }
  }
}

const response = await fetch(`${base}/api/projects/${projectId}`, {
  method: 'PUT',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(project)
});
const text = await response.text();
console.log('PUT', response.status);
if (!response.ok) {
  console.error(text.slice(0, 800));
  process.exit(1);
}
console.log(JSON.stringify({
  panels: project.pages.flatMap(page => page.panels || []).length,
  panelsWithRefs,
  panelsChanged,
  shotsChanged,
  missing: [...new Set(missing)].slice(0, 20)
}, null, 2));
