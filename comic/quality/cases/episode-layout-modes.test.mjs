import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticFiles} from '../../tests/fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../../lib/production-package.mjs';
import {productionProject} from '../../lib/production-package-document.mjs';
import {prepareProductionPanel,findProductionPanel} from '../../public/production-panel-generation.js';
import {layoutProductionEpisode,layoutAssistantEpisode,productionSegmentUnit,switchProductionSegmentUnit,switchProductionEpisodeUnit} from '../../public/production-episode-layout.js';
import {layoutLongStrip} from '../../public/model.js';

async function fixture() {
  const project=productionProject(await inspectProductionPackage(syntheticFiles()));
  const episode=project.productionPackage.episodes[0];
  episode.layoutDesign={data:{format:'comic-layout-design',version:1,status:'ready',episode:11,work:'合成制作资料',layoutVersion:'mixed-modes',source:{storyboardPath:'分镜JSON/第011话_分镜.json',storyboardSha256:'a'.repeat(64)},styleProfile:{allPanelsPortrait:true,minimumAspectHOverW:1.05},finalLayout:{unit:'px',coordinateSpace:'episode-document',canvas:{width:1280,height:4000},panels:[{panelId:'E011-001',readingOrder:1,role:'main',layerOrder:2,rect:{x:32,y:0,w:1000,h:1500}},{panelId:'E011-002',readingOrder:2,role:'support',layerOrder:1,rect:{x:468,y:1900,w:780,h:1170}}]},generationSegments:episode.segments.map(s=>({segmentId:s.id,localId:s.localId,unit:'normalized',coordinateSpace:'planned-image',imagePlan:{width:1080,height:3240,background:'white',overlap:false},panels:[{panelId:s.panelIds[0],rect:{x:.1,y:.02,w:.6,h:.3}}]}))}};
  // Old projects can contain a prepared panel without an explicit mode flag.
  const first=prepareProductionPanel(project,episode.segments[0].id,episode.panelRecords[0].id).panel;
  assert.equal(productionSegmentUnit(project,11,episode.segments[0].id),'panel');
  assert.equal(productionSegmentUnit(project,11,episode.segments[1].id),'screen');
  return {project,episode,first};
}

function assertPositions(project,expected) {
  const entries=layoutLongStrip(project.pages.filter(page=>page.storyboard.episode===11)).pages;
  for(const entry of entries)for(const frame of entry.page.panels.filter(frame=>frame.productionGrid)){
    assert.deepEqual([frame.x,frame.y+entry.y,frame.w,frame.h],expected[frame.productionGrid.panelId]);
  }
}

for(const source of ['imported-design','assistant-preview']) for(const modes of ['legacy-mixed','both-screen','both-panel','reverse-mixed']) {
  test('整话排版保留各屏段模式及最终坐标：'+source+' / '+modes,async()=>{
    const {project,episode,first}=await fixture();
    if(modes==='both-screen'||modes==='reverse-mixed')switchProductionSegmentUnit(project,episode.segments[0].id,'screen');
    if(modes==='both-panel'||modes==='reverse-mixed')prepareProductionPanel(project,episode.segments[1].id,episode.panelRecords[1].id);
    const firstMode=modes==='both-screen'||modes==='reverse-mixed'?'screen':'panel';
    const secondMode=modes==='both-panel'||modes==='reverse-mixed'?'panel':'screen';
    assert.equal(productionSegmentUnit(project,11,episode.segments[0].id),firstMode);
    assert.equal(productionSegmentUnit(project,11,episode.segments[1].id),secondMode);
    const screenHeights=project.pages.map(page=>page.height),firstId=first.id;
    first.imageAssetId='asset_synthetic';
    if(source==='imported-design')layoutProductionEpisode(project,11);
    else {
      // A prior binding avoids changing source screen dimensions while the
      // regression verifies how the accepted preview is applied.
      project.layoutRuleBindings={11:{generationSegments:[]}};
      layoutAssistantEpisode(project,11,{scriptId:'synthetic',contract:{digest:'b'.repeat(64)},geometry:{canvas:{width:1280,height:4000},panels:[{key:'E011-001',x:32,y:0,w:1000,h:1500},{key:'E011-002',x:468,y:1900,w:780,h:1170}],backgrounds:[]}},{assets:[{id:'asset_synthetic',width:1000,height:1500}]});
    }
    assert.deepEqual(project.pages.map(page=>page.height),[1900,2100]);
    assertPositions(project,{'E011-001':[32,0,1000,1500],'E011-002':[468,1900,780,1170]});
    assert.equal(findProductionPanel(project,episode.segments[0].id,episode.panelRecords[0].id).id,firstId);
    assert.equal(first.imageAssetId,'asset_synthetic');
    switchProductionEpisodeUnit(project,11,'screen');
    assert.deepEqual(project.pages.map(page=>page.height),screenHeights);
    switchProductionEpisodeUnit(project,11,'panel');
    assert.deepEqual(project.pages.map(page=>page.height),[1900,2100]);
    assertPositions(project,{'E011-001':[32,0,1000,1500],'E011-002':[468,1900,780,1170]});
  });
}
