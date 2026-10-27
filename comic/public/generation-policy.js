import {generationPromptSelection} from './prompt-source.js';

export const GENERATION_RANGES = Object.freeze({
  codex: Object.freeze({label:'Codex', min:3, max:8, default:6}),
  jimeng: Object.freeze({label:'即梦', min:10, max:20, default:10})
});

export function validateGenerationConcurrency(provider, value) {
  const range=GENERATION_RANGES[provider], count=Number(value);
  if(!range)throw Object.assign(new Error('请选择 Codex 或即梦'),{status:400});
  if(!Number.isInteger(count)||count<range.min||count>range.max)throw Object.assign(new Error(`${range.label} 并发数量须为 ${range.min}–${range.max} 张`),{status:400});
  return count;
}

export function panelGenerationAvailability(panel, jobs=[], submitting=new Set()) {
  const pending=jobs.find(job=>job.panelId===panel?.id&&['queued','running','awaiting_confirmation','recoverable'].includes(job.status));
  const reason=!panel?'请先选中一个画格':panel.cutoutLayer?'抠图层保留原图，请在原画格生成':panel.coordinateSource?.generation==='不生成'?'该格标记为不生成，仅显示边框与文字':panel.sfxImage||panel.breakoutForeground?'请在对应的特效或破窗工具中生成':!panel.visible?'画格已隐藏':panel.locked?'请先解锁画格':submitting.has(panel.id)?'正在提交…':pending?({queued:'镜头已排队',running:'镜头正在处理…',awaiting_confirmation:'等待费用确认',recoverable:'原任务待恢复'}[pending.status]):!generationPromptSelection(panel).text.trim()?'请先填写本格提示词':'';
  return {disabled:!!reason,reason,pending:submitting.has(panel?.id)||!!pending};
}

export function pageGenerationPanelIds(page, jobs=[], submitting=new Set()) {
  const active=new Set(jobs.filter(job=>['queued','running','awaiting_confirmation','recoverable'].includes(job.status)).map(job=>job.panelId));
  return (page?.panels||[]).filter(panel=>panel.visible&&!panel.productionBackground&&!panel.locked&&panel.coordinateSource?.generation!=='不生成'&&!panel.sfxImage&&!panel.breakoutForeground&&!panel.cutoutLayer&&!panel.imageAssetId&&!active.has(panel.id)&&!submitting.has(panel.id)&&generationPromptSelection(panel).text.trim()).map(panel=>panel.id);
}

export function episodeGenerationPanelIds(project, currentPage, jobs=[], submitting=new Set()) {
  return episodePages(project,currentPage).flatMap(page=>pageGenerationPanelIds(page,jobs,submitting));
}
import {episodePages} from './episode-workspace.js';

