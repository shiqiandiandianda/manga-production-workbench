// Offer real bundled faces; retain an unsupported saved value without rewriting it.
const weights={'source-han-sans':[300,400,500,700,900],'source-han-serif':[300,400,500,600,700,900]};
const labels={100:'极细',200:'特细',300:'细体',400:'常规',500:'中等',600:'半粗',700:'加粗',800:'特粗',900:'重体'};
export function fontWeightOptions(family,current){
 const available=weights[family]||[400,700],values=[...available];
 if(Number.isInteger(Number(current))&&!values.includes(Number(current)))values.push(Number(current));
 return values.sort((a,b)=>a-b).map(n=>[n,(labels[n]||n)+' '+n+(available.includes(n)?'':'（旧值）')]);
}
