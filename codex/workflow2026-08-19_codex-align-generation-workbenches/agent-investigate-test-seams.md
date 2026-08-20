# investigate-test-seams 调查记录

## 状态

- 状态：completed
- 任务 slug：`investigate-test-seams`
- 角色：TDD/test-contract investigator
- 执行模式：只读调查
- 波次/并行组：`wave-1` / `read-only-investigation`
- 分支：`codex/align-generation-workbenches`
- 基准：`main`，提交 `a13233e4649ed39f220b11b0c865a2e4997f581f`
- 调查范围：Go/TypeScript 测试结构、测试命令、图片工作台、视频工作台、Canvas 节点、模型配置、日志落库、积分记账及其公共接口
- 实际读取 Skills：`/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`、`/Users/eldenpdx/.agents/skills/tdd/SKILL.md`，以及 TDD 引用的 `tests.md`、`mocking.md`
- 未修改业务源码、测试、配置、依赖或锁文件；没有运行真实浏览器，没有创建服务或 worktree

## 结论摘要

1. 后端测试是标准库 `testing`、`httptest`、本地 fake upstream 加 PostgreSQL 集成；CI 的权威命令是 `go vet ./...` 和 `go test -p 1 ./...`。
2. 前端没有 Vitest/Jest 配置，也没有 `test` script；现有测试由 Bun 直接执行，混用 `node:test` 与 `bun:test`，DOM 测试显式注册 Happy DOM。
3. Canvas 已有最成熟的可观察 seam：意图编译、Profile 设置归一、任务恢复、结果 `fileId` 读取、视频 Replica durable commit。
4. 图片工作台当前走同步 `requestGeneration/requestEdit`，Canvas 图片走异步 create/poll/upload；视频工作台当前走兼容 `/contents/generations/tasks`，Canvas 远程视频走第一方 `/generations`。
5. 日志和积分的后端公共边界已经存在，但工作台页面仍把本地缓存、后端记录、轮询和结果保存编排在页面闭包中，缺少直接的工作台契约测试。
6. 最小实现顺序应先锁定 Profile/来源，再锁定图片和视频的请求/轮询/存储，再锁定日志与积分的单行、单次和幂等性质；不要直接测试 React 页面私有闭包。

## 1. 现有测试结构与命令

### 1.1 Go

项目使用标准库 `testing`，没有额外 Go 测试框架。

主要测试位置：

- 配置与无数据库纯测试：`config/config_test.go`、`model/generation_task_test.go`
- Handler seam：`handler/generations_test.go`、`handler/media_reference_test.go`、`handler/user_file_test.go`
- Service/API/协议：`service/ai_proxy_test.go`、`service/generation_adapter_test.go`、`service/generation_drama_test.go`、`service/settings_test.go`
- 生命周期与恢复：`service/generation_lifecycle_test.go`、`service/compatibility_lifecycle_test.go`
- Repository/事务/队列：`repository/generation_billing_test.go`、`repository/generation_queue_test.go`、`repository/generation_task_query_test.go`、`repository/sync_test.go`
- HTTP 集成：`router/generations_integration_test.go`、`router/account_integration_test.go`、`router/admin_generation_tasks_integration_test.go`、`router/admin_credit_logs_integration_test.go`

现有 Go 测试风格：

- 纯函数或同包内部 seam 直接断言返回值和错误类型。
- 上游协议使用 `httptest.NewServer`，不访问真实 provider。
- Handler 使用 `httptest.NewRecorder` 或通过 `router.New()` 起内存 HTTP server。
- 需要数据库的测试直接调用 `repository.DB()`，使用 UUID 隔离数据，部分测试保存并恢复全局 Settings。
- First-party 生命周期使用 fake adapter，通过 `generationAdapterFor`、`generationProfiles`、`generationPersistVideo`、`generationDispatch` 等包级 seam 注入。
- 事务性质通过任务、用户余额、credit log、payload、task event 的公开 repository 读取联合验证。

CI 中的权威 Go 命令见 `.github/workflows/ci.yml:49-50`：

```text
go vet ./...
go test -p 1 ./...
```

`-p 1` 很重要：Repository 使用全局 `DB()`/`sync.Once`，测试还会修改共享 Settings；并行 package 执行会放大数据库和全局状态竞争。

### 1.2 TypeScript/React

`web/package.json:4-9` 只有：

```text
dev
build
start
format
format:check
```

没有 `test` script，也没有 Vitest/Jest/Playwright test config。现有测试分两类：

- `node:test` + `node:assert/strict`：大多数 `.test.mjs`、部分 `.test.tsx`
- `bun:test`：需要 `mock`、`expect`、`afterEach` 或 React DOM 交互的部分 `.test.ts/.tsx`

因此前端测试应使用 Bun 直接执行，例如：

```text
cd web
bun test src/services/api/generations.test.mjs
bun test test/account-logs.test.tsx
```

DOM 测试可沿用 `@happy-dom/global-registrator`，现成范例是 `web/test/admin-settings.test.tsx:1-16`。`web/vite.config.ts:12-15` 只提供 Vite 的 `@` alias，不提供测试 runner 配置。

现有相关前端测试：

- 图片 API：`web/src/services/api/image.test.mjs`
- 视频兼容 API：`web/src/services/api/video.test.mjs`
- First-party command/poll/result：`web/src/services/api/generations.test.mjs`
- Canvas 编译：`web/src/pages/canvas/components/canvas-node-generation.test.mjs`
- Canvas 配置：`web/src/pages/canvas/components/canvas-node-config.test.ts`
- Canvas 恢复：`web/src/pages/canvas/components/canvas-generation-resume.test.mjs`
- Canvas Replica：`web/src/pages/canvas/stores/canvas-replica.test.mjs`
- 视频设置 UI：`web/src/components/video-settings-panel.test.tsx`
- 模型选择/公开模型 allowlist：`web/src/components/model-picker.test.tsx`、`web/src/stores/use-config-store.test.ts`
- 视频/图片积分展示：`web/src/constant/credits.test.mjs`
- Canvas durable result/save：`web/test/canvas-durable-save.test.ts`
- 账户/后台日志 UI 与筛选：`web/test/account-logs.test.tsx`、`web/test/account-log-export.test.ts`、`web/test/admin-log-date-filter.test.tsx`

CI 目前只执行两个前端 session 测试，见 `.github/workflows/ci.yml:69-71`：

```text
bun test test/session-monitor.test.ts test/user-session-hydration.test.ts
```

这意味着生成相关前端测试不会因 CI 自动覆盖而得到保护，后续实现角色必须显式运行对应文件。

### 1.3 领域文档约束

- `CONTEXT.md` 定义了 Model Profile、Generation Run、Materialized Result、Stop/Resume Observing、Canvas Replica 等词汇。
- `docs/adr/` 当前没有 ADR 文件；约束性架构基线在 `docs/architecture/generation-platform.md`。
- 生成架构要求第一方 Canvas/工作台使用类型化 `GenerationCommand`，Profile 作为公开能力来源，并将任务、计费、审计、结果存储统一到后端生命周期；验证策略见该文档 `18.1-18.3` 附近。
- 图片目前尚无对应的 first-party `GenerationIntent`/Profile；当前可复用的图片 canonical seam 是异步兼容 API 加后端任务日志。

## 2. 建议使用的公共 seam

### 2.1 模型配置

可观察入口：

- 公共配置：`GET /api/settings` -> `handler.Settings` -> `service.PublicSettings`
- 管理配置：`GET/POST /api/admin/settings` -> `handler.AdminSettings`/`AdminSaveSettings` -> `service.AdminSettings`/`SaveSettings`
- First-party Profile：`GET /api/v1/model-profiles` -> `handler.ModelProfiles` -> `service.AvailableGenerationProfiles`
- 前端：`web/src/services/api/settings.ts:38-40`、`web/src/stores/use-config-store.ts:227-287`、`web/src/services/api/generations.ts:39-45`

配置数据模型：

- `model.PublicModelChannelSetting`：公开模型列表、能力 allowlist、价格、图片请求格式
- `model.GenerationProfile`：公开能力、设置默认值、Adapter、取消与完成能力
- `model.GenerationProfileBinding`：私有渠道绑定、上游模型、计费模式、限制覆盖和 metadata

推荐测试边界：

- 用户可观察的配置一致性优先测 HTTP/API 响应，不直接测表内 JSON。
- 纯归一规则可沿用 `service/settings_test.go` 的同包 seam，重点是 `normalizeSettings`、`normalizeImageRequestFormats`、`resolveGenerationProfiles`、`normalizeGenerationSettings`。
- 工作台和 Canvas 的视频设置应以同一 `GenerationProfile` fixture 驱动，不能各自硬编码 resolution/aspect/duration。
- 图片请求格式仍由 `PublicModelChannelSetting.ImageRequestFormats` 驱动；不要在测试中假定图片已有 first-party Profile。

### 2.2 图片工作台与 Canvas 图片节点

Canvas 当前链路：

```text
Canvas project/index.tsx
  -> createAsyncImageTask/createAsyncImageEditTask
  -> set upstreamTaskId/taskModel
  -> pollAsyncImageTask
  -> uploadBlob/uploadUrlToS3("results/images")
  -> set image node metadata/fileId/status
```

关键入口：

- `web/src/services/api/image.ts:932-1021`
- `web/src/pages/canvas/project/index.tsx:2330-2348`
- `web/src/pages/canvas/project/index.tsx:2699-2750`
- `web/src/services/api/async-image-edit-form.ts:17-45`

图片工作台当前链路：

```text
web/src/pages/image/index.tsx:192-280
  -> requestGeneration/requestEdit
  -> readImageMeta
  -> uploadBlob("results/images") during final log save
  -> localforage log + recordGenerationTask/patchGenerationTaskMetadata
```

关键入口：

- `web/src/pages/image/index.tsx:192-280`、`:374-459`、`:534-547`
- `web/src/services/api/image.ts:812-896`

可直接测试的 seam：

- `requestGeneration`
- `requestEdit`
- `createAsyncImageTask`
- `createAsyncImageEditTask`
- `pollAsyncImageTask`
- `buildAsyncImageEditRequest`
- 后端 `ProxyAIRequest`、`asyncImageTaskRef`、`GET /api/v1/tasks/:id`

当前差异与风险：

- Canvas 图片是异步 create/poll；工作台图片是同步 request，页面自己完成结果上传和日志合并。
- `createAsyncImageTask`/`createAsyncImageEditTask` 当前把 `X-Source` 写死为 `canvas`（`image.ts:949-952`、`:980-984`）。若工作台复用该路径，必须显式区分 `canvas` 与 `image_workbench`，并用测试锁定。
- 工作台远程图片日志依赖按 model/time 查找最近任务再补 `fileIds`（`image/index.tsx:413-423`），同模型并发生成可能错配；稳定的 backend task ID 或 client request identity 应成为 seam。
- 图片 API 现有测试只覆盖异步 Canvas 请求和轮询，不覆盖 `requestGeneration`、`requestEdit`、工作台页面日志闭环。

### 2.3 视频工作台与 Canvas 视频节点

Canvas 远程 first-party 链路：

```text
prepareFirstPartyCanvasVideoRun
  -> createGeneration(POST /api/v1/generations)
  -> waitForGeneration(GET task or client request)
  -> readGeneratedVideoFile(require platform fileId)
  -> resolveFileUrls
  -> commitCanvasVideoResult
```

关键入口：

- `web/src/pages/canvas/components/canvas-node-generation.ts:32-86`
- `web/src/pages/canvas/project/index.tsx:2353-2425`
- `web/src/pages/canvas/project/index.tsx:2752-2815`
- `web/src/pages/canvas/stores/canvas-video-result.ts:21-81`

Canvas 本地兼容链路仍是：

```text
createVideoGenerationTask
  -> pollVideoGenerationTask
  -> uploadBlob/uploadUrlToS3("results/videos")
  -> commitCanvasVideoResult
```

视频工作台当前链路：

```text
web/src/pages/video/index.tsx:228-263
  -> createVideoGenerationTask
  -> pollGenerationLog
  -> pollVideoGenerationTask
  -> upload result
  -> saveLog/localforage + recordGenerationTask/patch metadata
```

关键入口：

- `web/src/services/api/video.ts:37-109`
- `web/src/services/api/video.ts:116-185`
- `web/src/pages/video/index.tsx:228-277`
- `web/src/pages/video/index.tsx:377-580`
- `web/src/services/api/generations.ts:51-193`

可直接测试的 seam：

- `buildGenerationCommand`
- `buildVideoGenerationSettings`/`buildShortDramaGenerationSettings`
- `createGeneration`/`waitForGeneration`
- `createVideoGenerationTask`/`pollVideoGenerationTask`
- `storeGeneratedVideo`
- `readGeneratedVideoFile`
- `commitCanvasVideoResult`
- 后端 `POST /api/v1/generations`、兼容 `POST /api/v1/contents/generations/tasks`、history API

当前差异与风险：

- 远程 Canvas 使用 Profile/first-party command；视频工作台仍默认构造 provider-shaped compatibility payload。
- `VideoPage.generate` 当前调用 `createVideoGenerationTask` 时没有传入显式 source；兼容入口可由路径推断 `video_workbench`，但切换到 first-party command 后必须断言 `command.source === "video_workbench"`。
- Canvas first-party 成功必须先取得平台 `fileId`，再写入结果；工作台当前以 provider URL/blob 为中间结果，页面闭包负责上传，尚无同等的公共结果提交 seam。
- `VideoPage.saveLog` 使用本地 log ID 调 `patchGenerationTaskMetadata`（`video/index.tsx:420-425`），要验证 backend task ID 与本地缓存 ID 不会产生两行日志。

### 2.4 Canvas 节点

推荐按纯函数和持久化 helper 测试，不测 `project/index.tsx` 的大页面闭包：

- 配置合并：`buildNodeConfig`、`buildSavedImageConfig`
- 节点设置写回：`videoConfigPatch`、`audioConfigPatch`
- 连接图编译：`buildNodeGenerationContext`、`buildVideoGenerationIntent`、`buildShortDramaGenerationIntent`
- first-party 准备：`prepareFirstPartyCanvasVideoRun`
- 恢复身份：`canvasGenerationResume`
- 结果落盘：`commitCanvasVideoResult`

现有测试已证明：

- 平台媒体只传 `fileId`，不泄漏 `dataUrl/storageKey/provider field`
- Profile 默认值和限制会应用于 Canvas settings
- 任务恢复优先 `generationTaskId`，丢失 create response 时可按 `clientRequestId` 查询
- 视频结果带 `fileId`、状态和媒体 metadata 后才视为成功，且 durable save 测试覆盖了并发/新编辑保护

缺口：

- Canvas 图片结果没有与视频一样独立的 durable result commit seam 测试。
- 画布页面调用路径本身没有非浏览器集成测试，节点 status/error 写回主要依赖纯 helper 和手动验收。

### 2.5 日志落库

后端公共边界：

- `service/task_lifecycle.go:16-129`：`StartCompatibilityTask`、`LogTaskStart`、`LogTaskCreated`、`LogTaskSuccess`、`LogTaskFailure`、`LogTaskCancelled`
- `service/generation_service.go:151-219`：`RecordUserTask` 的同步任务记录/upsert
- `service/generation_service.go:73-85`：`UpdateTaskMetadata`
- `service/generation_mapper.go:35-147`：视频/图片历史 DTO
- `GET /api/v1/generation-tasks`、detail、metadata route，见 `router/router.go:86-97`
- `model.GenerationTask`、`model.GenerationPayload`、`model.GenerationTaskEvent`

前端公共边界：

- `fetchImageHistory`/`fetchVideoHistory`
- `recordGenerationTask`
- `patchGenerationTaskMetadata`
- 登录用户在线时页面优先从 backend history 读取，localforage 只是 fallback/cache

日志不变量：

- 一次生成只能有一条任务主记录；pending/created/terminal 更新同一 ID。
- `source` 必须区分 `canvas`、`image_workbench`、`video_workbench`。
- request/response headers/body 和 raw error 进入 payload/audit；敏感 key、signed URL 参数和媒体 bytes 不应泄漏。
- 结果文件应通过 `fileIds`/platform file reference 关联，长期历史不依赖易过期 provider URL。
- `success` 与 `succeeded` 是等价终态；目前 repository 查询已处理等价状态，但 `service/generation_mapper.go:152-162` 的 DTO 映射只明确处理 `TaskStatusSuccess`，这是需补测试的风险点。

### 2.6 积分记账

主要边界：

- First-party 创建：`service.CreateGeneration` -> `repository.CreateGenerationTaskWithCharge`
- 兼容代理：`service.ProxyAIRequest`/`ProxyVideoTaskCreate` -> `StartCompatibilityTask` + `Consume/RefundUserCreditsWithTask`
- 终态：`repository.TransitionGenerationTaskTerminal`
- 上游 credits 结算：`repository.ChargeGenerationTask`
- 通用幂等账本：`repository.ApplyUserCreditLog`
- 计费计划：`service/generation_billing.go:16-85`

数据库约束：

- `repository/db.go:81-90` 建立 `(task_id,type)` 的 credit log 唯一索引，以及任务/请求幂等索引。
- `ApplyUserCreditLog` 在用户行锁内检查同一 task/type，重复消费/退款应返回已应用而不再次变更余额。
- `TransitionGenerationTaskTerminal` 以状态 CAS 加事务写 refund log/event，重复 callback/poll 不应再结算。

必须区分：

- 远程模式：后端负责扣费、退款、任务日志。
- 本地模式：浏览器直连 provider，当前工作台用 `credits: "0"` 记录日志，不应在测试中假定后端已扣费。
- per-call/per-second：创建时预扣。
- per-credit：成功拿到上游 credits 后结算。
- 企业折扣：实际扣费可为小数，不能用前端整数显示或期望值替代后端 Decimal。

## 3. 最小红-绿测试切片

以下每个切片只建议先写一个能失败的行为测试，再实现到通过；不要先铺一整套页面快照。

| 切片 | 第一条红测试建议 | 观察 seam | 绿态验收 |
|---|---|---|---|
| R1 Profile/allowlist | 同一 Profile fixture 被 Canvas 与视频工作台转换成相同默认 resolution/aspect/duration；隐藏/失效模型不能提交 | `getGenerationProfiles`、`buildVideoGenerationSettings`、`useConfigStore.loadPublicSettings` | 两个入口只读同一公开 Profile/allowlist；没有私有 channel/API key |
| R2 图片请求 parity | 工作台带文本/参考图时，request body、format、背景、数量、引用顺序与 Canvas canonical async request 一致；source 不再固定为 canvas | `requestGeneration`/`requestEdit` 或 `createAsyncImage*`，axios stub | JSON/multipart 和 split/generations 只由公开配置决定；source 可观察为正确工作台值 |
| R3 图片终态与存储 | async submit 直接返回结果、pending 后 succeeded、failed/cancelled 三种情况各自只产生预期结果/错误；成功后才有 platform fileId | `createAsyncImage*`、`pollAsyncImageTask`、后端 `/async/images` + `/tasks` | 不重复 poll；结果上传/历史关联稳定；失败只退一次积分 |
| R4 First-party 视频工作台 | 远程视频工作台提交 `GenerationCommand`，source 为 `video_workbench`，intent/settings 与 Canvas 相同 | `buildGenerationCommand`、`createGeneration`、`POST /api/v1/generations` | 返回 queued；上游只收到 Adapter 生成的 provider payload，不收到 Canvas 私有字段 |
| R5 视频观察/结果 | queued -> running -> succeeded、20 次临时查询错误暂停、恢复后继续；provider success 但无 fileId 被拒绝 | `pollGenerationTask`、`waitForGeneration`、`readGeneratedVideoFile` | 工作台和 Canvas 使用同一终态/error/暂停语义；只显示平台文件 |
| R6 durable result | 成功视频在 local Replica durable commit 完成前不能发布 success；新编辑不能被结果覆盖 | `commitCanvasVideoResult` / workbench 复用的 result commit helper | `fileId/status/media metadata` 一起恢复；无 beforeunload 依赖 |
| R7 日志单行 | remote/local 各一条生成流，pending/terminal 更新同一 task row，history 可按 source/type 查询 | `POST /generation-tasks`、`GET /generation-tasks`、`RecordUserTask` | 不出现本地 log ID 与 backend task ID 的重复行；request/response/error 可定位 |
| R8 账本幂等 | 同一 task 重复 callback/poll/failure/refund，余额和 consume/refund 行数不再增加 | `TransitionGenerationTaskTerminal`、`ApplyUserCreditLog`、HTTP history/credit logs | 一次扣费、至多一次退款、终态只胜出一次；存储失败保持约定的 recoverable 状态 |

## 4. 验收矩阵

| ID | 关键行为 | 推荐测试层级与位置 | 现有覆盖 | 最小新增断言 |
|---|---|---|---|---|
| M1 | 公开模型列表与失效选择修复 | Bun: `web/src/stores/use-config-store.test.ts`；Go: `handler/generations_test.go` | 部分已有 | Canvas、图片工作台、视频工作台不得继续使用 hidden/stale model |
| M2 | 视频 Profile 无 secrets、能力/默认值完整 | Go handler/service + Bun `generations.test.mjs` | 已覆盖基础 Profile | 通过真实 `AvailableGenerationProfiles`/配置过滤验证，而非只注入静态模板 |
| M3 | 图片请求格式与 Canvas mode | Bun `async-image-edit-form.test.mjs`、`image.test.mjs` | Canvas async 已覆盖 | 工作台路径同样读取 `imageRequestFormats`，multipart 文件与 JSON `image_url` 规则一致 |
| M4 | 图片提交 task identity | Bun API test + Go proxy integration | 有 task ID/立即完成测试 | header/body 返回的 task ID 与 history row 可稳定关联；不使用 model/time 猜测 |
| M5 | 图片 pending polling | Bun `pollAsyncImageTask`；Go `service/ai_proxy_test.go` | 失败和直接完成已覆盖 | queued/running 不落终态；completed 缺图稳定为 `RESULT_FILE_MISSING` |
| M6 | 图片成功结果存储 | Bun service seam，必要时 Go/HTTP | 缺工作台闭环 | success 只有在结果可转为 platform file reference 后才进入工作台成功日志 |
| M7 | 视频工作台 remote command | Bun `generations.test.mjs` + Go `router/generations_integration_test.go` | Canvas command 已覆盖 | source=`video_workbench`，profile/settings/references 与 Canvas 完全相同 |
| M8 | 视频工作台 local compatibility | Bun `video.test.mjs` + Go proxy test | provider payload/error 已覆盖 | source=`video_workbench`，保留本地直连，不误触发 remote credit/log 语义 |
| M9 | 视频轮询/暂停/恢复 | Bun `generations.test.mjs`；可复用 `pollGenerationTask` | 通用 first-party 已覆盖 | 工作台使用同一 poller；暂停不写 failed，不取消上游 |
| M10 | 视频平台结果与 durable commit | Bun `generations.test.mjs`、`web/test/canvas-durable-save.test.ts` | Canvas durable 已覆盖 | 工作台 success 也必须带 `fileId`，不能把 signed provider URL 当最终结果 |
| M11 | Canvas 节点编译 | Bun `canvas-node-generation.test.mjs`、`canvas-node-config.test.ts` | 覆盖良好 | 保持 `fileId`、sourceNodeId、Profile defaults 和 provider-field 隔离 |
| M12 | Canvas 恢复 | Bun `canvas-generation-resume.test.mjs` | 覆盖良好 | 工作台恢复也不应重新提交；lost create 用 client request identity |
| M13 | 日志 source/字段/payload | Go router integration + `service/generation_mapper_test.go` | 有账户/后台日志查询 | 每个入口一行；task type/source/status/upstream ID/fileIds/request/response/error 可查询 |
| M14 | `success`/`succeeded` 展示一致 | Go mapper/repository + router account/admin integration | repository filter 已有，DTO 不完整 | 两种成功状态在工作台/账户/后台均显示成功，不显示 pending |
| M15 | 失败/取消只退款一次 | Go `service/generation_lifecycle_test.go`、`service/ai_proxy_test.go`、router integration | first-party/async failure 已有 | 加上 workbench source、cancelled、重复 poll/callback 和 storage failure |
| M16 | 计费模式一致 | Go `generation_adapter_test.go`、`repository/generation_billing_test.go` | per-second/per-credit/折扣已有 | Canvas 与工作台同 Profile 的 per-call/per-second/per-credit 得到相同 Decimal |
| M17 | 余额不足/事务回滚 | Go repository billing + router HTTP | 部分已有 | task、payload、consume log、余额要么全部提交，要么全部回滚 |
| M18 | 审计脱敏 | Go `service/ai_proxy_test.go`、`generation_adapter_test.go` | signed URL/auth/multipart 已有 | 工作台新路径不绕过脱敏，长期记录不含 raw secret/data bytes |

## 5. 现有覆盖与明确缺口

已有强覆盖：

- First-party video Profile validation、settings normalization、Adapter payload、媒体权限和错误映射。
- First-party task 的 idempotency hash、重复 command、终态 CAS、callback/poll convergence、cancel race、timeout、missing URL/file ID。
- 兼容异步图片失败退款与重复 poll；视频兼容 payload、错误提示和网络失败。
- Canvas command 编译、资源 fileId、恢复身份、视频 durable result commit，以及高并发 Replica save。
- 公开 capability allowlist、模型配置默认值、管理后台视频 resolution UI。
- 计费的 atomic create、per-second、per-credit、企业折扣和部分退款幂等。

最重要缺口：

1. 没有图片工作台页面/服务的生成 -> 结果存储 -> backend log 的闭环测试。
2. 没有视频工作台页面/服务切换到 first-party command 后的 source、Profile、结果 fileId 和日志闭环测试。
3. `storeGeneratedVideo` 和图片工作台上传结果的依赖边界不易替换；若实现继续把上传藏在页面闭包，测试会被迫测试实现细节，应先保留一个小的公共 storage seam。
4. 没有验证 workbench 本地日志 ID 与 backend task ID 是否始终同一行。
5. `ToVideoHistoryDTO`/`ToImageHistoryDTO` 对 `TaskStatusSucceeded` 的展示语义缺少直接测试，可能把已成功的 first-party task 映射成 pending。
6. 图片异步结果目前由前端上传到平台文件；后端 async task 终态与文件物化不是一个事务，成功但上传失败时的日志/退款语义尚未被明确锁定。

## 6. 环境限制与验证边界

### PostgreSQL

`repository.DB()` 会：

- 读取 `config.Cfg.DatabaseDSN`
- 连接 PostgreSQL
- 执行 PostgreSQL-specific migration/index/trigger SQL
- `AutoMigrate` 全部业务表
- 使用全局 `sync.Once`

所以涉及 `repository` 的 Go 测试需要 PostgreSQL；CI 通过 Postgres 17 service 和 `DATABASE_DSN` 提供环境。没有独立 test database reset/transaction fixture，Settings 和全局函数替换必须串行并恢复。不要把 repository 集成测试标成纯单元测试，也不要在本任务中依赖真实 provider/S3。

### Bun/DOM

- 纯 API 测试可用 Bun 内建 `File`、`Blob`、`FormData`、`Response` 和 `node:http` 临时 server。
- React/AntD 组件测试需要 `@happy-dom/global-registrator`，不能假定 Node 原生 DOM。
- 不存在统一 test setup；每个 DOM 测试自行注册/清理全局环境。
- 不应在本任务中运行真实浏览器、Vite dev server、S3 或 provider。

### 未执行项目

- 没有运行 `go test -p 1 ./...`，因为它会触碰共享 PostgreSQL 数据和全局 Settings；只做了无数据库/本地 fake 的聚焦 Go 测试。
- 没有运行 `go vet`、`web build`、格式化或依赖安装。
- 没有运行真实浏览器或手动 UI 流程。
- 未使用外部资源和本地 `7897` 端口。

## 7. 本次聚焦验证

已执行且通过：

```text
go test ./config ./model ./handler -run 'Test(Load|GenerationTask|ModelProfilesExposeVideoAdaptersWithoutSecrets|CreateGenerationReturnsLocatableValidationError|CancelGenerationReturnsStableOperationError|GenerationCallbackRejectsInvalidToken|CreateGenerationPassesPlatformReferences|CreateGenerationAcceptsPromptOnlyVideoCommand)' -count=1
```

结果：`config`、`handler` 通过；`model` 没有命中本次过滤条件。

```text
go test ./service -run 'Test(GenerationProfilesAreValid|GenerationFileMatchesMediaType|ReadAIRequestMultipart|AsyncImageTaskRefAcceptsTopLevelImageData|AIUpstreamErrorDetail|SafeUpstreamTextTruncates|BuildGeminiUpstreamURLAndAuth|BuildGeminiUpstreamNonStreamImage|BuildOpenAIUpstreamStillBearer|ResolveAIProxyPathPassesThroughTasksPath|ResolveAIProxyPathPassesThroughTasksIdAndRemixPath|ResolveAIProxyPathStillRewritesVideosForSeedance|BuildOpenAIUpstreamTasksCreateURL|BuildOpenAIUpstreamTasksRemixURL|ViduDramaProfileContract|NormalizePrivateSettingAcceptsGeminiProtocol)' -count=1
```

结果：`service` 通过。

```text
cd web
bun test src/services/api/generations.test.mjs \
  src/pages/canvas/components/canvas-node-generation.test.mjs \
  src/pages/canvas/components/canvas-generation-resume.test.mjs \
  src/pages/canvas/components/canvas-node-config.test.ts \
  src/pages/canvas/stores/canvas-replica.test.mjs \
  src/services/api/image.test.mjs \
  src/services/api/video.test.mjs
```

结果：Bun `1.3.14`，7 个文件共 `53 pass / 0 fail`。

Git 状态复核：

- 当前分支仍为 `codex/align-generation-workbenches`
- `git diff --name-only` 无 tracked diff
- 仅看到任务 workflow 目录和并行的 `codex/workflow2026-08-19_codex-image-resolution-config/` 未跟踪内容，未读取、修改或清理后者

## 8. 交接假设、备选与残余风险

### 假设

1. 视频远程入口的 canonical seam 是 first-party `/api/v1/generations`；本地模式保留兼容 API，并用独立测试证明不混用后端计费语义。
2. 图片在当前代码基线没有 first-party intent/profile，因此“对齐 Canvas”先指向现有异步图片 API、task identity、平台文件和日志契约，不在测试建议中臆造新的图片 Profile。
3. 生成结果的最终成功标准是平台 `fileId` 可查询，而不是 provider URL 或 data URI。
4. 日志和积分验收以用户可见 HTTP history/credit-log 为主；payload/audit、task event 和事务原子性才使用 repository 读取补充验证。

### 备选方案

- 方案 A：直接给 `ImagePage`/`VideoPage` 写 DOM 集成测试。未采用：页面把请求、轮询、存储、日志和状态都放在闭包中，测试会绑定实现细节且需要浏览器级环境。
- 方案 B：为每个工作台复制 Canvas 测试矩阵。未采用：会固化两套协议和错误语义；应先把请求、poll、result、log 的最小公共 seam 暴露出来，再由两入口各测一次 source/输入差异。
- 方案 C：只测 provider payload。未采用：无法证明 task ownership、平台文件、日志落库和积分幂等；payload 只应是 Adapter/兼容入口的一层证据。

### 残余风险

- 工作台历史使用 localforage 与后端 history 双写，若 backend task ID 未回传给页面，重复/错配日志仍可能发生。
- 图片结果物化在前端，网络中断或 S3 上传失败时 backend task 的成功状态与 fileId 可能暂时不一致。
- `TaskStatusSuccess`/`TaskStatusSucceeded` 的 DTO 映射差异可能让管理后台或工作台把成功任务显示为 pending。
- `repository.DB()` 的 `sync.Once` 与共享 Settings 使全量测试不适合并行执行；任何实现角色新增测试都应使用 UUID、`t.Cleanup` 和设置快照恢复。
- 真实浏览器中的 IndexedDB、账号切换、CORS、预签名 URL 播放和页面卸载行为不在本调查的自动验证范围，必须留给用户验收。
