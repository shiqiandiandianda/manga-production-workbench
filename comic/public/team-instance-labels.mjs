// Labels use exact registered member IDs. Names and installed versions are untouched.
export function labelLocalInstances(members, identity={}) {
 return members.map((member,index)=>{
  const role=member.id===identity.currentMemberId?'current':member.id===identity.legacyMemberId?'legacy':'';
  return {...member,localInstanceRole:role,localInstanceLabel:role==='current'?'10.24接入版 · 当前工作台':role==='legacy'?'10.23原版 · 保留运行':'',originalIndex:index};
 }).sort((a,b)=>({current:0,legacy:1}[a.localInstanceRole]??2)-({current:0,legacy:1}[b.localInstanceRole]??2)||a.originalIndex-b.originalIndex);
}
