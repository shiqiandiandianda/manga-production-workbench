import {isTextReviewTask} from './text-review.mjs';
export function belongsToEditor(task, editorKey, sourceId) {
  return task.editorKey ? task.editorKey === editorKey : !!sourceId && task.sourceId === sourceId;
}
export function hasReviewableAttempt(task) {
  return !!task && !['accepted','discarded','archived'].includes(task.decision)
    && task.automation?.status === 'failed' && task.automation.phase === 'visual_review_rejected'
    && task.automation.publishable === true;
}
export function reviewAttemptNotice(task) {
  if (!hasReviewableAttempt(task)) return '';
  const review=task.automation.visualValidation,issues=[];
  if(review?.backgroundHasBubble)issues.push('背景可能残留气泡');
  if(review?.bubbleHasText)issues.push('气泡中可能残留文字');
  if(review?.bubbleShapeComplete===false)issues.push(review.uncertain?'复核未能确认气泡轮廓、尖刺或尾巴是否完整':'气泡轮廓、尖刺或尾巴可能有变化');
  if(!issues.length)issues.push(review?.uncertain?'复核仍有不确定之处':'复核提示需要检查生成效果');
  return `图片已生成，等待人工确认。${issues.join('；')}。请查看背景和透明气泡，确认后可点“仍然采用这次结果”，无需重新生图。`;
}
export function taskStatus(task) {
  if (task.decision === 'discarded') return 'discarded';
  if (task.decision === 'archived') return 'archived';
  if (task.decision === 'accepted') return 'accepted';
  if (task.receiveError && task.automation?.status === 'completed') return 'receive_failed';
  if (isTextReviewTask(task)) return task.automation.status;
  if (hasReviewableAttempt(task)) return 'awaiting_result_review';
  if (task.layerId) return 'review';
  if (task.receiving) return 'receiving';
  if (task.starting) return 'queued';
  return task.automation?.status || (task.result ? 'ready' : 'waiting');
}
export function canReceive(task) {
  return !['discarded','archived'].includes(task.decision) && !task.receiving && !!task.result
    && (!task.automation || task.automation.status === 'completed')
    && task.result.version !== task.resultVersion;
}
export function mergeTask(tasks, request, notes = {}) {
  const current = tasks.get(request.id) || {};
  // Backend metadata cannot overwrite local alignment, layer identity or review choices.
  const task = Object.assign(current, request, notes[request.id]);
  task.automatic = !!task.automation || task.mode === 'auto';
  tasks.set(task.id, task);
  return task;
}

const runningStatuses=new Set(['queued','running']);
const finishedStatuses=new Set(['completed','failed','cancelled']);
const seconds=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
function timestamp(value){
  if(typeof value==='number'&&Number.isFinite(value)&&value>0)return value<1e12?value*1000:value;
  if(typeof value==='string'&&value.trim()){const parsed=Date.parse(value);if(Number.isFinite(parsed))return parsed;}
  return null;
}
export function formatGenerationTime(value){
  const total=Math.floor(Math.max(0,value)),hours=Math.floor(total/3600),minutes=Math.floor(total/60)%60,rest=total%60;
  const pair=part=>String(part).padStart(2,'0');
  return hours?`${pair(hours)}:${pair(minutes)}:${pair(rest)}`:`${pair(minutes)}:${pair(rest)}`;
}
export function generationTimer(task,now=Date.now()){
  const state=task?.automation,status=state?.status;
  if(!runningStatuses.has(status)&&!finishedStatuses.has(status))return null;
  const history=Array.isArray(state.phaseHistory)?state.phaseHistory:[];
  const started=timestamp(state.startedAt)??timestamp(history[0]?.startedAt)??timestamp(task.createdAt);
  const running=runningStatuses.has(status);
  let elapsed=seconds(state.elapsedSeconds);
  if(running){
    if(started!==null)elapsed=Math.max(0,(now-started)/1000);
    else if(elapsed!==null){const updated=timestamp(state.updatedAt);if(updated!==null)elapsed+=Math.max(0,(now-updated)/1000);}
  }else if(elapsed===null&&started!==null){
    // Project attachment or a later human acceptance must not extend generation time.
    const terminal=history.find(entry=>finishedStatuses.has(entry.phase));
    const ended=timestamp(terminal?.startedAt)??timestamp(state.finishedAt)??timestamp(state.updatedAt);
    if(ended!==null)elapsed=Math.max(0,(ended-started)/1000);
  }
  if(elapsed===null||!Number.isFinite(elapsed))return null;
  const duration=Math.floor(elapsed),prefix=status==='queued'?'排队中':running?'生成中':'耗时';
  return {seconds:duration,running,label:`${prefix} ${formatGenerationTime(duration)}`};
}
