# 前端模块

## 启动、Providers 与路由

- **职责**：挂载 React、主题、Ant Design、Query Client、路由和全局生命周期。
- **输入**：DOM root、当前 route、浏览器持久化状态。
- **输出**：用户/管理员页面树、全局消息和 Query cache。
- **核心文件**：`web/src/main.tsx`、`web/src/router.tsx`、`web/src/components/layout/app-providers.tsx`、`web/src/components/layout/client-root-init.tsx`。
- **数据流**：main -> providers -> router -> `ClientRootInit` -> auth/settings/sync monitors。
- **依赖关系**：所有页面依赖；`ClientRootInit` 依赖 user/config/asset stores 和 sync services。
- **常见修改位置**：
  - 新页面：`web/src/router.tsx`。
  - 全局主题/Query 行为：`app-providers.tsx`。
  - 全局启动副作用：`client-root-init.tsx`。
- **约束**：当前是显式 React Router，不是文件系统 App Router；`"use client"` 在 Vite 中没有运行语义。

## 布局与访问控制

- **职责**：用户导航、管理员导航、登录/角色重定向和移动端入口。
- **输入**：`useUserStore` 的 token/user/isReady、route。
- **输出**：`UserLayout` 或 `AdminLayout` 页面框架。
- **核心文件**：`web/src/layouts/user-layout.tsx`、`web/src/layouts/admin-layout.tsx`、`web/src/components/layout/`。
- **数据流**：持久化 token -> `hydrateUser` -> layout guard -> page。
- **依赖关系**：依赖 auth store；企业导航还依赖 `enterpriseRole/status`。
- **常见修改位置**：
  - 导航项：layout/top-nav/mobile drawer。
  - 客户端角色判断：layout。
  - 真正权限：后端 middleware/service，而不是这里。

## 用户会话与 Account Data Boundary

- **职责**：保存 JWT/用户快照，冷启动校验，清理跨账号状态，监控失效会话。
- **输入**：登录/注册响应、`/api/auth/me`、当前用户 ID。
- **输出**：`token/user/isReady`，账户切换事件和受保护数据可见性。
- **核心文件**：`web/src/stores/use-user-store.ts`、`web/src/lib/account-storage.ts`、`web/src/services/session-monitor.ts`、`web/src/services/credit-balance-sync.ts`。
- **数据流**：login -> persist -> rehydrate -> fetch current user -> account-scoped stores。
- **依赖关系**：Canvas、素材、sync cursor、工作台日志和 Query Client 都以用户 ID 隔离。
- **常见修改位置**：
  - 用户字段：auth API type + user store + layouts/account。
  - 切换账号清理：各 store 的 user subscription 和 `account-storage.ts`。
- **关键不变量**：异步请求返回前必须确认仍是同一个 `{token,userId}`，避免把旧账号数据写入新会话。

## AI 配置与模型选择

- **职责**：本地渠道、API Key、调用格式、可选模型、默认模型、生成偏好和 WebDAV 配置。
- **输入**：用户设置、公开服务端 settings、URL `baseUrl/apiKey` 参数。
- **输出**：`AiConfig`、`ModelChannel`、当前模型请求配置。
- **核心文件**：`web/src/stores/use-config-store.ts`、`web/src/components/layout/app-config-modal.tsx`、`web/src/components/model-picker.tsx`。
- **数据流**：
  - local 模式：browser channel -> 直接上游。
  - remote 模式：public settings -> 平台模型选择 -> `/api/v1/*`。
- **依赖关系**：图片/视频/音频/文本工作台、Canvas 生成和助手都依赖。
- **常见修改位置**：
  - 新配置字段：store type/default/normalize + modal + 生成请求。
  - 新 protocol：store normalize + API request builder + 后端 remote channel。
- **约束**：用户 API Key 是浏览器级配置，不按账号自动分区；安全文档必须明确这一点。

## API 请求层

- **职责**：统一 JSON API 的 query、Bearer Token、响应信封解包和 `ApiError`。
- **输入**：URL、params/body、可选 token。
- **输出**：`data` 或带 HTTP status/业务 data 的异常。
- **核心文件**：`web/src/services/api/request.ts`、`web/src/services/api/*.ts`。
- **数据流**：page/store -> typed API function -> axios/fetch -> `{code,data,msg}` -> caller。
- **依赖关系**：所有远程业务。
- **常见修改位置**：
  - 普通 JSON endpoint：对应 `services/api/` 文件。
  - 文件/流式/SSE：使用 fetch 的专用实现，不强行塞进 `apiRequest`。
- **约束**：业务失败可能是 HTTP 200，必须检查 `payload.code`。

## Storyboard Workspace

- **职责**：把模型生成结果规范化为可编辑 Storyboard Workspace，并通过认证 API 创建、恢复、更新和删除项目。
- **输入**：原始剧本、生成选项、模型输出、已加载项目的 Project ID/revision。
- **输出**：带稳定 Scene/Segment/Shot ID、`status/revision` 的工作区和服务端摘要列表。
- **核心文件**：`web/src/pages/storyboard/storyboard.ts`、`storyboard-storage.ts`、`storyboard-studio.tsx`、`web/src/services/api/storyboards.ts`。
- **数据流**：模型输出 -> pipeline 规范化 -> storage facade；新工作区使用 POST，已加载工作区保存或重新生成使用当前 revision 的 PUT -> 服务端完整详情覆盖本地保存态。
- **依赖关系**：依赖 user store、JSON API request 层和 Storyboard 后端；不进入 Canvas store、REST delta sync 或 WebDAV manifest。
- **关键不变量**：
  - 未保存输出也会生成非空 ID；编辑或重新生成时优先保留当前 Document 已有 ID，缺失或不可信 ID 再按 `sceneNo/segmentNo/shotNo` 匹配未被其他实体保留的旧 ID，新实体生成新 UUID。
  - 服务端保存详情是权威结果；成功保存保留 Project ID 和原 `createdAt`，并采用返回的新 revision。
  - stale revision 由 `ApiError.data.current` 暴露，不在客户端静默覆盖或自动字段合并。
  - Brainstorm Core 已提供纯 `Context Builder -> Turn Runner` 合同：最终预算同时计算固定 System、代码内 Skill、分镜焦点、Memory、Summary、历史和 Tool Schema；Tool Pair 按 `callId` 原子清理，Runner 通过可注入 Completion/Executor 测试四轮 Tool Loop、审批续跑与首输出前单次重试。
  - Brainstorm 前端已提供认证 API Client 和页面私有 `useBrainstormAgent`：完整分页恢复 Conversation/Message，服务端确认 User/Assistant Placeholder 后才启动浏览器 Runtime；不同 Conversation 可独立运行，Tool 边界与终态使用 revision CAS 持久化，刷新遗留 active Message 转为 interrupted，审批先 CAS 占用后续跑。
  - Brainstorm Context 已提供 Project/Scene/Shot Memory 选择、分支级 Summary Checkpoint、长历史压缩和可读预算诊断；未确认或无关 Memory 不进入请求，Summary 只在 User Turn 边界切分，Tool Call/Result 保持原子。
  - Brainstorm Storyboard Tools 已提供十项白名单 Registry、审批前影响预览和注入式 Executor：只读查询自动执行，Apply/Remember/Forget 由 Core Runner 审批，Project/Scene/Segment/Shot 使用固定作用域、稳定 ID 和 revision CAS；结果按字节限长并作为不可信 Tool Result 回注。
  - 当前仍未接入真实模型 Transport、最终页面 UI 或 Canvas 关联；不要把 Core、状态 Hook、Context 与 Tool Executor 视为完整 Brainstorm 功能。

## 个人素材 Store

- **职责**：个人素材的账户隔离缓存、CRUD、服务端刷新和过期文件 URL 更新。
- **输入**：用户新增/编辑/删除、REST delta、`fileId`。
- **输出**：`Asset[]`、Canvas 可插入 payload、服务端素材写入。
- **核心文件**：`web/src/stores/use-asset-store.ts`、`web/src/services/api/assets.ts`、`web/src/pages/assets/`、`web/src/pages/canvas/components/asset-picker*.ts*`。
- **数据流**：UI -> API 成功 -> Zustand/IndexedDB；后台 `/sync` -> delta callback -> store。
- **依赖关系**：依赖 user store、API、file URL resolver、sync scheduler。
- **常见修改位置**：
  - 前后端字段映射：store 的 `toLocalAsset/fromLocalAsset`。
  - 页面筛选/编辑：`web/src/pages/assets/`。
  - Canvas 插入：asset picker。
- **约束**：
  - 个人素材的服务器写路径优先；网络失败不能只在本地伪成功。
  - `cleanupImages` 当前是空实现，不能假设删除素材会回收 IndexedDB Blob。

## 浏览器 Blob 与平台文件

- **职责**：保存本地图片/视频/音频 Blob，创建 `blob:` URL；上传平台文件并刷新 S3 预签名 URL。
- **输入**：Blob、data URL、远程结果 URL、`storageKey/fileId`。
- **输出**：`StoredImage/StoredFile`、平台 `UploadResult`、展示 URL。
- **核心文件**：`web/src/services/blob-storage.ts`、`web/src/services/upload-blob.ts`、`web/src/services/resolve-file-urls.ts`。
- **数据流**：
  - 本地：Blob -> localforage -> `storageKey` -> object URL。
  - 平台：Blob/URL -> `/api/v1/files*` -> S3 -> `fileId` + presigned URL。
- **依赖关系**：Canvas、素材、图片/视频工作台、WebDAV/ZIP。
- **常见修改位置**：
  - 新媒体类型或元数据：blob storage + upload result + backend file type。
  - URL 过期处理：`resolve-file-urls.ts` 和使用方。
- **关键不变量**：`blob:` 和预签名 URL 都不是长期标识；长期使用 `storageKey` 或 `fileId`。

## REST Delta Sync

- **职责**：按用户 cursor 拉取 `assets/canvas/tasks` 更新与删除，并按生命周期调度。
- **输入**：用户 ID、JWT、cursor、domain。
- **输出**：store delta callback、持久化 cursor。
- **核心文件**：`web/src/services/sync-client.ts`、`web/src/services/sync-scheduler.ts`、各 store 的 `registerSyncDeltaHandler`。
- **数据流**：页面启动/Tab 可见/定时器 -> `/api/v1/sync` -> session guard -> domain callback -> cursor。
- **依赖关系**：user store、Canvas/asset/task consumers。
- **常见修改位置**：
  - 新 domain：client type、server sync、callback 和 scheduler。
  - 轮询策略：`sync-scheduler.ts`。
- **约束**：
  - Canvas 使用独立 revision cursor，因为 dirty 项目可能拒绝 delta。
  - 活跃编辑两分钟内暂停定时轮询。
  - `SyncAdapter` 当前只是契约文件，不要假设 REST/WebDAV 已通过该接口统一装配。

## WebDAV 全快照同步

- **职责**：用户手动合并 Canvas、个人素材、图片工作台和视频工作台数据及媒体文件。
- **输入**：WebDAV URL/账号/目录、四个本地域。
- **输出**：远端 manifest、媒体文件、本地合并结果和进度。
- **核心文件**：`web/src/services/app-sync.ts`、`web/src/services/webdav-sync.ts`、配置弹窗。
- **数据流**：读取本地 + 下载远端 -> 按 ID/时间合并 -> 下载缺失媒体 -> 应用本地 -> 上传新增媒体和 manifest。
- **依赖关系**：Canvas/asset stores、account-bound workbench log stores、blob storage。
- **常见修改位置**：
  - 新同步域：`AppSyncDomainKey` 和 `syncDomain` 配置。
  - WebDAV transport：`webdav-sync.ts`。
- **约束**：
  - 企业素材不参与。
  - `proxyMode: "nextjs"` 残留，但当前 Vite/Go 主应用没有 `/webdav-proxy`；direct 模式才有明确实现。

## 图片工作台

- **职责**：提示词、参考图、图像生成/编辑、并发多图、结果历史、下载和保存素材。
- **输入**：`AiConfig`、prompt、references、图像 settings。
- **输出**：生成图片、平台文件、历史记录、个人素材。
- **核心文件**：`web/src/pages/image/index.tsx`、`web/src/services/api/image.ts`、`web/src/services/api/async-image-edit-form.ts`。
- **数据流**：page -> local upstream 或 remote proxy -> result -> upload file -> history/assets。
- **依赖关系**：config、user、blob/file、prompts、generation tasks。
- **常见修改位置**：
  - 请求协议/流式解析：`services/api/image.ts`。
  - 页面工作流：`pages/image/index.tsx`。
  - 共享设置 UI：`components/image-settings-panel.tsx`。
- **约束**：第一方 Generation Command 尚未覆盖图片，remote 图片主要仍走兼容代理。

## 视频工作台

- **职责**：视频 prompt、参考媒体、远程第一方 Generation Run 或本地兼容任务、结果展示和历史。
- **输入**：`AiConfig`、文本、图片/视频/音频引用、视频 settings。
- **输出**：远程平台 Materialized Result 或本地兼容结果、平台文件和历史。
- **核心文件**：`web/src/pages/video/index.tsx`、`web/src/services/api/video.ts`、`web/src/lib/seedance-video.ts`。
- **数据流**：remote mode 读取后台 Model Profile，提交 `GenerationCommand` 到 `/api/v1/generations`，由服务端完成队列、轮询、计费、审计和物化；local mode 保留 Seedance-shaped payload -> direct upstream -> poll -> upload result。短剧 Profile 额外要求标题和每张参考图角色。
- **依赖关系**：config、files、generation history、prompts。
- **常见修改位置**：
  - 本地兼容 payload/status：`services/api/video.ts`。
  - 远程 first-party command/观察：`pages/video/video-async-task.ts`。
  - UI/历史：video page。
  - 第一方视频不在此文件主导，见 [generation.md](generation.md)。

## 提示词与素材浏览

- **职责**：公共提示词分页/筛选、详情、复制；公共素材浏览和加入个人素材。
- **输入**：keyword/category/tag/page。
- **输出**：Prompt/Asset list、输入框内容或个人素材。
- **核心文件**：`web/src/pages/prompts/`、`web/src/components/prompts/`、`web/src/pages/asset-library/`、`web/src/services/api/prompts.ts`、`assets.ts`。
- **数据流**：page hook -> public API -> card/dialog -> copy/insert/save。
- **依赖关系**：后端 prompts/assets；素材保存依赖 personal asset store。
- **常见修改位置**：共享列表行为优先改 `components/prompts/use-prompt-list.ts`，不要在每个页面复制查询逻辑。

## 企业账户与企业素材

- **职责**：账户页企业概况、成员和积分；企业素材按需 CRUD/复制。
- **输入**：当前企业身份、查询、成员/素材表单。
- **输出**：企业视图、成员/流水、企业素材、个人素材副本。
- **核心文件**：`web/src/pages/account/`、`web/src/pages/enterprise-assets/`、`web/src/services/api/auth.ts`、`enterprise-assets.ts`。
- **数据流**：React Query/page state -> enterprise API -> invalidate/refetch。
- **依赖关系**：user store；个人副本最终进入 personal asset store/后端。
- **常见修改位置**：
  - 企业 API 合同：两个 API 文件。
  - 素材表单转换：`enterprise-asset-form.ts`。
- **约束**：不要把企业数据放入 `useAssetStore`。

## 管理后台

- **职责**：用户、企业、积分、任务、提示词、素材和设置管理。
- **输入**：管理员 token、筛选分页、表单 mutation。
- **输出**：表格/详情、后台 API mutation。
- **核心文件**：`web/src/pages/admin/`、`web/src/services/api/admin.ts`。
- **数据流**：页面私有 `use-admin-*.ts` -> React Query -> `/api/admin/*` -> cache invalidation。
- **依赖关系**：user store、Query Client、Ant Design Pro。
- **常见修改位置**：
  - 单页面业务：页面目录和私有 hook。
  - API DTO：`services/api/admin.ts`。
  - 主题：全局 app theme，不在页面写 dark 分支。

## Canvas

Canvas 是最大前端模块，详见 [canvas.md](canvas.md)。其核心特征是：

- 项目页本地 state 负责细粒度交互。
- Zustand store 负责项目 Replica 和同步。
- 自研 DOM/SVG 画布，不依赖 React Flow。
- 节点 metadata 同时承载业务内容、生成配置和任务恢复信息。
- 在线助手和本地 Agent 最终都转成 `CanvasAgentOp`。
