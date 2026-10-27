// Keep OCR drafts independent from the two generated image results.
const fitFields=['x','y','fontSize','textBoxWidth','textBoxHeight'];
const fitInputs=[...fitFields,'text','fontFamily','fontWeight','bold','italic','textDirection','textAlign','textWrap','textMode','lineHeight','letterSpacing','paragraphSpacing','scale','scaleX','scaleY','angle','skewX'];
function draftBaseline(settings){return Object.fromEntries(fitInputs.filter(key=>settings[key]!==undefined).map(key=>[key,structuredClone(settings[key]) ]));}
function fitValue(settings,key,offsetY=0){if(key==='bold'||key==='italic')return settings[key]===true;if(key==='y')return settings.y+offsetY;return settings[key];}
export function canReceiveEarlyText(task,note=task){
  if(task?.workflowVersion>=2||task?.textReview?.schemaVersion===2||task?.earlyText?.schemaVersion===2)return false;
  const early=task?.earlyText;
  return !!early&&typeof early.version==='string'&&Array.isArray(early.layers)&&(early.layers.length>0||early.received&&Array.isArray(early.ids)&&early.ids.length>0)
    &&early.attemptId===task.automation?.attemptId
    &&!['discarded','archived'].includes(note?.decision)
    &&task.automation?.status!=='cancelled'&&!note?.earlyTextReceived;
}

export function addEarlyTextLayers(layers,task,note=task,{offsetY=0}={}){
  if(!canReceiveEarlyText(task,note))return {added:[],received:false};
  const ids=[...new Set((task.earlyText.ids||[]).filter(id=>typeof id==='string'&&id.startsWith(`text-${task.id}-`)))],added=[];
  for(const settings of task.earlyText.layers){
    if(settings.type!=='text'||settings.originJobId!==task.id||settings.originRegionId!==task.regionId)continue;
    if(!ids.includes(settings.id))ids.push(settings.id);
    if(layers.some(layer=>layer.id===settings.id))continue;
    const layer={...structuredClone(settings),y:settings.y+offsetY,visible:settings.visible??false,autoTextPending:settings.autoTextPending??true,pendingAutoShow:settings.pendingAutoShow??true,locked:settings.locked??false,layoutVersion:2};
    if(!layer.autoTextBaseline&&!task.earlyText.received)layer.autoTextBaseline=draftBaseline(settings);
    layers.push(layer);added.push(layer);
  }
  if(!ids.length)return {added:[],received:false};
  return {added,received:true,note:{earlyTextReceived:true,earlyTextIds:ids,earlyTextVersion:task.earlyText.version,earlyTextAttemptId:task.earlyText.attemptId}};
}

export function companionAction(existing,settings,note={}){
  if(existing)return existing.type==='text'&&existing.autoTextPending?'finish-early':'keep';
  if(note.autoTextReceived)return 'skip-deleted';
  if(settings.type==='text'&&note.earlyTextReceived&&(note.earlyTextIds||[]).includes(settings.id))return 'skip-deleted';
  return 'add';
}

export function finishPendingText(layer,settings,{offsetY=settings.autoTextLayoutOffset||0}={}){
  if(layer.type!=='text'||!layer.autoTextPending)return false;
  // Adopt the final bubble fit only while the OCR layout remains untouched.
  // Page-section extensions shift the draft and its region together; they are not manual edits.
  const baseline=layer.autoTextBaseline;
  if(baseline&&fitInputs.every(key=>JSON.stringify(fitValue(layer,key))===JSON.stringify(fitValue(baseline,key,offsetY)))){
    for(const key of fitFields)if(settings[key]!==undefined)layer[key]=settings[key]+(key==='y'&&settings.autoTextPending!==false?offsetY:0);
  }
  // Content, explicit formatting, position and visibility choices belong to the user.
  if(layer.pendingAutoShow)layer.visible=true;
  if(!layer.linkGroupId&&!layer.pendingLinkCancelled){
    const group=layer.pendingLinkGroupId||settings.linkGroupId;
    if(group)layer.linkGroupId=group;
  }
  layer.autoTextPending=false;layer.pendingAutoShow=false;
  layer.autoTextLayoutOffset=offsetY;
  delete layer.autoTextBaseline;
  delete layer.pendingLinkGroupId;
  return true;
}

export function normalizeCompanionStack(layers,settings,anchor){
  const textSettings=settings.filter(layer=>layer.type==='text'),texts=textSettings.map(item=>layers.find(layer=>layer.id===item.id)).filter(Boolean);
  if(anchor&&texts.length){
    const first=Math.min(...texts.map(layer=>layers.indexOf(layer))),at=layers.indexOf(anchor);
    if(at>first){layers.splice(at,1);layers.splice(first,0,anchor);}
  }
  for(const bubbleSettings of settings.filter(layer=>layer.type==='image')){
    const textSetting=textSettings.find(item=>item.linkGroupId&&item.linkGroupId===bubbleSettings.linkGroupId),text=textSetting&&layers.find(layer=>layer.id===textSetting.id),bubble=layers.find(layer=>layer.id===bubbleSettings.id);
    if(bubble&&bubble.linkGroupId===bubbleSettings.linkGroupId&&(!text||text.linkGroupId!==bubble.linkGroupId))delete bubble.linkGroupId;
    if(!text||!bubble)continue;
    const at=layers.indexOf(bubble),before=layers.indexOf(text);
    if(at>before){layers.splice(at,1);layers.splice(layers.indexOf(text),0,bubble);}
  }
}

export function completeCompanions(layers,prepared,note={},anchor=null,{offsetY=0,fromBackup=false}={}){
  const added=[],finished=[];
  for(const {settings,bitmap} of [...prepared].reverse()){
    const existing=layers.find(layer=>layer.id===settings.id),action=companionAction(existing,settings,note);
    if(action==='finish-early'){finishPendingText(existing,settings,{offsetY:fromBackup?0:offsetY});finished.push(existing);}
    else if(action==='add'){
      const {image,imageFile,...properties}=settings;
      const companion={...properties,y:settings.y+(fromBackup?0:offsetY),layoutVersion:2,...(bitmap?{canvas:bitmap}:{})};
      const index=anchor?layers.indexOf(anchor):-1;
      layers.splice(index>=0?index+1:layers.length,0,companion);added.push(companion);
    }
  }
  if(added.length||finished.length)normalizeCompanionStack(layers,prepared.map(item=>item.settings),anchor);
  return {added,finished};
}
