export class EditHistory {
  constructor(limit=5){this.limit=limit;this.past=[];this.future=[];}
  clear(){this.past=[];this.future=[];}
  commit(snapshot,label){this.past.push({snapshot,label});if(this.past.length>this.limit)this.past.shift();this.future=[];}
  undo(current){const step=this.past.pop();if(!step)return null;this.future.push({snapshot:current,label:step.label});return step;}
  redo(current){const step=this.future.pop();if(!step)return null;this.past.push({snapshot:current,label:step.label});if(this.past.length>this.limit)this.past.shift();return step;}
}
