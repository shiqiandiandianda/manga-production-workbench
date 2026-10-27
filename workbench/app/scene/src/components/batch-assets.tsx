import {Image as ImageIcon,ArrowUpRight,CheckCircle2} from 'lucide-react';
import type {Batch,Scene} from '../lib/scenes';
import type {BatchAssets} from '../lib/batch-assets';
import type {ImageStatus} from '../lib/image-status';
import {VariantStatus} from './image-status';

export function BatchAssetCard({batches,report,generating,onGenerate,onView,statusFor}:{batches:Batch[];report:BatchAssets;generating:boolean;onGenerate:()=>void;onView:(sceneId:string)=>void;statusFor:(scene:Scene,index:number)=>ImageStatus}){
  if(!report.ready)return null;
  const statuses=report.added.flatMap(scene=>[0,1].map(index=>statusFor(scene,index)));
  const available=report.added.reduce((count,scene)=>count+[0,1].filter(index=>!scene.images[index]&&!statusFor(scene,index).blocked).length,0);
  const active=statuses.filter(status=>status.kind==='running'||status.kind==='saving').length;
  const waiting=statuses.filter(status=>status.kind==='pending'||status.kind==='submitting').length;
  return <div className="batch-assets" aria-label={'第 '+(report.index+1)+' 批场景结果'}>
    <div className="batch-assets-head"><div><CheckCircle2 size={16}/><strong>第 {report.index+1} 批已就绪</strong><span>新增 {report.added.length} 个 · 复用 {report.reused.length} 个 · 待出图 {report.pendingImages} 张{active>0&&' · 生成中 '+active+' 张'}{waiting>0&&' · 排队 '+waiting+' 张'}</span></div><button className="primary" disabled={generating||!available} onClick={onGenerate}><ImageIcon size={15}/>{report.pendingImages?available?'生成本批场景图':'本批出图已排队':report.added.length?'本批图片已齐':report.reused.length?'本批全部复用':'本批无可出图场景'}</button></div>
    {!!report.added.length&&<div className="batch-asset-tags">{report.added.map(scene=><button key={scene.id} onClick={()=>onView(scene.id)}><span>{scene.name}</span><span className="batch-version-statuses">{[0,1].map(index=><VariantStatus key={index} status={statusFor(scene,index)} index={index} compact/>)}</span><ArrowUpRight size={12}/></button>)}</div>}
    {!!report.reused.length&&<details className="duplicate-report" open><summary>已过滤 {report.reused.length} 个重复场景，复用前批资产</summary>{report.reused.map(({scene,firstBatch})=><div key={scene.id}><button onClick={()=>onView(scene.id)}>{scene.name}<ArrowUpRight size={12}/></button><span>与第 {firstBatch+1} 批（{batches[firstBatch].chapters[0].title} — {batches[firstBatch].chapters.at(-1)?.title}）重复，{scene.images.some(Boolean)?'复用已有图片':'等待原场景出图'}，本批不重复生成。</span></div>)}</details>}
    {!report.scenes.length&&<p className="subtle">本批未提取到需要出图的实际场景。</p>}
  </div>;
}
