import {auditPanelReferences} from './panel-reference-audit.js';
export function panelTextAssets(project,panel,assets=[]){
 return auditPanelReferences(project,panel,assets).needs.filter(n=>n.status==='text').map(n=>({needId:n.id,role:n.role,name:n.name,state:n.state||'',description:n.description}));
}
