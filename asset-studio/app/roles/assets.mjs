import {HAND_CARD_RULES,CHARACTER_CARD_LAYOUT_RULES} from '../../../comic/public/hand-card-rules.js';
import {readMokuConfig} from './moku-session.mjs';
import {createProductionWorkspace} from './production-workspace.mjs';
import {sceneFrontPrompt,propAssetPrompt,ASSET_VISUAL_PROMPT_VERSION} from '../../../comic/lib/scene-asset-prompts.mjs';
import {characterAppearancePrompt,CHARACTER_APPEARANCE_VERSION} from '../../../comic/lib/character-appearance.mjs';
/**
 * 资产生成台：只有一个功能——输入名称/提示词，生成一张资产，采用或重试。
 *
 * 背后固定使用编辑器里的“资产生成”专用工程：
 *   每次生成 = 增加一个资产页 + 一个画格，提交编辑器 Codex，完成后取图。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openBrowser} from '../platform/system/open-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir=process.env.ASSET_STUDIO_DATA_DIR||path.join(root,'data');
const webDir = path.join(root, 'app', 'web', 'assets');
const libraryDir = path.join(dataDir,'asset-library');
const promptsFile = path.join(dataDir,'v005-assets','prompts.json');
const studioFile = path.join(dataDir,'asset-studio.json');
const mokuFile = path.join(dataDir,'moku.json');
const sharedMokuSessionFile=process.env.ASSET_MOKU_SESSION_FILE||(path.resolve(dataDir)===path.join(root,'data')?path.resolve(root,'../production-comic-data-current/library-session.local.json'):'');
const mokuConfig=()=>readMokuConfig(mokuFile,sharedMokuSessionFile);
const editor = process.env.ASSET_EDITOR || 'http://127.0.0.1:18909';

const argPort = process.argv.indexOf('--port');
const port = argPort > 0 ? Number(process.argv[argPort + 1]) : 8796;
const open = process.argv.includes('--open');

const DIMS = {
  '1024x1536': {pageW: 1280, pageH: 1536, x: 128, y: 0, w: 1024, h: 1536},
  '1536x1024': {pageW: 1280, pageH: 854, x: 0, y: 0, w: 1280, h: 853},
  '1536x864': {pageW: 1280, pageH: 864, x: 0, y: 0, w: 1536, h: 864},
  '1024x1024': {pageW: 1280, pageH: 1280, x: 128, y: 128, w: 1024, h: 1024}
};

const jobPanels = new Map();
const production=createProductionWorkspace({root,dataDir,origin:()=>`http://127.0.0.1:${server.address()?.port||port}`,editorJson,readBody,sendJson,studioFile});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
    if (url.pathname.startsWith('/api/')) {
      await api(request, response, url);
      return;
    }
    serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, error.status||500, {error:error.message,code:error.code,occupied:error.occupied});
  }
});

server.listen(port, '127.0.0.1', () => {
  const target = `http://127.0.0.1:${port}/`;
  const studio = readJson(studioFile, null);
  console.log('');
  console.log('资产生成台');
  console.log(`入口     ${target}`);
  console.log(`编辑器   ${editor}`);
  console.log(`资产工程 ${studio?.title || '(未初始化)'} · ${studio?.projectId || '-'}`);
  console.log('只做一件事：生成资产。按 Ctrl+C 停止。');
  console.log('');
  if (open) openBrowser(target);
});

const {installShutdown}=await import('../../../distribution/ipc.mjs');installShutdown({close(){production.close();server.closeAllConnections();server.close();},forceClose(){production.forceStop();server.closeAllConnections();server.close();}});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {production.close();server.close(()=>process.exit(0));});
}

async function api(request, response, url) {
  if(request.method==='GET'&&url.pathname==='/api/asset-generation-coordination'){sendJson(response,200,await production.coordination.status());return;}
  if(await production.handle(request,response,url))return;
  if(production.coordination.enabled&&request.method==='POST'&&['/api/generate','/api/three-view','/api/face-closeup','/api/costume-design','/api/hand-card'].includes(url.pathname))throw Object.assign(Error('团队资产生成必须先核验占用；请从资产工作室的生成记录或本话资产生成，旧入口不能绕过防重。'),{status:409,code:'asset_generation_requires_coordinator'});
  if (request.method === 'GET' && url.pathname === '/api/health') {
    const studio = readJson(studioFile, null);
    let editorOk = false, error = '';
    try {
      const result = await fetch(`${editor}/api/health`, {signal: AbortSignal.timeout(4000)});
      editorOk = result.ok;
    } catch (cause) {
      error = cause.message;
    }
    sendJson(response, 200, {
      ok: editorOk && Boolean(studio?.projectId),codeRoot:root,dataRoot:dataDir,editableProduction:true,teamAssetGenerationLockVersion:1,teamAssetGenerationRequired:production.coordination.enabled,assetHomeVersion:1,sceneSingleViewVersion:1,sceneReverseDescriptionVersion:2,scenePromptVersion:ASSET_VISUAL_PROMPT_VERSION,sceneMirrorCheckVersion:2,scenePropStyle:'2d-anime',characterAppearanceVersion:CHARACTER_APPEARANCE_VERSION,ordinaryCharacterCardVersion:2,handLayoutRulesVersion:4,
      editor,
      assetProject: studio?.title || '',
      projectId: studio?.projectId || '',
      error
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/moku/status') {
    sendJson(response, 200, await mokuStatus());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/moku/project') {
    const input = await readBody(request);
    const config = mokuConfig();
    if (!config?.cookie) throw new Error('墨库未登录');
    const list = await mokuJson(config, '/api/projects');
    const project = (list.items || []).find(item => item.id === input.projectId);
    if (!project) throw new Error('墨库项目不存在或无权访问');
    config.projectId = project.id;
    config.projectName = project.name;
    const settings=readJson(mokuFile,{})||{};settings.projectId=project.id;settings.projectName=project.name;
    fs.writeFileSync(mokuFile, JSON.stringify(settings, null, 2), {mode: 0o600});
    sendJson(response, 200, {ok: true, projectId: project.id, projectName: project.name});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/prompts') {
    const records = readJson(promptsFile, []);
    sendJson(response, 200, {
      prompts: records.map(record => ({
        id: record.variantId,
        assetId: record.assetId,
        name: record.name,
        type: record.type,
        usage: record.usage,
        prompt: record.prompt,
        negative: record.negative,
        shortPrompt: record.type === 'character'
          ? `角色设定卡：${record.name}，${record.lock || '单人'}。单人，正面站姿，纯白背景，二维国漫线稿，清晰五官，无文字无水印。`
          : record.prompt,
        lock: record.lock,
        note: record.note,
        label: `${record.assetId} · ${record.name} · ${record.usage}`
      }))
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/generate') {
    const input = await readBody(request);
    const studio = readJson(studioFile, null);
    if (!studio?.projectId) throw new Error('资产生成工程尚未初始化');
    const type = ['character', 'scene', 'prop'].includes(input.type) ? input.type : 'character';
    const name = String(input.name || '').trim();
    const prompt = String(input.prompt || '').trim();
    const size = type==='scene'?'1536x864':DIMS[input.size] ? input.size : '1024x1536';
    const mode = ['identity', 'outfit', 'state', 'text'].includes(input.mode) ? input.mode : 'text';
    if (!name) throw new Error('请填写资产名称');
    if (!prompt) throw new Error('请填写提示词');

    let referenceAssetId = input.referenceAssetId ? String(input.referenceAssetId) : '';
    if (input.reference) referenceAssetId = await saveReference(input.reference, name);
    let costumeReferenceAssetId = input.costumeReferenceAssetId ? String(input.costumeReferenceAssetId) : '';
    if (input.costumeReference) costumeReferenceAssetId = await saveReference(input.costumeReference, `${name}_服装参考`);
    let handReferenceAssetId = input.handReferenceAssetId ? String(input.handReferenceAssetId) : '';
    if (input.handReference) handReferenceAssetId = await saveReference(input.handReference, `${name}_手部参考`);
    if (type==='character' && mode !== 'text' && !referenceAssetId) {
      throw new Error('首次身份 / 换装 / 状态模式需要先上传一张身份参考图');
    }
    const referenceIds = [referenceAssetId, costumeReferenceAssetId, handReferenceAssetId].filter(Boolean);
    const modePrefix = {
      identity: '参考图是人物身份锚点。严格锁定参考图的五官、脸型、发型、发色、体型和画风，不换脸；按下面要求生成标准角色卡。\n',
      outfit: '参考图1是已批准的身份卡，参考图2是同宗门服装参考（如提供），参考图3是手部卡（如提供）。严格锁定参考图1人物的五官、脸型、发型、发色、体型和画风，只更换服装与配饰，不重新设计人物、不改脸、不改发型。服装的配色、纹样、层次和配饰优先参考图2，保持同宗门体系，不得自创体系外的主色。右栏四手严格按参考图3的左右手与拇指方向，不得镜像错误。\n',
      state: '参考图是已批准的标准角色卡。严格锁定参考图人物的五官、发型、服装和画风，只增加或改变状态（伤病、血迹、湿身、破损等），不换人、不换装。\n',
      text: ''
    }[mode];
    const finalPrompt = type==='scene'?sceneFrontPrompt({...input,name,prompt,referenceIds}):type==='prop'?propAssetPrompt({name,prompt,referenceIds}):[modePrefix+prompt,characterAppearancePrompt({...input,type,name,description:prompt}),CHARACTER_CARD_LAYOUT_RULES].filter(Boolean).join('\n');

    const project = await editorJson(`/api/projects/${studio.projectId}`);
    const dims = DIMS[size];
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const shotId = id('shot');
    const panelId = id('panel');
    const pageId = id('page');
    project.shots.push({
      id: shotId,
      code: `ASSET-${stamp}`,
      title: name,
      description: finalPrompt,
      ...(['scene','prop'].includes(type)?{assetVisualContract:{role:type,version:ASSET_VISUAL_PROMPT_VERSION}}:{}),
      dialogue: '',
      referenceIds: referenceIds
    });
    project.pages.push({
      id: pageId,
      name: `资产 · ${name} · ${stamp}`,
      width: dims.pageW,
      height: dims.pageH,
      background: '#ffffff',
      layoutPreset: 'custom',
      storyboard: {episode: 0, projection: 'asset'},
      panels: [{
        id: panelId,
        shotId,
        name: `${type}:${name}`,
        x: dims.x,
        y: dims.y,
        w: dims.w,
        h: dims.h,
        points: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}],
        kind: 'panel',
        border: 0,
        borderColor: '#242830',
        feather: 0,
        visible: true,
        locked: false,
        candidates: [],
        referenceIds: referenceIds
      }],
      bubbles: []
    });
    await editorFetch(`/api/projects/${studio.projectId}`, {
      method: 'PUT',
      body: project,
      timeout: 60000
    });
    const jobs = await editorJson('/api/jobs', {
      method: 'POST',
      body: {projectId: studio.projectId, panelIds: [panelId], provider: 'codex', action: 'generate'},
      timeout: 60000
    });
    const jobId = jobs[0].id;
    jobPanels.set(jobId, {projectId: studio.projectId, pageId, panelId});
    sendJson(response, 202, {jobId, projectId: studio.projectId, pageId, panelId, mode, referenceAssetId, costumeReferenceAssetId, handReferenceAssetId});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/requests') {
    const registry = readJson(path.join(dataDir,'asset-registry.json'), {assets: []});
    const names = new Map();
    for (const asset of registry.assets || []) {
      if (asset.type === 'character') names.set(asset.assetId, asset.name);
    }
    const requests = [];
    for (const asset of registry.assets || []) {
      const variants = Array.isArray(asset.variants) ? asset.variants : [];
      const seen = new Set();
      const push = (item) => {
        const key = `${asset.assetId}:${item.variantId || item.prompt || ''}`;
        if (seen.has(key) || !item.prompt) return;
        seen.add(key);
        requests.push({
          id: key,
          assetId: asset.assetId,
          type: asset.type,
          name: item.name || asset.name,
          outfit: item.outfit || '',
          prompt: item.prompt,
          negative: item.negative || '',
          size: item.size || '1024x1536',
          mode: item.mode || 'text',
          usage: item.usage || '',
          firstPanel: item.firstPanel || '',
          variantId: item.variantId || '',
          status: asset.approval || 'candidate',
          stage: asset.stage || 'backlog'
        });
      };

      if (asset.type === 'character') {
        for (const variant of variants) {
          push({
            variantId: variant.variantId,
            name: asset.name,
            outfit: variant.lock || asset.baseCostumeId || '',
            prompt: variant.prompt || asset.prompt,
            negative: variant.negative,
            size: '1024x1536',
            mode: asset.components?.identityCard?.editorId ? 'outfit' : 'identity',
            usage: variant.usage,
            firstPanel: variant.firstPanel
          });
        }
      } else if (asset.type === 'costume') {
        for (const variant of variants) {
          push({
            variantId: variant.variantId,
            name: names.get(asset.characterId) || asset.characterId,
            outfit: asset.name,
            prompt: variant.prompt || asset.prompt,
            negative: variant.negative,
            size: '1024x1536',
            mode: 'outfit',
            usage: variant.usage,
            firstPanel: variant.firstPanel
          });
        }
        if (!variants.length) {
          push({
            variantId: '',
            name: names.get(asset.characterId) || asset.characterId,
            outfit: asset.name,
            prompt: asset.prompt,
            size: '1024x1536',
            mode: 'outfit'
          });
        }
      } else if (asset.type === 'scene') {
        for (const variant of variants) {
          push({
            variantId: variant.variantId,
            name: asset.name,
            outfit: [variant.camera, variant.time, variant.weather].filter(Boolean).join(' · '),
            prompt: variant.prompt || asset.prompt,
            size: '1536x1024',
            mode: 'text',
            firstPanel: variant.firstPanel
          });
        }
      } else if (asset.type === 'prop') {
        for (const variant of variants) {
          push({
            variantId: variant.variantId,
            name: asset.name,
            outfit: asset.kind || '道具',
            prompt: variant.prompt || asset.prompt,
            size: '1536x1024',
            mode: 'text',
            firstPanel: variant.firstPanel
          });
        }
      }
    }

    const byId = new Map((registry.assets || []).map(asset => [asset.assetId, asset]));
    const componentId = (asset, name) => asset?.components?.[name]?.editorId || '';

    for (const req of requests) {
      const asset = byId.get(req.assetId);
      let identityRef = '';
      let costumeRef = '';
      let handsRef = '';
      let sceneRef = '';
      let propRef = '';

      if (req.type === 'character') {
        identityRef = componentId(asset, 'identityCard');
        const base = byId.get(`${req.assetId}-${asset?.baseCostumeId || ''}`);
        costumeRef = componentId(base, 'costumeDesign') || componentId(base, 'standardCard');
        handsRef = componentId(asset, 'hands') || componentId(base, 'hands');
      } else if (req.type === 'costume') {
        const character = byId.get(asset?.characterId);
        identityRef = componentId(character, 'identityCard');
        costumeRef = componentId(asset, 'costumeDesign') || componentId(asset, 'standardCard');
        handsRef = componentId(asset, 'hands') || componentId(character, 'hands');
      } else if (req.type === 'scene') {
        sceneRef = componentId(asset, 'master');
      } else if (req.type === 'prop') {
        propRef = componentId(asset, 'main');
      }

      req.requestPrompt = req.prompt;
      req.referenceEditorId = identityRef || sceneRef || propRef;
      req.costumeReferenceEditorId = costumeRef;
      req.handReferenceEditorId = handsRef;
      req.bodySpec = asset?.ageBody || '';
      req.missing = [];

      if (req.type === 'character' || req.type === 'costume') {
        if (!identityRef) req.missing.push('身份卡');
        if (!costumeRef) req.missing.push('服装卡');
      } else if (req.type === 'scene') {
        if (!sceneRef) req.warning = '无主景：按原创候选生成；出图后核对，并在拼版工具栏“设为主景”';
      } else if (req.type === 'prop') {
        if (!propRef) req.missing.push('道具主图');
      }
      req.ready = req.missing.length === 0;

      if (req.type === 'character' || req.type === 'costume') {
        req.executionPrompt = [
          characterAppearancePrompt({type:'character',name:req.name,description:req.prompt}),
          `标准角色卡：${req.name}｜${req.outfit}。16:9 横版，纯白无缝背景。`,
          `参考图1锁五官、脸型、发型、发色；参考图2锁服装体系、配色、纹样和配饰。`,
          req.bodySpec ? `体型/年龄：${req.bodySpec}。` : '',
          CHARACTER_CARD_LAYOUT_RULES,
          '同一个人、同一套服装、同一比例；无场景、无道具、无额外人物；文字只允许标题和标签。',
          req.negative ? `负向：${req.negative}` : ''
        ].filter(Boolean).join('\n');
      } else if (req.type === 'scene') {
        req.executionPrompt = sceneFrontPrompt({name:req.name,prompt:req.prompt,referenceIds:req.referenceEditorId?[req.referenceEditorId]:[]});
      } else {
        req.executionPrompt = propAssetPrompt({name:req.name,prompt:req.prompt});
      }
    }

    requests.sort((a, b) => {
      const stage = (a.stage === 'in_progress' ? 0 : 1) - (b.stage === 'in_progress' ? 0 : 1);
      if (stage) return stage;
      return String(a.assetId).localeCompare(String(b.assetId));
    });
    sendJson(response, 200, {requests, total: requests.length});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/moku-reupload') {
    const input = await readBody(request);
    const assetId = String(input.assetId || '').trim();
    const file = path.resolve(root, String(input.file || ''));
    if (!assetId) throw new Error('缺少 assetId');
    if (!file.startsWith(root) || !fs.existsSync(file)) throw new Error('文件不存在');
    const bytes = fs.readFileSync(file);
    const result = await uploadToMoku(bytes, {
      type: input.type || 'character',
      name: input.name || path.basename(file),
      assetId
    });
    sendJson(response, 200, {ok: true, ...result, size: bytes.length});
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/editor-image') {
    const assetId = url.searchParams.get('id') || '';
    if (!assetId) {
      response.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end('id required');
      return;
    }
    try {
      const image = await fetch(`${editor}/assets/${encodeURIComponent(assetId)}`);
      if (!image.ok) throw new Error(`editor ${image.status}`);
      const bytes = Buffer.from(await image.arrayBuffer());
      response.writeHead(200, {
        'Content-Type': image.headers.get('content-type') || 'image/png',
        'Content-Length': bytes.length,
        'Cache-Control': 'public, max-age=60'
      });
      response.end(bytes);
    } catch (error) {
      response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end(error.message);
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/asset-thumb') {
    const assetId = url.searchParams.get('assetId') || '';
    const registry = readJson(path.join(dataDir,'asset-registry.json'), {assets: []});
    const asset = (registry.assets || []).find(item => item.assetId === assetId);
    if (!asset) {
      response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end('Not found');
      return;
    }
    const priorities = ['standardCard', 'main', 'identityCard', 'master', 'costumeDesign', 'faceCloseup', 'front', 'card'];
    const components = asset.components || {};
    let picked = null;
    for (const name of priorities) {
      const item = components[name];
      if (item && (item.file || item.editorId)) { picked = item; break; }
    }
    if (!picked) {
      for (const item of Object.values(components)) {
        if (item && (item.file || item.editorId)) { picked = item; break; }
      }
    }
    if (!picked) {
      response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end('No thumbnail');
      return;
    }
    try {
      let bytes;
      let contentType = 'image/png';
      if (picked.file) {
        const file = path.resolve(root, picked.file);
        if (!file.startsWith(root) || !fs.existsSync(file)) throw new Error('file missing');
        bytes = fs.readFileSync(file);
        contentType = MIME[path.extname(file)] || 'image/png';
      } else {
        const image = await fetch(`http://127.0.0.1:18909/assets/${encodeURIComponent(picked.editorId)}`);
        if (!image.ok) throw new Error(`editor ${image.status}`);
        bytes = Buffer.from(await image.arrayBuffer());
        contentType = image.headers.get('content-type') || 'image/png';
      }
      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': bytes.length,
        'Cache-Control': 'public, max-age=60'
      });
      response.end(bytes);
    } catch (error) {
      response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end(error.message);
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/registry') {
    sendJson(response, 200, readJson(path.join(dataDir,'asset-registry.json'), {assets: []}));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/registry/validation') {
    sendJson(response, 200, readJson(path.join(dataDir,'asset-validation.json'), {issues: []}));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/scene-master') {
    const input = await readBody(request);
    const recordId = String(input.recordId || '');
    const sceneAssetId = String(input.sceneAssetId || '');
    const record = (production.records || []).find(item => item.id === recordId);
    if (!record || record.type !== 'scene') throw new Error('只有场景记录能设为主景');
    const registryFile = path.join(dataDir, 'asset-registry.json');
    const registry = readJson(registryFile, {assets: []});
    const asset = (registry.assets || []).find(item => item.assetId === sceneAssetId && item.type === 'scene');
    if (!asset) throw new Error('台账里没有这个场景资产');
    const card = await fetch(`http://127.0.0.1:${port}/api/production-records/${encodeURIComponent(recordId)}/image?slot=card`, {signal: AbortSignal.timeout(60000)});
    if (!card.ok) throw new Error('这张场景还没有拼版图');
    const bytes = Buffer.from(await card.arrayBuffer());
    const folder = path.join(libraryDir, 'scene');
    fs.mkdirSync(folder, {recursive: true});
    const displayName = `${asset.assetId}_${asset.name}_主景_${Date.now()}`;
    const file = path.join(folder, `${safeName(displayName)}.png`);
    fs.writeFileSync(file, bytes);
    const registered = await editorJson('/api/assets', {
      method: 'POST',
      timeout: 60000,
      body: {filePath: file, name: path.basename(file)}
    });
    asset.components ||= {};
    const relativeFile = file.startsWith(root + path.sep) ? path.relative(root, file).replaceAll('\\', '/') : file.replaceAll('\\', '/');
    asset.components.master = {
      status: 'confirmed',
      editorId: registered.id,
      file: relativeFile,
      source: 'studio',
      recordId,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
    sendJson(response, 201, {
      ok: true,
      sceneAssetId: asset.assetId,
      editorId: registered.id,
      file: asset.components.master.file
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/compose-sample') {
    const name = url.searchParams.get('name') || '';
    const samples = {
      face: 'data/asset-library/standard/face.png',
      front: 'data/asset-library/standard/front.png',
      side: 'data/asset-library/standard/side.png',
      back: 'data/asset-library/standard/back.png',
      hands: 'data/asset-library/prop/宋凌天｜灵剑峰内门道袍_手部卡_1792474996660.png'
    };
    const relative = samples[name];
    if (!relative) {
      response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end('Not found');
      return;
    }
    const file = path.join(root, relative);
    const bytes = fs.readFileSync(file);
    response.writeHead(200, {'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'no-cache'});
    response.end(bytes);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/prop-save') {
    const input = await readBody(request);
    const studio = readJson(studioFile, null);
    if (!studio?.mainProjectId) throw new Error('主工作台工程未配置');
    const name = String(input.name || '道具').trim();
    const outfit = String(input.outfit || '').trim();
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(input.data || ''));
    if (!match) throw new Error('道具卡不是 PNG');
    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.length || bytes.length > 45 * 1024 * 1024) throw new Error('道具卡过大');
    const displayName = outfit ? `${name}｜${outfit}` : name;
    const folder = path.join(libraryDir, 'prop');
    fs.mkdirSync(folder, {recursive: true});
    const file = path.join(folder, `${safeName(displayName)}_${Date.now()}.png`);
    fs.writeFileSync(file, bytes);
    const asset = await editorJson('/api/assets', {
      method: 'POST',
      timeout: 60000,
      body: {filePath: file, name: path.basename(file)}
    });
    let moku = null;
    let warning = '';
    try {
      moku = await uploadToMoku(bytes, {type: 'prop', name: displayName});
    } catch (error) {
      warning = error.message;
    }
    const project = await editorJson(`/api/projects/${studio.mainProjectId}`);
    await editorJson(`/api/projects/${studio.mainProjectId}/asset-library`, {
      method: 'POST',
      body: {type: 'images', filePaths: [file], revision: project.revision}
    });
    sendJson(response, 201, {ok: true, file, assetId: asset.id, moku, warning, displayName});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/compose-save') {
    const input = await readBody(request);
    const studio = readJson(studioFile, null);
    if (!studio?.mainProjectId) throw new Error('主工作台工程未配置');
    const type = ['character','scene','prop'].includes(input.type)?input.type:'character';
    const name = String(input.name || (type==='scene'?'场景':'角色')).trim();
    const outfit = String(input.outfit || '').trim();
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(input.data || ''));
    if (!match) throw new Error('拼版结果不是 PNG');
    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.length || bytes.length > 45 * 1024 * 1024) throw new Error('拼版结果过大');
    const displayName = outfit ? `${name}｜${outfit}` : name;
    const folder = path.join(libraryDir, type==='scene'?'scene':type==='prop'?'prop':'standard');
    fs.mkdirSync(folder, {recursive: true});
    const file = path.join(folder, `${type==='scene'?'SCENE_000_':type==='prop'?'PROP_000_':''}${safeName(displayName)}${type==='scene'?'_主景':''}_${Date.now()}.png`);
    fs.writeFileSync(file, bytes);
    const asset = await editorJson('/api/assets', {
      method: 'POST',
      timeout: 60000,
      body: {filePath: file, name: path.basename(file)}
    });
    let moku = null;
    let warning = '';
    try {
      moku = await uploadToMoku(bytes, {type, name: displayName});
    } catch (error) {
      warning = error.message;
    }
    const project = await editorJson(`/api/projects/${studio.mainProjectId}`);
    await editorJson(`/api/projects/${studio.mainProjectId}/asset-library`, {
      method: 'POST',
      body: {type: 'images', filePaths: [file], revision: project.revision}
    });
    sendJson(response, 201, {ok: true, file, assetId: asset.id, moku, warning, displayName});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/three-view') {
    const input = await readBody(request);
    const studio = readJson(studioFile, null);
    if (!studio?.projectId) throw new Error('资产生成工程尚未初始化');
    const name = String(input.name || '').trim();
    const outfit = String(input.outfit || '').trim();
    if (!name || !outfit) throw new Error('请填写角色名和服装名');
    if (!input.reference) throw new Error('三视图需要身份参考图');
    const referenceAssetId = await saveReference(input.reference, `${name}_三视图身份参考`);
    let costumeReferenceAssetId = '';
    if (input.costumeReference) costumeReferenceAssetId = await saveReference(input.costumeReference, `${name}_三视图服装参考`);
    const prompt = `全身三视图：${name}｜${outfit}。16:9横版，纯白无缝背景。
从左到右：正面全身、3/4侧面全身、背面全身；同一角色、同一服装、同一比例，头顶和鞋底对齐，完整全身不裁头不裁脚。
三个人物之间必须留出至少 8% 画布宽度的纯白间隔；人物、衣摆、发梢、手、道具都不得互相接触、重叠或越界。
脸和发型按参考图1；服装按参考图2的宗门体系。无文字、无标签、无场景、无道具。`;
    const result = await submitAssetJob({
      studio,
      name: `${name}｜${outfit} · 三视图`,
      prompt,
      referenceIds: [referenceAssetId, costumeReferenceAssetId].filter(Boolean),
      sizeKey: '1536x864'
    });
    sendJson(response, 202, {...result, mode: 'three-view', referenceAssetId, costumeReferenceAssetId});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/face-closeup') {
    const input = await readBody(request);
    const studio = readJson(studioFile, null);
    if (!studio?.projectId) throw new Error('资产生成工程尚未初始化');
    const name = String(input.name || '').trim();
    if (!name) throw new Error('请填写角色名');
    if (!input.reference) throw new Error('脸发特写需要身份参考图');
    const referenceAssetId = await saveReference(input.reference, `${name}_脸发参考`);
    const prompt = `巨大正面头部特写：${name}。竖版 1024×1536，纯白无缝背景。
完整展示全部头发、发髻、发冠、发带、马尾和发尾，四周留少量白边，不裁发。脸正对镜头、头竖直、双眼水平。
严格按参考图的五官、脸型、发型、发色和画风，不换脸。只留极少颈部，不出现肩膀、胸口、衣领或身体。
无文字、无标签、无场景、无道具。`;
    const result = await submitAssetJob({
      studio,
      name: `${name} · 脸发特写`,
      prompt,
      referenceIds: [referenceAssetId],
      sizeKey: '1024x1536'
    });
    sendJson(response, 202, {...result, mode: 'face-closeup', referenceAssetId});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/costume-design') {
    const input = await readBody(request);
    const studio = readJson(studioFile, null);
    if (!studio?.projectId) throw new Error('资产生成工程尚未初始化');
    const name = String(input.name || '').trim();
    const outfit = String(input.outfit || '').trim();
    if (!name || !outfit) throw new Error('请填写角色名和服装名');
    if (!input.reference) throw new Error('服装设计需要上传同宗门服装参考图');
    const referenceAssetId = await saveReference(input.reference, `${name}_${outfit}_服装参考`);
    const prompt = costumePrompt({name, outfit, ...input});
    const result = await submitAssetJob({
      studio,
      name: `${name}｜${outfit} · 服装设计`,
      prompt,
      referenceIds: [referenceAssetId],
      sizeKey: '1536x864'
    });
    sendJson(response, 202, {...result, mode: 'costume', referenceAssetId});
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/hand-card') {
    const input = await readBody(request);
    const studio = readJson(studioFile, null);
    if (!studio?.projectId) throw new Error('资产生成工程尚未初始化');
    const name = String(input.name || '').trim();
    if (!name) throw new Error('请填写角色名');
    if (!input.reference) throw new Error('手部卡需要上传角色标准卡参考图');
    const sizeKey = DIMS[input.size] ? input.size : '1024x1536';
    const referenceAssetId = await saveReference(input.reference, `${name}_手部参考`);
    let costumeReferenceAssetId = '';
    if (input.costumeReference) costumeReferenceAssetId = await saveReference(input.costumeReference, `${name}_手部服装参考`);
    const referenceIds = [referenceAssetId, costumeReferenceAssetId].filter(Boolean);
    const prompt = handPrompt(name, sizeKey, Boolean(costumeReferenceAssetId));
    const result = await submitAssetJob({
      studio,
      name: `${name} · 手部卡`,
      prompt,
      referenceIds,
      sizeKey
    });
    sendJson(response, 202, {...result, mode: 'hands', referenceAssetId, costumeReferenceAssetId, size: sizeKey});
    return;
  }

  const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && jobMatch) {
    const job = await editorJob(jobMatch[1]);
    sendJson(response, 200, job);
    return;
  }

  const imageMatch = /^\/api\/jobs\/([^/]+)\/image$/.exec(url.pathname);
  if (request.method === 'GET' && imageMatch) {
    const job = await editorJob(imageMatch[1]);
    if (!job.asset?.id) {
      sendJson(response, 404, {error: '还没有生成图片'});
      return;
    }
    const image = await fetch(`${editor}/assets/${job.asset.id}`, {signal: AbortSignal.timeout(60000)});
    if (!image.ok) {
      sendJson(response, 502, {error: `取图失败：HTTP ${image.status}`});
      return;
    }
    const bytes = Buffer.from(await image.arrayBuffer());
    response.writeHead(200, {
      'Content-Type': image.headers.get('content-type') || 'image/png',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store'
    });
    response.end(bytes);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/push-to-editor') {
    const input = await readBody(request);
    const studio = readJson(studioFile, null);
    if (!studio?.mainProjectId) throw new Error('未配置主工作台工程');
    const job = await editorJob(input.jobId);
    if (!job.asset?.id) throw new Error('任务还没有可送入主工作台的图片');
    const image = await fetch(`${editor}/assets/${job.asset.id}`, {signal: AbortSignal.timeout(60000)});
    if (!image.ok) throw new Error(`取图失败：HTTP ${image.status}`);
    const bytes = Buffer.from(await image.arrayBuffer());
    const type = ['character', 'scene', 'prop'].includes(input.type) ? input.type : 'character';
    const prefix = type === 'character' ? 'CHAR' : type === 'scene' ? 'SCENE' : 'PROP';
    const label = input.outfit ? `${input.name || 'asset'}_${input.outfit}` : (input.name || job.asset.name || 'asset');
    const name = `${prefix}_${Date.now()}_${safeName(label)}_标准卡.png`;
    const folder = path.join(libraryDir, 'push');
    fs.mkdirSync(folder, {recursive: true});
    const file = path.join(folder, `${Date.now()}_${name}`);
    fs.writeFileSync(file, bytes);
    const asset = await editorJson('/api/assets', {
      method: 'POST',
      timeout: 60000,
      body: {filePath: file, name}
    });
    const project = await editorJson(`/api/projects/${studio.mainProjectId}`);
    await editorJson(`/api/projects/${studio.mainProjectId}/asset-library`, {
      method: 'POST',
      timeout: 60000,
      body: {
        type: 'images',
        filePaths: [file],
        revision: project.revision
      }
    });
    sendJson(response, 201, {
      ok: true,
      assetId: asset.id,
      file: path.relative(root, file).replaceAll('\\', '/'),
      projectId: studio.mainProjectId,
      projectUrl: `${editor}/?project=${encodeURIComponent(studio.mainProjectId)}`
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/adopt') {
    const input = await readBody(request);
    const job = await editorJob(input.jobId);
    if (!job.asset?.id) throw new Error('任务还没有可采用的图片');
    const image = await fetch(`${editor}/assets/${job.asset.id}`, {signal: AbortSignal.timeout(60000)});
    if (!image.ok) throw new Error(`取图失败：HTTP ${image.status}`);
    const bytes = Buffer.from(await image.arrayBuffer());
    const type = ['character', 'scene', 'prop'].includes(input.type) ? input.type : 'character';
    const folder = path.join(libraryDir, type);
    fs.mkdirSync(folder, {recursive: true});
    const name = input.name || job.asset.name;
    const displayName = input.outfit ? `${input.name}｜${input.outfit}` : name;
    const base = safeName(displayName || 'asset');
    const file = path.join(folder, `${base}_${Date.now()}.png`);
    fs.writeFileSync(file, bytes);
    const indexFile = path.join(libraryDir, 'index.json');
    const index = readJson(indexFile, []);
    index.push({
      file: path.relative(root, file).replaceAll('\\', '/'),
      type,
      name: displayName,
      prompt: input.prompt || '',
      size: [job.asset.width, job.asset.height],
      jobId: input.jobId,
      createdAt: new Date().toISOString()
    });
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
    let moku = null, warning = '';
    try {
      moku = await uploadToMoku(bytes, {
        type,
        name: displayName
      });
    } catch (error) {
      warning = error.message;
    }
    sendJson(response, 201, {
      ok: true,
      file: path.relative(root, file).replaceAll('\\', '/'),
      moku,
      warning
    });
    return;
  }

  sendJson(response, 404, {error: '接口不存在'});
}

async function editorJob(id) {
  const state = await editorJson('/api/state', {timeout: 20000});
  const job = (state.jobs || []).find(item => item.id === id);
  if (!job) throw Object.assign(new Error('任务不存在'), {status: 404});
  const known = jobPanels.get(id) || {projectId: job.projectId, panelId: job.panelId};
  let asset = null;
  if (job.status === 'done' && known.panelId) {
    try {
      const project = await editorJson(`/api/projects/${known.projectId}`);
      const panel = project.pages.flatMap(page => page.panels).find(item => item.id === known.panelId);
      if (panel?.imageAssetId) {
        const assets = await editorJson('/api/assets');
        const meta = assets.find(item => item.id === panel.imageAssetId);
        if (meta) {
          asset = {
            id: meta.id,
            name: meta.name,
            width: meta.width,
            height: meta.height,
            imageUrl: `/api/jobs/${encodeURIComponent(id)}/image`
          };
        }
      }
    } catch {
      // 任务状态优先；图片查询失败时下一轮再试。
    }
  }
  const status = job.status === 'done' ? (asset ? 'completed' : 'running') : job.status;
  return {
    id: job.id,
    status,
    phase: job.phase,
    message: job.message,
    progress: null,
    asset
  };
}

async function submitAssetJob({studio, name, prompt, referenceIds, sizeKey = '1536x864'}) {
  const project = await editorJson(`/api/projects/${studio.projectId}`);
  const dims = DIMS[sizeKey] || DIMS['1536x864'];
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const shotId = id('shot');
  const panelId = id('panel');
  const pageId = id('page');
  project.shots.push({
    id: shotId,
    code: `ASSET-${stamp}`,
    title: name,
    description: prompt,
    dialogue: '',
    referenceIds
  });
  project.pages.push({
    id: pageId,
    name: `资产 · ${name} · ${stamp}`,
    width: dims.pageW,
    height: dims.pageH,
    background: '#ffffff',
    layoutPreset: 'custom',
    storyboard: {episode: 0, projection: 'asset'},
    panels: [{
      id: panelId,
      shotId,
      name,
      x: dims.x,
      y: dims.y,
      w: dims.w,
      h: dims.h,
      points: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}],
      kind: 'panel',
      border: 0,
      borderColor: '#242830',
      feather: 0,
      visible: true,
      locked: false,
      candidates: [],
      referenceIds
    }],
    bubbles: []
  });
  await editorJson(`/api/projects/${studio.projectId}`, {
    method: 'PUT',
    body: project,
    timeout: 60000
  });
  const jobs = await editorJson('/api/jobs', {
    method: 'POST',
    body: {projectId: studio.projectId, panelIds: [panelId], provider: 'codex', action: 'generate'},
    timeout: 60000
  });
  const jobId = jobs[0].id;
  jobPanels.set(jobId, {projectId: studio.projectId, pageId, panelId});
  return {jobId, projectId: studio.projectId, pageId, panelId};
}

function costumePrompt(input) {
  const fields = [
    ['宗门', input.sect],
    ['峰/分支', input.peak],
    ['品级', input.rank],
    ['场合', input.occasion],
    ['主色', input.mainColor],
    ['辅色', input.accentColor],
    ['纹样', input.pattern],
    ['腰带', input.sash],
    ['靴', input.boots],
    ['护腕', input.wrist]
  ].filter(([, value]) => String(value || '').trim());
  return `纯服装设计卡，不出现人物、人体、脸、头发、手、皮肤、假人或衣架。16:9横版，1536×864，纯白无缝背景。
服装：${input.outfit}。
${fields.map(([key, value]) => `${key}：${value}`).join('\n')}
参考图是同宗门服装，沿用其宗门体系、配色逻辑、纹样语言和画风；在此基础上设计本套服装，不照搬参考图中的角色。
画面：约三分之二展示整套服装的正面和背面空衣状态，旁边分离摆放配饰、腰带、护腕和鞋；约三分之一安排 3—6 个无文字局部放大（领口层次、腰带扣、云纹、护腕、靴面）。只画服装本身，衣服内部为空。
无人物、无场景、无道具、无标题文字、无水印。${input.notes ? `\n补充：${input.notes}` : ''}`;
}

function handPrompt(name, sizeKey = '1024x1536', hasCostume = false) {
  const portrait = sizeKey === '1024x1536';
  const layout = portrait
    ? '竖版 1024×1536，纯白无缝背景，两列两行'
    : '16:9横版，1536×864，纯白无缝背景，仍为两行两列，四格等大';
  const costume = hasCostume
    ? '参考图2是这套服装；袖口、护腕的颜色、材质和结构按参考图2，不沿用参考图1的旧服装袖口。'
    : '袖口、护腕、手套和肤色按参考角色标准卡，不添加参考图没有的配饰。';
  return `手部卡：${name}。${layout}。
${HAND_CARD_RULES}
每格只出现手、腕和少量前臂；左右手必须镜像正确，手指结构准确，不裁切。${costume}
无脸、无身体、无文字、无道具、无场景。`;
}

async function saveReference(dataUrl, name) {  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(dataUrl));
  if (!match) throw new Error('参考图只支持 PNG、JPEG、WebP');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('参考图不能超过 15MB');
  const ext = match[1] === 'image/png' ? 'png' : match[1] === 'image/webp' ? 'webp' : 'jpg';
  const folder = path.join(libraryDir, 'references');
  fs.mkdirSync(folder, {recursive: true});
  const file = path.join(folder, `${Date.now()}_${safeName(name)}.${ext}`);
  fs.writeFileSync(file, bytes);
  const asset = await editorJson('/api/assets', {
    method: 'POST',
    timeout: 60000,
    body: {filePath: file, name: path.basename(file)}
  });
  return asset.id;
}

async function editorJson(route, {method = 'GET', body, timeout = 30000} = {}) {
  const response = await fetch(`${editor}${route}`, {
    method,
    headers: body === undefined ? {} : {'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`),{status:response.status});
  return data;
}

async function editorFetch(route, {method = 'GET', body, timeout = 30000} = {}) {
  return editorJson(route, {method, body, timeout});
}

async function mokuStatus() {
  const config = mokuConfig();
  if (!config?.cookie) {
    return {ok: false, error: '墨库未登录', projectId: '', projectName: ''};
  }
  try {
    const response = await fetch(`${config.base}/api/auth/me`, {
      headers: {Cookie: config.cookie, Origin: config.base},
      signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    if (!response.ok) {
      return {ok: false, error: response.status===401?'墨库会话已失效，请在漫画工作台登录墨库':`墨库连接异常（HTTP ${response.status}）`, projectId: config.projectId || '', projectName: config.projectName || ''};
    }
    const account = JSON.parse(text),user=account.user||account;
    let projects = [];
    try {
      const list = await mokuJson(config, '/api/projects');
      projects = list.items || [];
    } catch {
      // 项目列表失败不影响登录状态。
    }
    return {
      ok: true,
      user:{id:user.id,username:user.username,displayName:user.displayName},
      sessionSource:config.sessionSource,
      base: config.base,
      projectId: config.projectId || '',
      projectName: config.projectName || '',
      projects
    };
  } catch (error) {
    return {ok: false, error: error.message, projectId: config.projectId || '', projectName: config.projectName || ''};
  }
}

async function mokuJson(config, route, {method = 'GET', body, headers = {}, timeout = 60000} = {}) {
  const requestHeaders = {
    Cookie: config.cookie,
    Origin: config.base,
    Referer: `${config.base}/api-docs`,
    ...headers
  };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${config.base}${route}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    const error = new Error(data?.error?.message || `墨库 HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function uploadToMoku(bytes, {type, name, assetId = ''}) {
  const config = mokuConfig();
  if (!config?.cookie) throw new Error('墨库未登录');
  if (!config.projectId) throw new Error('未配置墨库项目');
  const folder = type === 'character' ? '角色' : type === 'scene' ? '场景' : '道具';
  const uploadName = /\.(png|jpe?g|webp)$/i.test(name) ? name : `${name}.png`;
  const mime = /\.jpe?g$/i.test(uploadName) ? 'image/jpeg' : /\.webp$/i.test(uploadName) ? 'image/webp' : 'image/png';
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let objectVersion;
  if (assetId) {
    const asset = await mokuJson(config, `/api/assets/${assetId}`);
    objectVersion = asset.objectVersion;
  }
  const created = await mokuJson(config, '/api/uploads', {
    method: 'POST',
    headers: {'Idempotency-Key': randomUUID()},
    body: {
      projectId: config.projectId,
      ...(assetId ? {assetId, objectVersion} : {}),
      name: uploadName,
      size: bytes.length,
      mime,
      folder,
      category: type,
      expectedSha256: sha256
    }
  });
  if (created.state === 'completed' && created.assetId) {
    return {assetId: created.assetId, revisionId: created.revisionId, projectId: created.projectId, projectName: config.projectName};
  }
  const chunkSize = Number(created.chunkSize) || 16 * 1024 * 1024;
  const chunkCount = Math.ceil(bytes.length / chunkSize);
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = bytes.subarray(index * chunkSize, Math.min(bytes.length, (index + 1) * chunkSize));
    const chunkSha = createHash('sha256').update(chunk).digest('hex');
    const response = await fetch(`${config.base}/api/uploads/${created.id}/chunks/${index}`, {
      method: 'PUT',
      headers: {
        Cookie: config.cookie,
        Origin: config.base,
        Referer: `${config.base}/api-docs`,
        'Content-Type': 'application/octet-stream',
        'X-Chunk-SHA256': chunkSha
      },
      body: chunk,
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`分片 ${index + 1}/${chunkCount} 上传失败：${text.slice(0, 200)}`);
    }
  }
  await mokuJson(config, `/api/uploads/${created.id}/complete`, {
    method: 'POST',
    headers: {'Idempotency-Key': randomUUID()},
    body: {}
  });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const state = await mokuJson(config, `/api/uploads/${created.id}`);
    if (state.state === 'completed') {
      return {
        assetId: state.assetId,
        revisionId: state.revisionId,
        projectId: state.projectId,
        projectName: config.projectName
      };
    }
    if (['failed', 'cancelled'].includes(state.state)) {
      throw new Error(state.error || '墨库上传失败');
    }
  }
  throw new Error('墨库校验超时');
}

function serveStatic(response, pathname) {
  const relative = pathname === '/'
    ? 'index.html'
    : pathname === '/registry'
      ? 'registry.html'
      : pathname.replace(/^\/+/, '');
  const file = path.resolve(webDir, relative);
  if (!file.startsWith(webDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end('Not found');
    return;
  }
  const bytes = fs.readFileSync(file);
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': bytes.length,
    'Cache-Control': 'no-cache'
  });
  response.end(bytes);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 60 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store'
  });
  response.end(bytes);
}

function safeName(value) {
  return String(value).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'asset';
}

function id(prefix) {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}
