import fs from 'node:fs';
const jsonSchema={type:'object',additionalProperties:true},reply={description:'JSON response',content:{'application/json':{schema:jsonSchema}}};
const post=(summary,properties,required=[])=>({summary,requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties,required}}}},responses:{200:reply,201:reply,400:reply,401:reply,403:reply,409:reply}});
const string={type:'string'},boolean={type:'boolean'},lease={leaseToken:string},paths={
 '/api/health':{get:{summary:'不含数据的存活检查',security:[],responses:{200:reply}}},
 '/api/v1/status':{get:{summary:'作品范围内的作品、任务、资产、版本和真实状态',parameters:['workId','status','limit','offset'].map(name=>({in:'query',name,schema:{type:'string'}})),responses:{200:reply}}},
 '/api/v1/requirements/batches':{post:post('client/admin：幂等提交需求；相同资产活动任务复用',{format:{const:'comic-asset-requirements-v1'},idempotencyKey:string,work:jsonSchema,provider:{enum:['external','codex']},needs:{type:'array',minItems:1,maxItems:500,items:{$ref:'#/components/schemas/Need'}}},['format','idempotencyKey','work','needs'])},
 '/api/v1/tasks/claim':{post:post('worker/admin：领取pending任务，租约120秒；仅领取明确任务列表时传taskIds',{provider:{enum:['external','codex']},workId:string,taskId:string,taskIds:{type:'array',items:string}})},
 '/api/v1/tasks/{taskId}':{get:{summary:'查询原任务；失联状态uncertain不会自动重派',responses:{200:reply}}},
 '/api/v1/tasks/{taskId}/heartbeat':{post:post('worker/admin：默认每20秒心跳；message记录真实阶段，不编造百分比',{...lease,running:boolean,message:string,progress:{type:'number',minimum:0,maximum:99}},['leaseToken'])},
 '/api/v1/tasks/{taskId}/result':{post:post('worker/admin：提交图片，幂等保存待人工确认版本；原租约可交付uncertain的迟到结果',{...lease,idempotencyKey:string,imageBase64:{type:'string',description:'PNG/JPEG/WebP base64，解码后≤30MiB'},note:string},['leaseToken','idempotencyKey','imageBase64'])},
 '/api/v1/tasks/{taskId}/fail':{post:post('worker/admin：只有确认执行结束才传uncertain=false，状态不明保持true',{...lease,message:string,uncertain:boolean},['leaseToken','uncertain'])},
 '/api/v1/tasks/{taskId}/control':{post:post('client/admin：人工重试、取消、核对资料或另建候选版本；uncertain重试必须核实原任务结束',{action:{enum:['retry','cancel','ready','regenerate']},confirmRemoteStopped:boolean,confirmInfo:boolean},['action'])},
 '/api/v1/assets/{assetId}/versions':{get:{summary:'查询资产固定版本；client/admin可审核，worker仅能读自己产出的候选和正式版本',responses:{200:reply}}},
 '/api/v1/versions/{versionId}':{get:{summary:'图片版本元数据，含SHA-256和实际尺寸',responses:{200:reply}}},
 '/api/v1/versions/{versionId}/image':{get:{summary:'认证下载固定版本图片',responses:{200:{description:'版本图片',content:{'image/png':{schema:{type:'string',format:'binary'}},'image/jpeg':{schema:{type:'string',format:'binary'}},'image/webp':{schema:{type:'string',format:'binary'}}}},401:reply,403:reply}}},
 '/api/v1/versions/{versionId}/review':{post:post('client/admin：人工确认或退回；用expectedApprovedVersionId防止覆盖并发确认',{action:{enum:['approve','reject']},expectedApprovedVersionId:{type:['string','null']},reason:string},['action','expectedApprovedVersionId'])},
 '/api/v1/keys':{get:{summary:'admin：只返回令牌元数据，不返回密钥',responses:{200:reply}},post:post('admin：创建作品专用令牌，只返回一次明文',{role:{enum:['client','worker','admin']},label:string,workId:{type:['string','null']}},['role','label'])},
 '/api/v1/keys/{keyId}':{delete:{summary:'admin：撤销令牌',responses:{200:reply}}},
 '/api/v1/backup':{post:post('admin：一致性SQLite与图片备份',{})},
 '/api/v1/events':{get:{summary:'admin：最近200条审计事件',responses:{200:reply}}}
};
for(const [route,item] of Object.entries(paths)){const names=[...route.matchAll(/\{(\w+)\}/g)].map(match=>match[1]);if(names.length)item.parameters=names.map(name=>({in:'path',name,required:true,schema:string}));}
const document={openapi:'3.1.0',info:{title:'漫画共享资产中心 API',version:'1.0.0',description:'所有v1接口要求Bearer令牌，权限按role和作品限制。仅接口与SDK就绪，未完成外部工具的真实对接。'},servers:[{url:'http://127.0.0.1:19080'}],security:[{bearerAuth:[]}],paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'}},schemas:{Need:{type:'object',required:['role','name','prompt','spec','usages'],properties:{stableId:string,workTitle:string,role:{enum:['character','scene','prop','style']},name:string,aliases:{type:'array',items:string},state:string,prompt:string,style:string,sourceEvidence:string,spec:jsonSchema,references:{type:'array',items:{type:'string',description:'同作品的已确认versionId'}},confirmedDesign:boolean,needsConfirmation:boolean,usages:{type:'array',items:jsonSchema}}}}}};
fs.writeFileSync(new URL('../public/openapi.json',import.meta.url),JSON.stringify(document,null,2));
