import fs from 'node:fs';
import path from 'node:path';

/**
 * Older prompt-driven packages were imported before the table layout regions were
 * kept. The final storyboard JSON still carries 生成单元[].屏段布局.格子[].rect,
 * so backfill those normalized rects once. They are editable initial slots, never
 * confirmed crop regions (segment.regions stays untouched).
 */
export function hydrateProductionTableRegions(project, dataDir) {
  const pkg = project?.productionPackage;
  if (!pkg || pkg.sourceFormat !== 'prompt-driven-production-1.0' || !pkg.hash) return false;
  const root = path.resolve(dataDir, 'production-sources', String(pkg.hash));
  let changed = false;
  for (const episode of pkg.episodes || []) {
    if (!episode?.sourceFinal) continue;
    const file = path.resolve(root, episode.sourceFinal);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) continue;
    let source;
    try { source = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const units = source?.['生成单元'];
    if (!Array.isArray(units)) continue;
    for (const [index, unit] of units.entries()) {
      const segment = (episode.segments || [])[index];
      const cells = unit?.['屏段布局']?.['格子'];
      if (!segment || !Array.isArray(cells) || !cells.length) continue;
      const regions = { ...(segment.tableRegions || {}) };
      for (const cell of cells) {
        const number = Number(cell?.['格号']);
        const rect = cell?.['rect'];
        if (!Number.isInteger(number) || !rect || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(Number(rect[key])))) continue;
        const record = (episode.panelRecords || []).find(row => row.segmentId === segment.id && Number(row.number) === number);
        if (!record) continue;
        regions[record.id] = { x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h) };
      }
      if (Object.keys(regions).length && JSON.stringify(regions) !== JSON.stringify(segment.tableRegions || {})) {
        segment.tableRegions = regions;
        changed = true;
      }
    }
  }
  return changed;
}
