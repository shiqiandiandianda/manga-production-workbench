const text=value=>typeof value==='string'?value.trim():'';
export function characterRole(asset){
 const explicit=asset.characterRole||asset.workflow?.characterRole;
 if(explicit&&explicit!=='auto')return explicit;
 // Workflow complexity (simple/major) is not an appearance or attractiveness tier.
 if(asset.roleClass==='major'||asset.workflow?.kind==='major')return 'lead';
 if(['background','extra','walkon','crowd'].includes(asset.roleClass))return 'background';
 const name=text(asset.name);
 if(/^(?:预备)?(?:杂役|外门|内门)?弟子(?:[甲乙丙丁戊己庚辛壬癸一二三四五六七八九十A-Z0-9]+)?$/u.test(name)||/^(?:围观|路人|群众|侍卫|守卫|护卫|村民|店小二|伙计|仆役|随从|士兵|杂役)(?:弟子|角色|青年|少年|男子|女子|人)?(?:[甲乙丙丁戊己庚辛壬癸一二三四五六七八九十A-Z0-9]+)?$/u.test(name))return 'background';
 return 'auto';
}
