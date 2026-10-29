import {auditPanelReferences} from './panel-reference-audit.js';
import {resolvedTextAsset} from './asset-text-references.js';
export function panelTextAssets(project,panel,assets=[]){
 return auditPanelReferences(project,panel,assets).needs.filter(resolvedTextAsset).map(n=>({needId:n.id,role:n.role,name:n.name,state:n.state||'',description:n.description}));
}
