// Recognition drafts stay separate from artwork and editable text layers until confirmed.
export const textReviewStatuses = ['recognition_queued','recognizing_text','awaiting_text_review','refining_text'];
export function isTextReviewTask(task) {
  return textReviewStatuses.includes(task?.automation?.status);
}
export function taskHasPendingWork(task) {
  return !!task?.starting || !!task?.receiving || ['queued','running',...textReviewStatuses].includes(task?.automation?.status);
}
export function canOpenTextReview(task) {
  return !['discarded','archived'].includes(task?.decision) &&
    (['awaiting_text_review','refining_text'].includes(task?.automation?.status) || task?.textReview?.status === 'draft');
}
export function copyTextReviewDraft(draft) {
  if (draft?.schemaVersion !== 2 || !Array.isArray(draft.bubbles)) throw new Error('识字草稿格式不兼容，请重新识字。');
  const copy=structuredClone(draft);for(const bubble of copy.bubbles)if(bubble.direction==='vertical')bubble.direction='vertical-rl';return copy;
}
export function validateTextReviewBubbles(bubbles) {
  if (!Array.isArray(bubbles) || !bubbles.length) return '没有保留的气泡，请先添加或恢复一个气泡。';
  const ids = new Set();
  for (const [index,bubble] of bubbles.entries()) {
    const number = index + 1;
    if (!bubble?.id || ids.has(bubble.id)) return `气泡 ${number} 的编号重复或缺失。`;
    ids.add(bubble.id);
    if (!String(bubble.text ?? '').trim()) return `气泡 ${number} 的原文为空。假识别请删除，不要以空原文生成。`;
    for (const field of ['box','bubbleBox']) {
      const box = bubble[field];
      if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box[0] < 0 || box[1] < 0 || box[2] <= 0 || box[3] <= 0 || box[0]+box[2] > 1000 || box[1]+box[3] > 1000) return `气泡 ${number} 的${field === 'box' ? '文字框' : '气泡框'}需在 0–1000 范围内，宽高大于 0。`;
    }
    const [x,y,w,h] = bubble.box, [bx,by,bw,bh] = bubble.bubbleBox;
    if (x < bx || y < by || x+w > bx+bw || y+h > by+bh) return `气泡 ${number} 的文字框需要完整位于气泡框内。`;
    if (!['horizontal','vertical-rl','vertical-lr'].includes(bubble.direction)) return `气泡 ${number} 的文字方向无效。`;
    if (!['left','center','right'].includes(bubble.align)) return `气泡 ${number} 的对齐方式无效。`;
    if (!Number.isFinite(bubble.fontSize) || bubble.fontSize < 6 || bubble.fontSize > 512) return `气泡 ${number} 的字号需要在 6–512 px 范围内。`;
  }
  return '';
}
function unionBoxes(boxes) {
  const left=Math.min(...boxes.map(box=>box[0])),top=Math.min(...boxes.map(box=>box[1]));
  return [left,top,Math.max(...boxes.map(box=>box[0]+box[2]))-left,Math.max(...boxes.map(box=>box[1]+box[3]))-top];
}
export function mergeTextReviewBubbles(bubbles, selectedIds) {
  const selected = new Set(selectedIds), rows=bubbles.filter(bubble=>selected.has(bubble.id));
  if (rows.length < 2) throw new Error('请先选择至少两个属于同一气泡的文字段落。');
  const merged={...structuredClone(rows[0]),text:rows.map(row=>String(row.text??'')).filter(Boolean).join('\n'),box:unionBoxes(rows.map(row=>row.box)),bubbleBox:unionBoxes(rows.map(row=>row.bubbleBox)),uncertain:rows.flatMap(row=>structuredClone(row.uncertain||[]))};
  return bubbles.flatMap(bubble=>bubble.id===merged.id?[merged]:selected.has(bubble.id)?[]:[structuredClone(bubble)]);
}
export function localTextReviewDraft(local, remote) {
  if (local?.draft?.jobId !== remote.jobId || local.draft.sourceCropSha256 !== remote.sourceCropSha256 || local.draft.frameHash !== remote.frameHash || remote.status !== 'draft') return null;
  return {draft:copyTextReviewDraft(local.draft),sameRevision:local.baseRevision===remote.revision};
}
