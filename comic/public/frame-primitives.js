/** Thirty-two editable nodes retain the existing document format. Rendering uses a true ellipse. */
export const circleFramePoints=()=>Array.from({length:32},(_,i)=>({x:.5+Math.cos(i*Math.PI/16)*.5,y:.5+Math.sin(i*Math.PI/16)*.5}));
export function isCircleFrame(points){return Array.isArray(points)&&points.length===32&&points.every((p,i)=>Math.abs(p.x-(.5+Math.cos(i*Math.PI/16)*.5))<1e-9&&Math.abs(p.y-(.5+Math.sin(i*Math.PI/16)*.5))<1e-9);}
