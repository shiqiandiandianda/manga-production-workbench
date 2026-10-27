import {SIMPLE_FRAME_TEMPLATES,applyFrameTemplate,simpleFrameShapeMarkup} from './simple-frame-shapes.js';
import {createCustomFrameShapeLibrary,applyFrameShape} from './custom-frame-shapes.js';
import {clone} from './model.js';
export function initFrameShapeUI({escape,edit,getPage,selectionChanged,shapeLibrary=createCustomFrameShapeLibrary()}){
 return {shapeLibrary,shapeOptions:frame=>'<label>画格形状</label>'+simpleFrameShapeMarkup(frame,shapeLibrary,escape),setShape(value,frame){if(!value||!frame||frame.locked)return;const next=clone(frame),basic=SIMPLE_FRAME_TEMPLATES.some(template=>template.id===value);if(basic)applyFrameTemplate(next,value,{pageWidth:getPage()?.width||1280});else applyFrameShape(next,value,shapeLibrary);edit(()=>{frame.points=clone(next.points);if(basic){for(const key of ['x','y','w','h'])frame[key]=next[key];if(next.imageTransform)frame.imageTransform=clone(next.imageTransform);}});selectionChanged();}};
}
