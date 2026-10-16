# 后端模块

后端遵循 Go + Gin + GORM 的四层结构。模块之间通过包级函数直接调用，没有接口容器或运行时注册表；修改时优先沿用现有具体实现。

## HTTP 路由与鉴权

- **职责**：注册全部 `/api` 路由；区分公开、可选认证、用户认证、管理员认证和外部回调。
- **输入**：HTTP method/path、Bearer JWT、回调 token。
- **输出**：Gin handler 调用、认证后的 `model.AuthUser` request context、404 JSON。
- **核心文件**：`router/router.go`、`middleware/admin.go`、`service/context.go`。
- 管理员外部接口为 `/api/v1/admin/*`，由 `AdminKeyAuth` 仅验证 `X-Admin-Key`；签发管理员和关联企业必须当前有效。JWT 只用于后台 `/api/admin/settings/admin-key` 生成/状态/撤销管理，Key 不能代替后台登录或用户生成权限。
- **数据流**：`Authorization` -> `service.CurrentAuthUser` -> 查询当前用户/企业状态 -> `service.WithUser` -> handler。
- **依赖关系**：依赖 auth service 和统一 response；所有业务模块依赖它暴露入口。
- **常见修改位置**：
  - 新增 API：`router/router.go` + 对应 handler。
  - 修改平台角色规则：`middleware/admin.go`。
  - 修改 token 有效性、企业/用户禁用语义：`service/auth.go`。
- **约束**：前端 route guard 只是 UX，后端 middleware 才是权限边界。

## Handler 与响应信封

- **职责**：解析 JSON、multipart、query/path 参数，调用 service，返回 `OK/Fail/FailError/Conflict`。
- **输入**：`http.Request`、service 返回值或错误。
- **输出**：通常为 `{code,data,msg}`。
- **核心文件**：`handler/response.go`、`handler/*.go`。
- **数据流**：HTTP 输入 -> 小型 request struct/model -> service -> response。
- **依赖关系**：依赖 model DTO 和 service；不应承载业务权限、ID、时间或事务。
- **常见修改位置**：
  - 新请求字段：对应 handler request struct。
  - 结构化业务错误：service 实现 `SafeMessage()` / `FailureData()`。
  - 乐观锁：`handler.Conflict`，HTTP 409 + `code=-1`。
- **例外**：
  - `handler/media_reference.go` 直接读写 `data/reference-media`。
  - `handler/task_callback.go` 有直接 repository 访问。
  - 健康检查、OAuth 重定向、媒体/文件流和兼容 AI 代理不使用标准信封。

## 认证、账户与个人积分

- **职责**：默认管理员、注册、登录、Linux.do OAuth、JWT、当前用户、资料/密码、用户管理、个人积分和流水。
- **输入**：用户名/密码、OAuth code/state、JWT、资料字段、管理员积分值。
- **输出**：`AuthSession`、`AuthUser`、用户列表、`CreditLogList`。
- **核心文件**：`handler/auth.go`、`service/auth.go`、`repository/user.go`、`repository/credit_log.go`、`model/user.go`。
- **数据流**：
  - 登录：handler -> `service.Login` -> user repository -> bcrypt -> JWT。
  - 鉴权：JWT claims -> 当前 DB user -> session/version/status/enterprise 校验。
  - 积分：service 决定语义 -> repository 锁用户并更新余额/流水。
- **依赖关系**：被 middleware、generation、enterprise、sync 和文件模块依赖。
- **常见修改位置**：
  - 会话字段和失效规则：`service/auth.go`、`model/user.go`。
  - 余额原子性：`repository/user.go`。
  - 公开用户投影：`service.publicUser` / `model.AuthUser`。
  - 前端合同：`web/src/services/api/auth.ts`。
- **关键不变量**：
  - `users.credits >= 0`。
  - 修改或重置密码递增 `session_version`。
  - 登录、自助资料/密码、企业成员状态/密码更新仅写显式字段，并以读取时账号安全字段作 CAS；目标已删除或状态变更时失败，不得用旧快照重建账号或恢复管理员已收回的权限。
  - 已禁用用户或企业必须立即失效，而不是只禁止新登录。

## 企业、成员与企业积分

- **职责**：企业创建、owner 身份、成员管理、企业状态、折扣倍率、owner/member 积分划拨和企业范围流水。
- **输入**：当前认证用户、企业/成员 ID、状态、密码、`{action,amount,requestId}`、管理员 `{delta,reason}`。
- **输出**：`EnterpriseView`、`EnterpriseAccountSummary`、成员列表、双边积分结果和流水。
- **核心文件**：`handler/enterprise.go`、`service/enterprise.go`、`repository/enterprise.go`、`model/enterprise.go`、`model/user.go`。
- **数据流**：
  - 服务端从当前用户推导 enterprise，不接受客户端切换企业。
  - owner/member 划拨在一个事务中锁定双方用户，更新两个余额并写两条共享 request ID 的流水。
  - 管理员调整 owner 余额时，目标余额和 `admin_adjust` 流水同事务。
- **依赖关系**：依赖 auth、credit logs；生成计费读取企业折扣；企业素材读取企业身份。
- **常见修改位置**：
  - 角色和权限：`service/enterprise.go`。
  - 锁、幂等和事务：`repository/enterprise.go`。
  - 后台接口：`handler/enterprise.go`、`web/src/services/api/admin.ts`。
  - 账户页企业功能：`web/src/services/api/auth.ts`。
- **关键不变量**：
  - 一个企业只有一个 owner。
  - owner/member 的平台角色仍是普通 `user`，不是平台管理员。
  - 企业范围只能来自当前身份。
  - 相同账号、类型和 `requestId` 的划拨只能生效一次。

## 设置、模型渠道与价格

- **职责**：公开/私有设置、渠道密钥、模型列表、默认模型、价格、Generation Profile 绑定、文件限制、OAuth Secret 和 prompt cron。
- **输入**：管理员设置 JSON、渠道模型查询/测试、模型名。
- **输出**：普通用户可见的 `PublicSetting`、管理员 `Settings`、选中的 `ModelChannel`、模型积分价格。
- **核心文件**：`handler/settings.go`、`service/settings.go`、`service/channel.go`、`service/channel_admin.go`、`repository/setting.go`、`model/setting.go`。
- **数据流**：
  - `settings` 表约定只有 `public/private` 两行 JSON。
  - 普通读取隐藏 private 设置。
  - 管理员读取也会遮盖 API Key；保存空密钥时保留旧值。
  - 兼容代理按 model 选择启用渠道；第一方生成按 Profile binding 快照 route。
- **依赖关系**：generation、auth 注册开关、Linux.do、文件上传限制和 prompt scheduler 都依赖设置。
- **常见修改位置**：
  - 新设置字段：`model/setting.go` -> normalize/default -> handler -> 前端类型和表单。
  - 新渠道协议：`service/channel.go`、`service/ai_proxy.go`，必要时 admin test。
  - 新第一方模型：`service/generation_profiles.go` + private binding + public cost。
- **关键不变量**：不能向公开 API 返回后台渠道 Key 或 OAuth Secret。

## 提示词目录

- **职责**：提示词分页、标签/分类筛选、管理员 CRUD、第三方 GitHub 分类抓取和定时整类替换。
- **输入**：`model.Query`、管理员 Prompt、分类 code、远程 JSON/Markdown。
- **输出**：`PromptList`、内置分类列表、同步后的分类内容。
- **核心文件**：`handler/prompts.go`、`handler/admin.go`、`service/prompts.go`、`service/prompt_fetch.go`、`service/prompt_sync_scheduler.go`、`repository/prompt.go`。
- **数据流**：HTTP/cron -> parser -> `ReplacePromptCategory` transaction -> `prompts`。
- **依赖关系**：依赖 settings 中的 cron；Web 多个页面共享 `/api/prompts`。
- **常见修改位置**：
  - 增减远程源：`repository/db.go` 的 `promptCategories`。
  - 新仓库格式：`service/prompt_fetch.go`。
  - 查询字段/标签语义：`repository/prompt.go`。
  - 调度：`service/prompt_sync_scheduler.go`。
- **关键不变量**：远程同步按分类整体替换；解析失败时不要先删除已有分类。

## 个人素材与个人文件

- **职责**：个人文本/图片/视频素材 CRUD；S3 上传、签名、下载、代理抓取和文件删除。
- **输入**：素材 DTO、`expectedUpdatedAt`、multipart 文件、远程 URL、file type。
- **输出**：`AssetList`、`Asset`、`UserFile`、预签名 URL 或文件流。
- **核心文件**：`handler/assets.go`、`handler/user_file.go`、`service/assets.go`、`service/user_file.go`、`service/s3.go`、`repository/asset.go`、`repository/user_file.go`、`model/asset.go`、`model/user_file.go`。
- **数据流**：
  - 媒体：浏览器 -> `/files` -> S3 + `user_files` -> `/assets` 保存 `fileId`。
  - 读取：asset -> `user_files.s3_key` -> 短期预签名 `url`。
  - 更新：`expectedUpdatedAt` 乐观锁；冲突返回服务端 current。
- **依赖关系**：依赖 auth；generation 的输入和结果依赖 files；Canvas/工作台依赖 assets。
- **常见修改位置**：
  - 素材字段和筛选：model/repository/service + `web/src/stores/use-asset-store.ts` 转换。
  - 文件类型/大小：`service/user_file.go`、settings file limits。
  - S3 endpoint/signature：`service/s3.go`。
- **关键不变量**：
  - 个人查询必须 `enterprise_id IS NULL`。
  - API 不返回 `S3Key`。
  - 长期引用使用 `fileId`，预签名 URL 只是临时展示值。

## 企业素材与企业文件

- **职责**：企业共享素材、企业媒体权限、owner 写/member 读、复制到个人素材。
- **输入**：当前企业身份、素材/file ID、multipart 文件。
- **输出**：企业 `AssetList`、短期 URL、个人副本。
- **核心文件**：`handler/assets.go`、`handler/user_file.go`、`service/assets.go`、`service/user_file.go`、`repository/asset.go`、`repository/user_file.go`。
- **数据流**：
  - 企业范围由当前用户推导。
  - 媒体素材引用 `enterprise_id` 非空的 `user_files`。
  - 复制媒体时 S3 对象复制为新的个人对象，再事务写个人 file + asset。
- **依赖关系**：依赖 enterprise 状态/角色、S3、个人 assets/files。
- **常见修改位置**：
  - owner/member 权限：service。
  - 企业范围 SQL：repository。
  - 复制补偿清理：`service.CopyEnterpriseAsset`。
  - 前端：`web/src/pages/enterprise-assets/`、`web/src/services/api/enterprise-assets.ts`。
- **关键不变量**：
  - 企业素材不进入个人 Zustand store、个人 REST delta sync 或 WebDAV。
  - 复制后个人副本拥有新的 asset/file ID，源删除不能破坏副本。

## Storyboard Workspace 与 Brainstorm 持久化

- **职责**：持久化可变 Storyboard Project 聚合根、私有 JSON artifact，以及独立 Brainstorm Workspace 的 Conversation/Message 图、Brainstorm Memory、revision CAS 和删除清理。独立脑暴不要求或创建真实 Storyboard Project。
- **输入**：当前用户、Brainstorm scope、兼容保留的 `project_id` 查询维度、workspace 字段、Conversation/Turn/Assistant/Memory 命令及各自的 `expectedRevision`、`clientRequestId` 或 `operationId`。
- **输出**：Storyboard 摘要/详情、分页 Conversation/Brainstorm Memory 列表、平铺分页 Message 图、Turn 创建结果和 Assistant 当前版本。冲突返回 HTTP 409，存在当前记录时放在 `data.current`。
- **核心文件**：Workspace 使用 `handler/storyboard_projects.go`、`service/storyboard_project.go`、`repository/storyboard_project.go`、`model/storyboard_project.go`；Brainstorm 使用同层级的 `storyboard_brainstorm.go` 文件并在 `router/router.go` 注册认证路由。
- **数据流**：
  - Workspace create/update 继续负责 artifact 规范化、稳定 Scene/Segment/Shot ID、S3 补偿和项目级 CAS。
  - append Turn 在锁定 Conversation 的单个数据库事务中创建 User Message 与 pending Assistant Placeholder，并更新 `currentMessageId`；相同 Message ID 的同语义重放返回原 Turn；regenerate 创建同一 User Message 下的新 Assistant sibling，保留旧 Assistant。
  - Assistant 更新以 `expectedRevision` 替换完整有序 output JSON 并推进生命周期；continue 对原 terminal Assistant 做 CAS，保留 ID/output 后重置为 pending，不创建 sibling。
  - Brainstorm Memory 只保存已确认记录；旧 project 模式的 scope/path、tags、`sourceMessageId` 和 `operationId` 由 service 校验，独立脑暴不借此建立 Storyboard 实体关联。
- **依赖关系**：Storyboard Workspace 依赖 auth、PostgreSQL、S3 和个人 `user_files`；独立 Brainstorm Workspace 复用认证数据库持久化，但不依赖真实 Storyboard Project。模型调用、独立脑暴 UI 和 Canvas 集成由上层负责。
- **模型与计费边界**：Brainstorm 模型调用不在本模块维护独立配置或扣费；上层 Runtime 读取管理员公开文本模型配置后强制进入现有 compatibility proxy，由生成平台按渠道、`modelCosts`、`generation_tasks`、`generation_payloads` 和 `credit_logs` 统一处理，Token usage 写入现有任务 `metadata.usage`。
- **关键不变量**：
  - status 只使用 `draft/ready`，validation outcome 继续保存在 `validationStatus`。
  - Project ID、`createdAt` 和已匹配实体 ID 在保存/重新生成后保持稳定；Workspace 更新是整体 CAS，不做字段级 merge。
  - 独立 Brainstorm 子资源按当前用户、保留的 `__brainstorm__` scope 和旧 `project_id` 查询维度作为隔离键，Message 额外限定 `conversation_id`；这些键不对应真实 Storyboard Project，越权与不存在都返回 404。旧 project 模式仍兼容真实项目 scope。
  - 同一 Conversation 最多一个 active Assistant Turn，不同 Conversation 可并行；删除 Conversation 使用同一行锁，删除 Project 先锁 Project 与全部 Conversation 后再清理，避免并发写入留下孤儿记录；数据库事务不跨越模型或浏览器流式处理。
  - 持久化层不负责模型调用或浏览器流式处理；独立入口只允许 Brainstorm Memory 工具，不提供 Storyboard 读取/修改或自动写回。Canvas 关联和真实浏览器验证仍是独立事项。

## Canvas 项目与增量同步

- **职责**：持久化完整 `project_json`、revision CAS、项目删除 tombstone、assets/canvas/tasks delta sync。
- **输入**：用户 ID、前端项目 ID、项目 JSON、`expectedRevision`、cursor/domains。
- **输出**：`CanvasProject`、HTTP 409 current、`SyncResponse`。
- **核心文件**：`handler/canvas_projects.go`、`handler/sync.go`、`service/canvas_service.go`、`service/sync_service.go`、`repository/canvas_project.go`、`repository/sync.go`、`repository/deleted_record.go`、`model/canvas_project.go`。
- **数据流**：
  - create 使用前端 ID。
  - update 使用 `id + user_id + expectedRevision` CAS，成功分配新的全局 revision。
  - delete 和 Canvas tombstone 同事务。
  - `/sync` 中 Canvas 通过 revision cursor，assets/tasks 通过时间 cursor。
- **依赖关系**：依赖 auth；前端 Canvas Replica 和 sync scheduler 消费它。
- **常见修改位置**：
  - 项目结构通常只改前端 JSON；服务端仍是 opaque text。
  - 并发/删除语义：canvas repository 和 sync service。
  - 新同步域：sync model/service/repository + frontend `sync-client.ts` callback。
- **关键不变量**：服务端 response 缺少项目不能被解释为删除；删除必须来自 tombstone。

## 生成平台与任务历史

- **职责**：兼容代理、第一方 Generation Run、统一任务表、payload/event 审计、任务列表和管理员详情。
- **输入**：兼容供应商 body 或 `GenerationCommand`、当前用户、Model Profile、渠道设置。
- **输出**：上游兼容响应、`FirstPartyGenerationTask`、Generation History DTO、积分流水、平台文件。
- **核心文件**：详见 [generation.md](generation.md)；HTTP 入口在 `handler/generations.go`、`handler/generation_tasks.go`、`handler/video_tasks.go`。
- **数据流**：HTTP -> 校验/渠道/计费 -> `generation_tasks` -> worker/上游 -> S3 -> 终态。
- **依赖关系**：依赖 auth、settings/channels、assets/files、credits、sync。
- **常见修改位置**：
  - 第一方合同/Profile/Adapter：generation service/model。
  - 历史列表：`service/generation_mapper.go`、handler、前端 `generation-tasks.ts`。
  - 审计脱敏：`service/ai_proxy.go`、generation lifecycle/payload repository。

## 后台任务

- **职责**：提示词 cron、payload TTL 清理、Generation Run claim/lease/恢复。
- **输入**：数据库设置、当前时间、queued/running 任务。
- **输出**：同步后的 prompts、删除的旧 payload、推进后的任务状态。
- **核心文件**：`service/prompt_sync_scheduler.go`、`service/payload_cleanup.go`、`service/generation_worker.go`。
- **数据流**：`main.go` 启动 goroutine/cron -> repository。
- **依赖关系**：依赖数据库；generation worker 依赖 Profile、Channel 和 Adapter。
- **常见修改位置**：
  - 调度频率：scheduler/job 文件。
  - payload 保留期：`service/payload_cleanup.go`。
  - worker 并发/租约：`service/generation_worker.go`、`repository/generation_queue.go`。
- **约束**：当前没有统一 worker manager；新增后台任务前先判断是否可复用现有 cron 或数据库队列。

## 管理后台 API

管理员路由不是独立业务域，而是上述模块的管理投影：

- 用户/积分：auth 模块。
- 企业：enterprise 模块。
- 设置/渠道：settings 模块。
- 提示词：prompt 模块。
- 素材：asset/file 模块。
- 生成任务：generation history。

新增后台页面通常需要同时改 `router/router.go`、对应 handler/service、`web/src/services/api/admin.ts` 和页面私有 React Query hook。
