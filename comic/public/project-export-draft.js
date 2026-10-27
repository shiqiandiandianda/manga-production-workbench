// Preserve the editor's unsaved project when the server export is used to
// supply immutable production sources and asset paths after a save conflict.
export function exportWithLocalDraft(serverExport, localProject, localAssets) {
  if (!serverExport?.project || serverExport.project.id !== localProject?.id) {
    throw Error('工程已切换，不能导出当前草稿');
  }
  if (localProject.productionPackage &&
      localProject.productionPackage.hash !== serverExport.project.productionPackage?.hash) {
    throw Error('制作资料已变化，不能将服务器原件冒充当前草稿的原件');
  }
  const project=structuredClone(localProject);
  for (const page of project.pages || []) for (const panel of page.panels || []) panel.generationToken=null;
  const byId=new Map((serverExport.assets || []).map(asset=>[asset.id,asset]));
  const available=new Map((localAssets || []).map(asset=>[asset.id,asset]));
  // Retain every locally registered asset actually mentioned by the draft,
  // including older references that the server's current version no longer uses.
  const visit=value=>{
    if (typeof value==='string') {
      const asset=available.get(value);
      if (/^asset_[a-f0-9-]{36}$/i.test(value) && !asset && !byId.has(value)) {
        throw Error('草稿引用的图片未登记：'+value);
      }
      if (asset && !byId.has(value)) {
        if (!asset.filePath) throw Error('草稿引用的图片缺少路径：'+(asset.name || value));
        byId.set(value,asset);
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value==='object') Object.values(value).forEach(visit);
  };
  // Old audit records can mention deleted images without the current document
  // using them. Check the live document, as project-media-files does for sync.
  for (const [key,value] of Object.entries(project)) {
    if (!['layoutHistory','layoutImports','designHistory','storyboardWorkflow','novelProductionWorkflow'].includes(key)) visit(value);
  }
  if (byId.size>1200) throw Error('草稿引用和服务器资源合计超过 1200 项，无法导出可重新导入的工程');
  return {...serverExport,project,assets:[...byId.values()]};
}
