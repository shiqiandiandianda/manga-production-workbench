// Replace only this function with the other image tool's own generation call.
export async function generate({task,references,directory,signal,onProgress}){
 throw new Error('尚未连接真实生图工具。请使用 task.brief.prompt、task.brief.spec 和 references，生成后返回 {filePath:绝对图片路径}。');
}
