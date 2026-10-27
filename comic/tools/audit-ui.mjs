// Static inventory of the comic editor UI: buttons, ids, dead selectors and duplicate actions.
// Read-only. Run: node tools/audit-ui.mjs
import fs from 'node:fs';
import path from 'node:path';

const publicDir = path.resolve('public');
const htmlFiles = fs.readdirSync(publicDir).filter(name => name.endsWith('.html')).sort();
const jsFiles = fs.readdirSync(publicDir).filter(name => name.endsWith('.js')).sort();
const html = Object.fromEntries(htmlFiles.map(name => [name, fs.readFileSync(path.join(publicDir, name), 'utf8')]));
const js = Object.fromEntries(jsFiles.map(name => [name, fs.readFileSync(path.join(publicDir, name), 'utf8')]));
const allJs = Object.values(js).join('\n');

const report = { generatedAt: new Date().toISOString(), files: { html: htmlFiles, js: jsFiles.length }, duplicateIds: [], deadButtons: [], missingSelectors: [], duplicateActions: [], pageLinks: [] };
const strip = value => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

for (const [file, text] of Object.entries(html)) {
  const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicate = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicate.length) report.duplicateIds.push({ file, ids: duplicate });
}

const htmlIds = new Set();
const jsCreatedIds = new Set();
for (const text of Object.values(html)) for (const match of text.matchAll(/\bid="([^"]+)"/g)) htmlIds.add(match[1]);
for (const text of Object.values(js)) for (const match of text.matchAll(/\bid\s*=\s*['"]([A-Za-z][\w-]*)['"]/g)) jsCreatedIds.add(match[1]);
for (const match of allJs.matchAll(/(?:id\s*:\s*|\.id\s*=\s*)['"]([A-Za-z][\w-]*)['"]/g)) jsCreatedIds.add(match[1]);

const known = new Set([...htmlIds, ...jsCreatedIds]);
for (const [file, text] of Object.entries(js)) {
  for (const match of text.matchAll(/(?:\$\s*\(\s*|querySelector\s*\(\s*)['"`]#([A-Za-z][\w-]*)['"`]/g)) {
    const id = match[1];
    if (!known.has(id)) report.missingSelectors.push({ file, id });
  }
  for (const match of text.matchAll(/getElementById\s*\(\s*['"`]([A-Za-z][\w-]*)['"`]/g)) {
    const id = match[1];
    if (!known.has(id)) report.missingSelectors.push({ file, id });
  }
}
report.missingSelectors = [...new Map(report.missingSelectors.map(item => [item.file + ':' + item.id, item])).values()];

for (const [file, text] of Object.entries(html)) {
  for (const match of text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = match[1], label = strip(match[2]);
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1] || '';
    const action = /\bdata-action="([^"]+)"/.exec(attrs)?.[1] || '';
    const dataAttr = /\bdata-([a-z][\w-]*)(?:="[^"]*")?/.exec(attrs)?.[1] || '';
    const type = /\btype="([^"]+)"/.exec(attrs)?.[1] || '';
    const referenced = id && (allJs.includes("'#" + id + "'") || allJs.includes('"#' + id + '"') || allJs.includes("'" + id + "'") || allJs.includes('"' + id + '"'));
    const delegated = action && (allJs.includes("'" + action + "'") || allJs.includes('"' + action + '"'));
    const dynamic = dataAttr && (allJs.includes('data-' + dataAttr) || allJs.includes(dataAttr));
    if (!id && !action && !dataAttr && type !== 'submit' && !/\bform=/.test(attrs)) report.deadButtons.push({ file, label, reason: 'no id / data-action / submit / form' });
    else if (id && !referenced && !delegated && !dynamic) report.deadButtons.push({ file, label, id, reason: 'id not referenced by JS' });
  }
}

const actionCount = new Map();
for (const [file, text] of Object.entries(html)) for (const match of text.matchAll(/\bdata-action="([^"]+)"/g)) {
  const key = match[1];
  actionCount.set(key, [...(actionCount.get(key) || []), file]);
}
for (const [action, files] of actionCount) if (files.length > 1) report.duplicateActions.push({ action, files });

for (const [file, text] of Object.entries(html)) for (const match of text.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
  const href = match[1];
  if (href.startsWith('/') && href.endsWith('.html') && !htmlFiles.includes(href.slice(1))) report.pageLinks.push({ file, href, exists: false });
}

console.log(JSON.stringify(report, null, 2));
