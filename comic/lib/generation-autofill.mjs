import fs from 'node:fs';
import {createHash} from 'node:crypto';
// Moving a whole generated screen does not change its image composition. Editing
// a screen still needs absolute coordinates because its mask/base page uses them.
export function generationTargetStamp(panel,action,assetPath){
 const {x,y,w,h,points,kind,imageAssetId,imageTransform,nativeSizing,mask,feather,border,imageEffects}=panel;
 let imageHash=null;if(imageAssetId){try{imageHash=createHash('sha256').update(fs.readFileSync(assetPath(imageAssetId))).digest('hex');}catch{imageHash='unreadable';}}
 return JSON.stringify({...(action==='edit'?{x,y}:{}),w,h,points,kind,imageAssetId,imageHash,imageTransform,nativeSizing,mask,feather,border,imageEffects});
}
export function autoApplyBlocks({target,page,job,contentUnchanged,referencesUnchanged,bindingUnchanged,geometryUnchanged,alignmentError}){
 return [job.resultPlacement==='candidate'&&'按请求仅保留候选，未接回画布',!target&&'画格已删除',job.status==='cancelled'&&'任务已取消',target&&target.generationToken!==job.id&&'已采用其他图片或发起新任务',(target?.locked||page?.locked)&&'画格或画板已锁定',!contentUnchanged&&'提示词或分镜内容已改变',!referencesUnchanged&&'参考图片内容已改变',!bindingUnchanged&&'参考绑定或项目标准已改变',!geometryUnchanged&&'画格尺寸、轮廓或原图取景已改变',alignmentError].filter(Boolean);
}
