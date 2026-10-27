/** Render-only deduplication. Saved layers/visibility remain available in the editor and exports. */
import {normalizeArtDirection} from './comic-art-direction.js';
import {normalizeSfxWord} from './comic-styles.js';
import {segmentEffectWord} from './sfx-placement.js';
const sourceWord=layer=>{
 const name=/^(.+?)\s*·\s*字效\s*$/u.exec(String(layer.name||''));
 return normalizeSfxWord(layer.sfxSourceWord||name?.[1]||'');
};
function renderedImageRoute(panel){
 if(panel?.breakoutForeground||panel?.sfxImage)return null;
 const snapshot=panel?.imageEffects;if(!panel?.imageAssetId||!snapshot||snapshot.imageAssetId!==panel.imageAssetId)return null;
 let direction;try{direction=normalizeArtDirection(snapshot.artDirection);}catch{return null;}
 if(direction.effectsMode==='external')return null;
 const approved=new Map(direction.effectsWords.map(raw=>{const word=normalizeSfxWord(raw);return [word,{word,parts:segmentEffectWord(word)}];}).filter(([word])=>word));
 return {mode:direction.effectsMode,approved};
}
/** An effect snapshot describes the image actually attached, never a future generation setting. */
export function createComicEffectRouting(panels=[]){
 const routes=new Map();for(const panel of panels){const route=renderedImageRoute(panel);if(route)routes.set(panel.id,route);}
 const suppression=layer=>{
  if(!layer?.sfxAuto||!layer.parentPanelId)return null;
  // Speech/thought/caption stay editable and visible, even if malformed legacy metadata carries sfxAuto.
  if(layer.type!=='sfx'&&!(layer.type===undefined&&layer.sfxImage===true))return null;
  const route=routes.get(layer.parentPanelId);if(!route)return null;
  const text=normalizeSfxWord(layer.text);
  // Editing an auto PNG's recorded text makes it a new text intent, not an old duplicate.
  if(layer.visualWord!==undefined&&normalizeSfxWord(layer.visualWord)!==text)return null;
  if(layer.sfxAuto==='atmosphere')return text?null:{reason:'image-atmosphere',panelId:layer.parentPanelId};
  if(route.mode!=='integrated'||!text)return null;
  const original=sourceWord(layer);
  if(original){
   const approved=route.approved.get(original);if(!approved)return null;
   // Old projects can retain split text layers after the original effect
   // library is unavailable. Recognize an exact repeated unit without
   // swallowing unrelated hand-edited words or substring matches.
   const repeatedUnit=text&&original.length>text.length&&original.split(text).join('')==='';
   if(text!==original&&!approved.parts?.includes(text)&&!repeatedUnit)return null;
   return {reason:'image-word',panelId:layer.parentPanelId,word:original};
  }
  return route.approved.has(text)?{reason:'image-word',panelId:layer.parentPanelId,word:text}:null;
 };
 return {suppression,shouldRender:layer=>!suppression(layer)};
}
