const clean=value=>String(value||'').replace(/\0/g,'').replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
export function isLocalMemoryFailure(value){
 return /bad allocation|bad_alloc|out of memory|not enough memory|failed to allocate|failed to reserve|MemoryError|E_OUTOFMEMORY|0x8007000e|内存不足/i.test(clean(value));
}
export function localImageMessage(value){
 const message=clean(value);
 if(isLocalMemoryFailure(message))return '本机内存或显存不足，高清处理未完成。原图已保留；请释放内存后重试。';
 if(/Traceback \(most recent call last\)|ONNXRuntimeError/.test(message))return '本地模型处理失败，原图已保留。详细原因已记录在任务日志中。';
 return message;
}
