/** Form images are authoritative when reopening a record; stale saved ids must not override them. */
import {isBlockingAsset} from '../../../comic/public/scene-blocking.js';
export function productionReferenceInputs(input){
 const limit=isBlockingAsset(input)?60:3;
 const ids=input.referenceIds||[],extra=input.useFormReferences?input.extraReferenceIds||[]:[];
 for(const list of [ids,extra])if(!Array.isArray(list)||list.length>limit||list.some(id=>typeof id!=='string'||!/^asset_[a-f0-9-]{36}$/i.test(id)))throw Error('参考图编号无效或数量过多');
 const references=input.useFormReferences?[input.reference,input.costumeReference]:[...(!ids.length?[input.reference]:[]),input.costumeReference];
 if(references.some(v=>v!==undefined&&v!==null&&v!==''&&(typeof v!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,[\w+/=\r\n]+$/.test(v))))throw Error('参考图格式无效');
 const uploads=references.filter(Boolean);if(input.useFormReferences&&uploads.length+extra.length>limit)throw Error(limit===3?'最多使用三张参考图，请减少补充参考':'参考图超过60张，请减少补充参考');
 return {referenceIds:input.useFormReferences?[]:[...ids],uploadReferences:uploads,extraReferenceIds:[...new Set(extra)]};
}
