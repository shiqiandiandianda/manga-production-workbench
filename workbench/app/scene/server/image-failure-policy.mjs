export function imageFailurePolicy(error){
  const code=error.info?.code||error.code||'pipeline_image_failed',status=error.info?.status||error.status;
  if(code==='codex_usage_limit'||/billing|insufficient_quota|credit_balance|spend_limit|organization_usage_limit/.test(code))return {code,pauseReason:'quota'};
  if(['codex_login_required','invalid_api_key','authentication_error'].includes(code)||status===401)return {code,pauseReason:'authentication'};
  if(['codex_unavailable','model_not_found','invalid_reference'].includes(code)||status===403)return {code,pauseReason:'configuration'};
  if(['ENOSPC','EACCES','EPERM','EROFS','project_conflict'].includes(code)||/项目已切换/.test(error.message||''))return {code,pauseReason:'storage'};
  return {code,pauseReason:''};
}
