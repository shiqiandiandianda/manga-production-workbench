// A source merge conflict blocks a new release, not service of the last signed
// release. Keep team presence and asset locks online while the sources are merged.
export async function publishAtStartup(publisher,{report=console.error}={}){
 try{return await publisher.publish({force:true});}
 catch(error){
  if(error.status!==409||!publisher.latest?.manifest?.contentId||!String(error.message).startsWith('主版本本机修改与同事已发布代码冲突'))throw error;
  report('新代码发布待合并；团队服务继续使用已发布版本：'+error.message);
  return publisher.latest;
 }
}
