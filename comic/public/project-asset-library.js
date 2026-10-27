// The file registry is shared for rendering; import lists belong to one project.
export function projectReferenceAssetIds(project){
 const ids=new Set();
 const add=value=>{if(typeof value==='string'&&value)ids.add(value);};
 for(const ref of project?.references||[])add(ref.assetId);
 for(const binding of Object.values(project?.assetBindings||{}))add(binding.assetId);
 for(const shot of project?.shots||[])for(const id of shot.referenceIds||[])add(id);
 for(const page of project?.pages||[])for(const panel of page.panels||[]){
  for(const b of Object.values(panel.referenceTextBindings||{}))for(const id of b.imageIds||[])add(id);
  for(const id of panel.referenceIds||[])add(id);
  for(const ref of panel.generation?.referenceRoles||[])add(ref.assetId);
 }
 for(const asset of project?.productionAssets||[])for(const id of asset.workflow?.extraReferenceIds||[])add(id);
 return [...ids];
}
export function projectLibraryAssetIds(project){
 if(!project)return [];
 return [...new Set([...(project.assetLibrary?.assetIds||[]),...projectReferenceAssetIds(project)])];
}
export function projectLibraryAssets(project,assets){
 const ids=new Set(projectLibraryAssetIds(project));return assets.filter(asset=>ids.has(asset.id));
}
export function projectLibraryDirectories(project,assets=[]){
 if(project?.assetLibrary)return [...(project.assetLibrary.directories||[])];
 return [...new Set(projectLibraryAssets(project,assets).map(asset=>asset.directoryRoot).filter(Boolean))];
}
export function removeProjectAssetReferences(project,removedIds){
 const removed=new Set(removedIds),keep=id=>!removed.has(id),keepRef=ref=>keep(ref.assetId);
 project.references=(project.references||[]).filter(keepRef);
 for(const [key,binding] of Object.entries(project.assetBindings||{}))if(!keep(binding.assetId))delete project.assetBindings[key];
 for(const shot of project.shots||[])shot.referenceIds=(shot.referenceIds||[]).filter(keep);
 for(const page of project.pages||[])for(const panel of page.panels||[]){
  if(panel.referenceIds)panel.referenceIds=panel.referenceIds.filter(keep);
  if(panel.generation?.referenceRoles)panel.generation.referenceRoles=panel.generation.referenceRoles.filter(keepRef);
  if(panel.assetReferenceBinding){panel.assetReferenceBinding.managedIds=(panel.assetReferenceBinding.managedIds||[]).filter(keep);}
 }
 for(const asset of project.productionAssets||[])if(asset.workflow?.extraReferenceIds)asset.workflow.extraReferenceIds=asset.workflow.extraReferenceIds.filter(keep);
 // Canvas images, candidates, approved production results and source snapshots stay intact.
 return project;
}
