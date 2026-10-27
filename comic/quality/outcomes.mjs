// One failing, skipped, timed-out, cancelled or empty test file prevents a green gate.
export function classifyOutcome({raw='',code=0,timed=false,interrupted=false,isPython=false}){
  const count=key=>Number(raw.match(new RegExp('(?:ℹ |# )'+key+' (\\d+)'))?.[1]||0);
  const fail=isPython?Number(raw.match(/failures=(\d+)/)?.[1]||0)+Number(raw.match(/errors=(\d+)/)?.[1]||0):count('fail');
  const skip=isPython?Number(raw.match(/skipped=(\d+)/)?.[1]||0):count('skipped')+count('todo');
  const cancelled=isPython?0:count('cancelled');
  const pass=isPython?Math.max(0,Number(raw.match(/Ran (\d+) tests?/i)?.[1]||0)-fail-skip):count('pass');
  const status=interrupted?'cancelled':timed?'timeout':raw.includes('QUALITY_GUARD:')?'blocked':code!==0||fail||cancelled?'failed':skip?'skipped':pass===0?'failed':raw.includes('QUALITY_BROWSER_RETRY:')?'flaky':'passed';
  const kind=status==='passed'?'none':status==='blocked'?'safety_boundary':status==='flaky'?'flaky_browser_start':status==='skipped'?'skipped':/QUALITY_MOKU_TEST_SOURCE_REQUIRED/.test(raw)?'missing_moku_source':pass===0&&code===0&&!fail&&!cancelled?'no_assertions':/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ModuleNotFoundError/.test(raw)?'missing_module_or_dependency':/ENOENT/.test(raw)?'missing_file_or_environment':status;
  return {status,kind,pass,fail,skip,cancelled};
}
