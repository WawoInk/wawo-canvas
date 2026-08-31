# HTTP API

## 约定

鉴权缩写：

- `P`：公开。
- `O`：OptionalAuth；有效 JWT 时注入用户。
- `U`：`UserAuth`；拒绝 guest。
- `A`：`AdminAuth`；要求平台 `admin`。
- `W`：外部 webhook，不用 JWT，使用 callback token。

普通业务响应：

```json
{
  "code": 0,
  "data": {},
  "msg": "ok"
}
```

- 成功：`code=0`。
- 业务失败：通常 HTTP 200 + `code=1`。
- 乐观锁：HTTP 409 + `code=-1`，`data.current` 为服务端当前记录。
- `FailError` 只暴露实现了 `SafeMessage()` 的错误消息。

例外：

- `/api/health` 是纯文本。
- OAuth 是重定向。
- `/content`、公开 reference media 是文件流。
- AI compatibility proxy 大多透传上游 status/header/body；平台预检错误可能返回平台信封。
- SSE/Canvas Agent 不在 Go 主 API 内。

通用列表参数：

```text
keyword
tag=<repeatable>
category
type
page
pageSize
```

默认 `page=1/pageSize=20`，通用上限 500。

生成任务过滤：

```text
task_type
source
status
start_time
end_time
page
pageSize
```

全部 Go 路由集中在 `router/router.go`。

## 健康、认证和公开配置

| Method / Path | Auth | 输入 | 输出/行为 | 代码 |
| --- | --- | --- | --- | --- |
| `GET /api/health` | P | 无 | 纯文本 `ok` | router 内联 |
| `POST /api/auth/register` | P | `{username,password}` | `AuthSession`；受公开注册开关约束 | `handler/auth.go` -> `service/auth.go` |
| `POST /api/auth/login` | P | `{username,password}` | `AuthSession` | auth handler/service |
| `GET /api/auth/linux-do/authorize` | P | `redirect` query | 重定向到 Linux.do OAuth | auth handler/service |
| `GET /api/auth/linux-do/callback` | P | `code/state` | 建立会话后重定向回 Web | auth handler/service |
| `GET /api/auth/me` | O | Bearer 可选 | 有效 token 返回 `AuthUser`，否则 `GuestUser` | auth handler |
| `POST /api/admin/login` | P | `{username,password}` | 仅 admin 的 `AuthSession` | auth handler |
| `GET /api/settings` | P | 无 | `PublicSetting`，不含后台密钥；`modelChannel.imageRequestFormats` 投影显式图片模型请求格式 | settings handler/service |
| `GET /api/prompts` | O | 通用 Query | `PromptList {items,tags,categories,total}` | prompts handler/service |
| `GET /api/assets` | O | 通用 Query | 路由可选认证，但 handler 实际要求用户；返回个人 `AssetList` | assets handler |
| `GET /api/media/references/:id` | P | reference ID | 原始媒体流 | `handler/media_reference.go` |
| `HEAD /api/media/references/:id` | P | reference ID | 媒体 headers | media reference handler |

## 第一方生成

| Method / Path | Auth | 输入 | 输出/行为 | 代码 |
| --- | --- | --- | --- | --- |
| `GET /api/v1/model-profiles` | U | 无 | 当前可用公开 `GenerationProfile[]` | `handler/generations.go` |
| `POST /api/v1/generations` | U | `GenerationCommand` | `FirstPartyGenerationTask`；幂等创建 queued task | generations handler -> orchestrator |
| `GET /api/v1/generations/client-requests/:id` | U | `clientRequestId` | 当前用户按幂等请求 ID 找回 first-party task；不存在或不属于当前用户时 `data=null` | generations handler -> orchestrator |
| `GET /api/v1/generations/:id` | U | task ID | 当前用户的 first-party task projection | orchestrator |
| `POST /api/v1/generations/:id/cancel` | U | task ID | 取消后的 task 或稳定操作错误 | lifecycle |
| `POST /api/v1/generations/callback?token=...` | W | <=1MB provider callback body | Adapter 校验后推进任务，返回 `true` | generations handler -> lifecycle |

`GenerationCommand` 当前支持：

```text
commandVersion=1
clientRequestId
modelProfileId
source=canvas|image_workbench|video_workbench
intent.kind=video.generate|video.short-drama
```

Canvas 与远程视频工作台提交同一份 first-party command；视频工作台短剧请求使用 title、script 和图片资产角色。local video workbench 仍使用 compatibility 视频任务路由。

结构化创建错误放在响应 `data`：

```json
{
  "code": "INVALID_SETTING",
  "retryable": false,
  "fieldPath": "intent.settings.durationSeconds",
  "resourceId": "node-or-file-id"
}
```

## AI Compatibility Proxy

以下路由要求 U，body 大体按供应商/OpenAI 兼容协议透传：

| Method / Path | 用途 | 特殊行为 |
| --- | --- | --- |
| `POST /api/v1/images/generations` | 同步图片生成 | 选后台渠道、扣费、记录 task/payload |
| `POST /api/v1/images/edits` | 同步图片编辑 multipart | 审计会移除文件正文 |
| `POST /api/v1/async/images/generations` | 异步图片生成 | 返回上游 task |
| `POST /api/v1/async/images/edits` | 异步图片编辑 | multipart/异步 task |
| `POST /api/v1/chat/completions` | OpenAI 兼容文本/工具调用 | 可流式透传 |
| `POST /api/v1/xvanai/chat/completions` | XvanAI 路由别名 | 后端映射到 chat path |
| `POST /api/v1/audio/speech` | 音频生成 | OpenAI-compatible |
| `POST /api/v1/videos` | 视频兼容入口 | 渠道路由可能改写上游 path |
| `GET /api/v1/videos/:id` | 视频状态 | query `model` 选择渠道 |
| `GET /api/v1/videos/:id/content` | 视频内容 | 透传内容 |
| `GET /api/v1/tasks/:id` | 通用异步任务状态 | query `model` |
| `POST /api/v1/tasks/:id/cancel` | 通用异步任务取消 | compatibility request |

平台在 POST 代理响应头加入：

```text
X-Generation-Task-Id: <platform task id>
```

用于前端补充 metadata。remote 模式使用平台 JWT；local 模式不调用这些路径。

## 兼容视频任务

| Method / Path | Auth | 输入 | 输出/行为 |
| --- | --- | --- | --- |
| `POST /api/v1/contents/generations/tasks` | U | Seedance/XvanAI-shaped body | 创建上游任务，保存所有权和 generation task |
| `GET /api/v1/contents/generations/tasks/:id` | U | upstream task ID，query `model` | 先校验所有权，再代理查询 |
| `DELETE /api/v1/contents/generations/tasks/:id` | U | upstream task ID | 代理取消并推进兼容生命周期 |
| `POST /api/v1/contents/generations/tasks/:id/remix` | U | remix body | 校验所有权后代理 remix |
| `POST /api/v1/generation-tasks/callback?token=...` | W | `{id,status,credits,error,content...}` | 兼容通用 callback；弱于 first-party Adapter callback |

## Reference Media

| Method / Path | Auth | 输入 | 输出/行为 |
| --- | --- | --- | --- |
| `POST /api/v1/media/references` | U | multipart `file` | `{id,url,mimeType,bytes}`；保存到 `data/reference-media` |

要求配置 `PUBLIC_BASE_URL`，因为上游需要能访问返回的公开 URL。支持受限的图片、视频和音频格式/大小。

## Generation Task 历史

| Method / Path | Auth | 输入 | 输出/行为 | 前端 |
| --- | --- | --- | --- | --- |
| `GET /api/v1/generation-tasks` | U | generation filters | 默认 `GenerationTaskList`；`task_type=image/video` 时映射专用 history DTO | `generation-tasks.ts` |
| `POST /api/v1/generation-tasks` | U | `{taskType,source,provider,model,status,credits,latencyMs,upstreamTaskId?,metadata?,requestBody,responseBody,errorMessage?}` | 前端补录任务 | generation-tasks API |
| `GET /api/v1/generation-tasks/:id` | U | `include_payload=true` 可选 | `{task,payload}`，限定当前用户 | generation-tasks API |
| `DELETE /api/v1/generation-tasks/:id` | U | task ID | 删除当前用户任务记录 | generation-tasks API |
| `POST /api/v1/generation-tasks/:id/metadata` | U | `{metadata}`，必须是 JSON 字符串 | `true` | generation-tasks API |

## 账户与个人积分

| Method / Path | Auth | 输入 | 输出 |
| --- | --- | --- | --- |
| `GET /api/v1/credit-logs` | U | `keyword/type/start_time/end_time/page/pageSize` | 当前用户 `CreditLogList` |
| `PUT /api/v1/account/profile` | U | `{displayName,email}` | 更新后的 `AuthUser` |
| `POST /api/v1/account/password` | U | `{currentPassword,newPassword}` | `true`；旧 JWT 失效 |
| `PUT /api/v1/account/enterprise` | U | `{name}` | 企业 owner 的 `EnterpriseAccountSummary` |
| `GET /api/v1/enterprise/summary` | U | 无 | 当前有效企业账号 summary |

用户名、平台角色、积分和企业身份不能通过个人资料接口修改。

积分、价格、折扣倍率和上游 credits 等十进制 JSON 字段统一使用字符串；请求也应发送十进制字符串以保留精度。

## 企业成员与积分

| Method / Path | Auth | 输入 | 输出/权限 |
| --- | --- | --- | --- |
| `GET /api/v1/enterprise/members` | U | `keyword/page/pageSize` | owner 的成员列表 |
| `GET /api/v1/enterprise/credit-logs` | U | `memberId/type/keyword/start_time/end_time/page/pageSize` | owner 的企业范围流水 |
| `POST /api/v1/enterprise/members` | U | `{username,password,displayName?,email?}` | 新 member，初始积分 0 |
| `POST /api/v1/enterprise/members/:id/status` | U | `{status:"active"|"ban"}` | 更新成员；owner only |
| `POST /api/v1/enterprise/members/:id/password` | U | `{password}` | 重置并递增 session version |
| `POST /api/v1/enterprise/members/:id/credits` | U | `{action:"allocate"|"reclaim",amount:string,requestId}`，amount 为正数 | `{requestId,action,amount,ownerCredits,member}` |

enterprise ID 永远由当前用户推导。跨企业 ID、个人用户 ID 或 owner ID 不会扩大范围。

## 企业素材与文件

| Method / Path | Auth | 输入 | 输出/权限 |
| --- | --- | --- | --- |
| `GET /api/v1/enterprise/assets` | U | `keyword/type/tag/page/pageSize` | 有效 owner/member 的 `AssetList` |
| `POST /api/v1/enterprise/assets` | U | 企业 `Asset`；媒体带 `fileId` | 新 Asset；owner only |
| `GET /api/v1/enterprise/assets/:id` | U | asset ID | 企业详情和短期 URL |
| `PUT /api/v1/enterprise/assets/:id` | U | 企业 `Asset` | 更新；owner only |
| `DELETE /api/v1/enterprise/assets/:id` | U | asset ID | `{id,deletedAt}`；owner only |
| `POST /api/v1/enterprise/assets/:id/copy` | U | asset ID | 新个人 Asset；owner/member |
| `POST /api/v1/enterprise/files` | U | multipart `fileType,file` | 新 EnterpriseFile；owner only |
| `GET /api/v1/enterprise/files/:id` | U | file ID | 元数据 + 短期 URL |
| `GET /api/v1/enterprise/files/:id/content` | U | file ID | 原始文件流 |
| `PUT /api/v1/enterprise/files/:id` | U | multipart `fileType,file` | 替换文件；owner only |
| `DELETE /api/v1/enterprise/files/:id` | U | file ID | `true`；owner only |

## Storyboard Workspace

| Method / Path | Auth | 输入 | 输出/行为 |
| --- | --- | --- | --- |
| `GET /api/v1/storyboards` | U | 无 | 当前用户的分镜项目摘要；包含 `status`、`revision`、验证状态和场景/镜头计数 |
| `POST /api/v1/storyboards` | U | workspace 字段；`directorPlan/document/validation` 可省略 | 创建完整项目详情；省略的复杂字段规范化为 JSON `null`，初始 `revision=1` |
| `GET /api/v1/storyboards/:id` | U | project ID | 当前用户的完整项目详情 |
| `PUT /api/v1/storyboards/:id` | U | workspace 字段 + 必填 `expectedRevision` | 整体 CAS 更新；成功返回完整详情和递增后的 revision |
| `DELETE /api/v1/storyboards/:id` | U | project ID | `{id,deletedAt}` |

Storyboard Workspace 的项目状态只使用 `draft | ready`：没有 Storyboard Document 时为 `draft`，存在 Document 时为 `ready`；文档校验结果继续放在 `validationStatus`，不能复用项目状态。缺少 `expectedRevision` 是请求错误；旧 revision 更新返回 HTTP 409、`code=-1`，并在 `data.current` 返回服务端最新完整详情，不做字段级自动合并。

Scene、Segment、Shot 的 `id` 是非空稳定字符串。创建时服务端不信任模型提供的 ID，会为缺失、重复或不可信 ID 生成 UUID；更新或重新生成时优先复用请求中已属于当前 artifact 的稳定 ID；缺失或不可信 ID 再按父级内的 `sceneNo -> segmentNo -> shotNo` 结构键匹配未被其他实体保留的旧 ID，新实体生成新 UUID。保存后的服务端详情是最终权威结果。

## Storyboard Brainstorm 持久化

以下路由均使用 `UserAuth`，并先以当前用户限定 Storyboard Project。Conversation 和 Message ID 由客户端提供稳定非空值；不存在与越权统一返回 HTTP 404。

| Method / Path | Auth | 输入 | 输出/行为 |
| --- | --- | --- | --- |
| `GET /api/v1/storyboards/:projectId/conversations` | U | 项目 ID | 当前项目的 Conversation 列表 |
| `POST /api/v1/storyboards/:projectId/conversations` | U | `{id,title?}` | 创建 Conversation；空标题默认为“新对话” |
| `PUT /api/v1/storyboards/:projectId/conversations/:conversationId/title` | U | `{title}` | 重命名 scoped Conversation |
| `DELETE /api/v1/storyboards/:projectId/conversations/:conversationId` | U | Conversation ID | 删除 Conversation 并清理其 Messages |
| `GET /api/v1/storyboards/:projectId/conversations/:conversationId/messages` | U | `page/pageSize` | `{conversation,items,total}`；按 `created_at ASC, id ASC` 返回平铺 Message 图 |
| `POST /api/v1/storyboards/:projectId/conversations/:conversationId/turns` | U | append 或 regenerate Turn | 原子创建 pending Assistant；append 同时创建 User Message，regenerate 保留旧 Assistant 并创建 sibling |
| `PUT /api/v1/storyboards/:projectId/conversations/:conversationId/messages/:messageId/assistant` | U | `{expectedRevision,status,output}` | 以 CAS 替换完整有序 output 数组并推进 Assistant 生命周期 |
| `POST /api/v1/storyboards/:projectId/conversations/:conversationId/messages/:messageId/continue` | U | `{clientRequestId,expectedRevision}` | 复用 terminal Assistant 的 ID/output，转回 pending 并递增 revision |
| `GET /api/v1/storyboards/:projectId/memories` | U | 项目 ID | 当前项目的 Project Memory 列表 |
| `POST /api/v1/storyboards/:projectId/memories` | U | `{id,kind,scope,path,content,tags,sourceMessageId?,operationId}` | 创建已确认 Project Memory |
| `PUT /api/v1/storyboards/:projectId/memories/:memoryId` | U | `{kind,scope,path,content,tags,sourceMessageId?,operationId}` | 更新 scoped Project Memory |
| `DELETE /api/v1/storyboards/:projectId/memories/:memoryId` | U | Memory ID | 删除 scoped Project Memory |

Turn 请求：

- append：`mode=append`、`clientRequestId`、可选 `parentMessageId`、`userMessage{id,content}`、`assistantMessageId`。首个根节点的 parent 为空；非空 parent 必须是同一 Conversation 的 Assistant。
- regenerate：`mode=regenerate`、`clientRequestId`、指向已有 Assistant 的 `targetMessageId`、`assistantMessageId`。新 Assistant 的 `parentId` 与目标 Assistant 相同。

Assistant `output` 只校验为有界 JSON 数组，并按原顺序整体保存；具体 text/tool call/tool result/status/error item 联合类型和流事件协议由后续任务定义。User Message 的正文只以 `content` 为准，Assistant 正文只以 `output` 为准。active 状态为 `pending/streaming/awaiting_approval`，terminal 状态为 `completed/failed/cancelled/interrupted`。

同一 Conversation 同时只能存在一个 active Turn；同一 `clientRequestId` 的相同语义输入幂等返回已有结果，不同语义复用返回 HTTP 409。旧 Message revision、非法生命周期转换和 active Turn 冲突也返回 409，存在当前 Message 时放在 `data.current`。Memory 的 `scope` 为 `project/scene/shot`：project 要求空 path，scene/shot 要求稳定实体 ID path；`operationId` 在当前用户和项目内唯一。没有单独的 active Conversation 切换接口。

当前接口只提供持久化与并发边界，不执行模型调用，也不表示 Summary、Context Builder、Tool Executor、Brainstorm UI、Canvas 集成或真实浏览器验证已完成。

## Canvas 与增量同步

| Method / Path | Auth | 输入 | 输出 |
| --- | --- | --- | --- |
| `GET /api/v1/canvas/projects` | U | 无 | 简化列表 `{id,name,version,createdAt,updatedAt}[]` |
| `POST /api/v1/canvas/projects` | U | `{name,project}`；也兼容完整 project JSON | 完整 `CanvasProject` |
| `GET /api/v1/canvas/projects/:id` | U | project ID | 含 `projectJson/revision` 的完整记录 |
| `PUT /api/v1/canvas/projects/:id` | U | `{project,expectedRevision}` | 新 revision；冲突 HTTP 409 + current |
| `DELETE /api/v1/canvas/projects/:id` | U | project ID | `{id,deletedAt}` |
| `GET /api/v1/sync` | U | `cursor?&canvasCursor?&domains=assets,canvas,tasks` | 全局 cursor + 三个 domain 的 updates/deletes |

Canvas 客户端必须把服务端缺少记录和明确 delete tombstone 区分开。

## 个人素材

| Method / Path | Auth | 输入 | 输出 |
| --- | --- | --- | --- |
| `GET /api/v1/assets` | U | 通用 Query | 当前用户个人 `AssetList` |
| `POST /api/v1/assets` | U | `Asset + expectedUpdatedAt` | 新/更新 Asset；冲突 409 + current |
| `DELETE /api/v1/assets/:id` | U | asset ID | `{id,deletedAt}` |

同一 POST 同时承担 create/update；是否有 ID 和 `expectedUpdatedAt` 决定语义。

## 个人文件

| Method / Path | Auth | 输入 | 输出/行为 |
| --- | --- | --- | --- |
| `POST /api/v1/files/upload-url` | U | `{fileType,fileName,mimeType}` | 预签名 PUT 信息 |
| `POST /api/v1/files/confirm` | U | confirm JSON；由 service 解析 | 写入并返回 `UserFile` |
| `POST /api/v1/files` | U | multipart `fileType,file`，最大请求 80MB | 服务端上传 S3，返回 `UserFile` |
| `POST /api/v1/files/proxy-upload` | U | `{url,fileType,fileName}` | 后端下载 URL 后上传 S3 |
| `GET /api/v1/files` | U | `fileType/page/pageSize` | `{items,total}`，每项带短期 URL |
| `GET /api/v1/files/:id` | U | file ID | `UserFile` + 短期 URL |
| `GET /api/v1/files/:id/content` | U | file ID | 原始文件流 |
| `DELETE /api/v1/files/:id` | U | file ID | 删除对象和记录，返回 `true` |

## 管理员企业

| Method / Path | Auth | 输入 | 输出 |
| --- | --- | --- | --- |
| `GET /api/admin/enterprises` | A | `keyword/page/pageSize` | `EnterpriseList` |
| `POST /api/admin/enterprises` | A | `{name,ownerUsername,ownerPassword,ownerDisplayName?}` | `EnterpriseView` |
| `POST /api/admin/enterprises/:id/status` | A | `{status}` | `EnterpriseView` |
| `POST /api/admin/enterprises/:id/discount-rate` | A | `{discountRate}` | `EnterpriseView` |
| `POST /api/admin/enterprises/:id/owner/status` | A | `{status}` | `EnterpriseView` |
| `POST /api/admin/enterprises/:id/owner/password` | A | `{password}` | `EnterpriseView` |
| `POST /api/admin/enterprises/:id/credits` | A | `{delta,reason}` | 调整后的 `EnterpriseView` |

## 管理员用户与流水

| Method / Path | Auth | 输入 | 输出 |
| --- | --- | --- | --- |
| `GET /api/admin/users` | A | `keyword/type/page/pageSize` | `UserList` |
| `POST /api/admin/users` | A | `Partial<User> + password?` | 新/更新 User |
| `POST /api/admin/users/:id/credits` | A | `{credits}` 最终余额 | 更新 User；企业 owner 不走此接口 |
| `DELETE /api/admin/users/:id` | A | user ID | `true` |
| `GET /api/admin/credit-logs` | A | `keyword/type/start_time/end_time/page/pageSize` | 全局积分流水；每条附带当前用户 `username` |
| `POST /api/admin/credit-logs` | A | `CreditLog` | 保存后的流水 |
| `DELETE /api/admin/credit-logs/:id` | A | log ID | `true` |

## 管理员设置与渠道

| Method / Path | Auth | 输入 | 输出 |
| --- | --- | --- | --- |
| `GET /api/admin/settings` | A | 无 | `Settings`；密钥值被遮盖 |
| `POST /api/admin/settings` | A | 完整 `Settings` | 归一化后的 `Settings` |
| `POST /api/admin/settings/channel-models` | A | `{index?,channel,model?}` | 模型名数组 |
| `POST /api/admin/settings/channel-test` | A | `{index?,channel,model}` | 测试结果字符串 |

`index` 指已保存渠道；也可提交临时 `channel`。保存空密钥时 service 会尝试保留旧密钥。

公开设置中的 `modelChannel.imageRequestFormats` 为 `{model,format}[]`，`format` 当前只接受 `application/json` 和 `multipart/form-data`。未列出的模型由前端图片请求层保持各操作原有默认格式。

## 管理员提示词

| Method / Path | Auth | 输入 | 输出 |
| --- | --- | --- | --- |
| `GET /api/admin/prompt-categories` | A | 无 | 内置 `PromptCategory[]` |
| `POST /api/admin/prompt-categories/sync` | A | `{category}` | 更新后的分类列表 |
| `GET /api/admin/prompts` | A | 通用 Query | `PromptList` |
| `POST /api/admin/prompts` | A | `Partial<Prompt>` | 新/更新 Prompt |
| `POST /api/admin/prompts/batch-delete` | A | `{ids}` | `true` |
| `DELETE /api/admin/prompts/:id` | A | prompt ID | `true` |

## 管理员素材

| Method / Path | Auth | 输入 | 输出 |
| --- | --- | --- | --- |
| `GET /api/admin/assets` | A | 通用 Query | 跨用户/全局 AssetList 视图 |
| `POST /api/admin/assets` | A | `Asset` | 新/更新 Asset |
| `POST /api/admin/assets/upload-image` | A | multipart `file`，最大 30MB | `{url}` |
| `DELETE /api/admin/assets/:id` | A | asset ID | `true` |

管理员素材使用空 user scope 的旧模式，与个人/企业素材边界不同，修改时要先确认真实产品语义。

## 管理员生成任务

| Method / Path | Auth | 输入 | 输出 |
| --- | --- | --- | --- |
| `GET /api/admin/generation-tasks` | A | `user_id/task_type/source/status/start_time/end_time/page/pageSize` | 带 username 的任务列表 |
| `GET /api/admin/generation-tasks/:id` | A | `include_payload=true` 可选 | `{task,payload}` |
| `DELETE /api/admin/generation-tasks/:id` | A | task ID | `true` |
| `POST /api/admin/generation-tasks/batch-delete` | A | `{ids}` | `{deleted}` |

## API 修改检查清单

1. `router/router.go` method/path/auth group。
2. handler 只解析输入和输出。
3. service 负责权限、默认值和校验。
4. repository 负责查询/事务。
5. 前端 API 函数放 `web/src/services/api/`。
6. 更新 TS/Go DTO。
7. 对文件流、SSE、multipart 和 compatibility response 使用正确 client，不要强行套普通 JSON helper。
8. 涉及冲突时保留 HTTP 409 和 `ApiError.data.current`。
9. 涉及业务错误时决定是否实现 `SafeMessage/FailureData`。
10. 更新本文件和正式 API 文档。
