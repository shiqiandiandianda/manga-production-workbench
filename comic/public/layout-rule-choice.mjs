/** One frozen rule per episode, shared by planning, reflow and the selector. */
export function episodeRuleRequest(binding, selectedId){
 const contract=binding?.contract;
 if(contract){
  if(selectedId!==contract.id)throw Object.assign(Error('本话已绑定“'+contract.name+'” '+contract.version+'，不能混用另一套规则。请回到接回前的原工程另做新规划。'),{status:409});
  return {contract};
 }
 if(!selectedId)throw Object.assign(Error('请先选择本作品的排版规则'),{status:400});
 return {ruleId:selectedId};
}

export function chooseEpisodeRule(plan,title,previousId,sameContext){
 if(plan.binding?.contract)return plan.binding.contract.id;
 const rules=plan.rules||plan.learningProjects||[];
 if(sameContext&&rules.some(rule=>rule.id===previousId))return previousId;
 const matches=rules.filter(rule=>!rule.builtin&&[rule.name,...(rule.aliases||[])].some(name=>name&&title.includes(name)));
 return matches.length===1?matches[0].id:'';
}
