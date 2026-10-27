# 项目生产中心 API v1

统一入口：http://中心电脑IP:8790。本机回环免令牌；同事和工具使用项目接入配置中的 Bearer token。每个项目拥有独立 projectId。图片、规范、引用均使用固定 ID；本地路径只作校验缓存，不能作为跨机接口。

1. POST /api/v1/projects：{title,externalKey} 创建/查找项目；externalKey 是来源工具的稳定工程编号。
2. POST /api/v1/projects/:projectId/files?name=原文件名：Content-Type 对应原件格式，body 是原始文件字节；返回 fileId、sha256、version、contentUrl。相同名称和内容去重；变化保留新版本。单次上限128MB。POST JSON 也支持 {name,mime,type,data:base64}，建议原始字节上传。
3. GET /api/v1/projects/:projectId/files；GET /api/v1/files/:fileId/content：读取固定原件。
4. POST /api/v1/projects/:projectId/standards/drafts：{rules,sourceFileIds}；POST /standards/:id/publish：{expectedRevision}。规范分组：visual、characters、continuity、layout、typography、dialogue、images、prompts、review、naming、delivery、permissions、revision。原件只保管，不会未经确认自动变成强制规则。
5. POST /api/v1/projects/:projectId/asset-requests：{role:"character|scene|prop",name,state,prompt,requester,episode,referenceFileIds,clientRequestId,executor:"local|distributed"}。角色走角色工房；场景/道具走场景引擎。任务冻结规范及参考；同内容活动请求合并，正式资产按身份及形态复用。
6. GET /api/v1/projects/:projectId：dashboard 包含 files、standards、assets、versions、tasks、progress、workers、bindings、artifacts、changes。
7. POST /api/v1/projects/:projectId/versions/:versionId/approve：{expectedApprovedVersionId:null或当前正式版本}。已变化的候选拒绝直接采用。
8. POST /api/v1/projects/:projectId/bindings：{versionId,tool,targetId,role,episode,responsible,expectedVersionId,locked}。引用采用精确版本。已锁定引用不会自动换图。
9. POST /api/v1/projects/:projectId/progress：{person,episode,stage,completed,total,message}。stage=script/assets/storyboard/layout/generation/repair/review/export/done。
10. POST /api/v1/projects/:projectId/comic-snapshots：漫画自动上传项目快照和依赖图。POST /dependencies：{sourceId,targetId} 为其他工具记录同项目依赖。
11. POST /changes/preview：{description,sourceIds}；POST /changes/:changeId/commit：确认标记后续工作。GET /changes?cursor=序号：增量事件，保留游标后继续读取。
12. POST /api/v1/workers/heartbeat：{machineId,poolId,projectIds,roles,capacity,reserve,localActive,paused,ready}；POST /workers/:id/claim。capacity 最大6；reserve 为保留名额；同一机器/执行池不重复计数。
13. POST /workers/:workerId/tasks/:taskId/progress|result|fail：每次带 leaseToken。先 progress {started:true} 再启动真实生成。result 传 imageBase64；fail 的 generationEnded=true 仅用于确认生成已停止。开始后失联变 uncertain，禁止自动重派。

大文件：POST /projects/:p/uploads 传 {name,mime,type,totalBytes,sha256,clientRequestId}，最大5GB；PUT /projects/:p/uploads/:uploadId/chunks/:n 传原始8MiB分片（末片按实际长度）；POST .../complete 合并并核验。重复start返回已上传分片，重复complete返回同一文件。推荐PSD和大型原件使用此接口。

规范原件解析：POST /projects/:p/standards/import {fileId} 支持TXT、MD、DOCX、EPUB或结构化规范JSON，只建立待人工核对草稿。高级规则必须属于已定义分组。

审核与任务：POST /projects/:p/versions/:v/reject {reason}；POST /projects/:p/tasks/:t/retry {confirmRemoteStopped,confirmUpdated,prompt}；POST .../cancel 仅取消未开始任务，已生成的候选用审核退回。来源失效的任务重试必须确认已按新要求更新。POST /projects/:p/artifacts/:id/acknowledge {standardsId,confirmUpdated:true} 记录人工更新确认。

接入配置：本机管理员 POST /projects/:p/access-tokens {label,projectIds,scopes:["read","intake"]}，返回带LAN地址的hub和token。审核/发布另需write；不向接单器发管理权限。heartbeat还需registrationKey：接单器在本机产生并保留的随机注册密钥，同一机器/执行池重连必须一致。不要用不同目录重复冒充新机器来扩充名额。

事件采用GET /projects/:p/changes?cursor=...增量轮询，保留返回cursor；当前未实现Webhook交付。角色身份、字体可用性、风格与剧情语义需在工作台人工复核；结构化规范校验不等于视觉审核通过。

所有写入均需检查 HTTP 状态。重复提交沿用同一个 clientRequestId。跨项目返回404/403；规范发布、审核、变更提交采用 write 权限。文件链接不可代替权限校验。生成内容是否满足角色身份、画风和剧情仍须人工看图确认；尺寸、格式、大小及版本由接口校验。

旧漫画 /api/v1/requirements/batches 和版本审核协议由同一入口兼容，内部投影不单独维护素材库。候选生成由中心调度；漫画沿用原有审核、自动匹配及锁定保护。
