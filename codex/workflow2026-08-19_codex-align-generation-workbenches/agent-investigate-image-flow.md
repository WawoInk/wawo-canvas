# investigate-image-flow

## 状态

- 状态：completed
- 任务 slug：`investigate-image-flow`
- 角色：canvas/image-flow investigator
- 执行模式：只读调查
- 波次/并行组：`wave-1` / `read-only-investigation`
- 分支：`codex/align-generation-workbenches`
- 基准：`main` @ `a13233e4649ed39f220b11b0c865a2e4997f581f`
- 结论范围：已覆盖 Canvas 图片节点标准生成/编辑、图片工具编辑、图片工作台 local/remote、后端异步兼容代理、任务日志、结果文件和积分链路。

## 总结结论

1. 当前真正可复用的图片生成基线是 Canvas 的异步兼容入口：`createAsyncImageTask` / `createAsyncImageEditTask` -> `/api/v1/async/images/*` -> `ProxyAIRequest` -> `/api/v1/tasks/:id` 轮询 -> `pollCanvasImageNode` -> `uploadBlob` 或 `uploadUrlToS3` -> Canvas 节点 `fileId`。
2. 图片工作台没有使用这条异步基线：每个 batch slot 直接调用同步 `requestGeneration` / `requestEdit`，远程模式由代理即时完成任务，页面再用“最近同模型任务”猜测要回填哪个日志的 `fileIds`。
3. Canvas 标准图片任务由兼容代理记账和终态结算，但不会进入 Generation Worker 的持久队列；只有页面/Canvas 继续观察时才会轮询。页面丢失 `upstreamTaskId` 后无法自动恢复该已提交任务。
4. Canvas 标准异步图片结果物化为平台文件；Canvas 的 mask/angle 图片工具仍走同步 `requestEdit` + `uploadImage`（浏览器 IndexedDB），没有平台 `fileId`、独立异步任务恢复或专门日志关联。
5. `/api/v1/generations`、Model Profile、`GenerationIntent` 当前只实现视频（`video.generate` / `video.short-drama`）；图片不能直接迁移到第一方 Orchestrator，除非新增图片 Profile/Intent/Adapter，属于明显更大的边界。
6. 最小对齐路径应优先让图片工作台复用 Canvas 的异步创建、轮询和结果物化语义，并修复远程任务身份回填；不要在本任务中发明第二套图片 Profile 或把 local BYOK 伪装成平台计费路径。

## 关键公共入口与符号

### 前端请求与配置

- `web/src/services/api/image.ts:812-896`
  - `requestGeneration`：同步文生图，支持 OpenAI-compatible 与 Gemini。
  - `requestEdit`：同步编辑，支持 JSON/multipart、多个参考图和 mask。
- `web/src/services/api/image.ts:917-1030`
  - `createAsyncImageTask`
  - `createAsyncImageEditTask`
  - `pollAsyncImageTask`
  - `cancelAsyncImageTask`（当前 Canvas 未调用）
  - async 创建显式发送 `X-Source: canvas`。
- `web/src/services/api/image.ts:255-307`
  - `aiApiUrl` / `aiHeaders` / `configuredImageRequestFormat` / `configuredCanvasImageEditPath`。
- `web/src/services/api/async-image-edit-form.ts`
  - 统一构造 multipart/JSON 编辑请求、透明背景字段、`Images` 的 `images[].image_url` 形状。
- `web/src/stores/use-config-store.ts:196-200,227-287,408-424`
  - remote 模式只要求选模型；local 模式要求用户渠道 Base URL/API Key。
  - `loadPublicSettings` 将后台公开模型列表、默认模型、`modelCosts`、`imageRequestFormats` 注入配置。
  - `resolveModelRequestConfig` 将本地 `channel::model` 解析为具体渠道与上游模型。
- `web/src/services/api/settings.ts:4-24`
  - 后台公开图片模型、请求格式和 Canvas 端点模式的 DTO。
- `web/src/components/image-settings-panel.tsx`
  - Canvas 与图片工作台共用图片质量、尺寸、比例、透明背景、数量控件。
- `web/src/constant/credits.tsx:22-34`
  - remote UI 预估积分；local 固定显示 `0`。
- `web/src/services/credit-balance-sync.ts:23-60`
  - 全局 Axios response interceptor；`ClientRootInit` 启动后，remote API 响应会异步刷新当前用户余额。

### Canvas 图片节点

- `web/src/pages/canvas/project/index.tsx:2188-2350`
  - `handleGenerateNode` 的 `mode === "image"` 分支。
  - 从 `buildNodeConfig`、`buildNodeGenerationContext` 得到 prompt/参考图/节点快照。
  - 建立 batch root/children，保存 `generationType`、模型、尺寸、质量、数量和参考引用。
  - 每个 target 用 `createAsyncImageTask` 或 `createAsyncImageEditTask`，后台启动 `pollCanvasImageNode`。
- `web/src/pages/canvas/project/index.tsx:2567-2675`
  - `handleRetryNode`；优先使用已保存的 `generationType`、配置和参考图快照。
- `web/src/pages/canvas/project/index.tsx:2699-2750`
  - `pollCanvasImageNode`：每 5 秒最多 360 次，成功后物化平台文件，失败写节点错误。
- `web/src/pages/canvas/project/index.tsx:1899-1946`
  - `maskEditImageNode`：同步 `requestEdit`，结果用 `uploadImage`。
- `web/src/pages/canvas/project/index.tsx:1977-2031`
  - `generateAngleNode`：同步 `requestEdit`，结果用 `uploadImage`。
- `web/src/pages/canvas/components/canvas-node-generation.ts:162-326`
  - `buildNodeGenerationContext`、`buildNodeGenerationInputs`、`hydrateNodeGenerationContext`。
  - Canvas 节点输入仍同时保留 data URL、local storage key、platform `fileId`。
- `web/src/pages/canvas/components/canvas-node-config.ts:5-37`
  - `buildNodeConfig`：节点覆盖优先于全局配置。
  - `buildSavedImageConfig`：Retry Run 使用保存的图片设置快照。
- `web/src/pages/canvas/project/index.tsx:3548-3611`
  - `imageMetadata`、`buildImageGenerationMetadata`、`resolveMetadataReferences`。
- `web/src/pages/canvas/project/index.tsx:539-587`
  - 项目恢复时调用 `canvasGenerationResume` 并重新观察 loading 节点。
- `web/src/pages/canvas/components/canvas-generation-resume.ts:1-12`
  - 图片只按 `upstreamTaskId` 恢复；first-party `generationTaskId/clientRequestId` 分支目前只对视频开放。
- `web/src/pages/canvas/stores/use-canvas-store.ts:190-197,286-293`
  - `updateProject` 先写账号隔离的 local Replica，再由 `canvas-sync.ts` 排队同步后端。

### 图片工作台

- `web/src/pages/image/index.tsx:192-280`
  - `generate` 创建 pending 日志、按 `generationCount` 启动多个 slot、汇总成功/失败、上传结果、保存 final 日志。
- `web/src/pages/image/index.tsx:520-556`
  - `buildRequestSnapshot` 固定每个 slot `count: "1"`。
  - `runGenerationSlot` 直接调用同步 `requestEdit` 或 `requestGeneration`，读取图片元数据后更新卡片。
- `web/src/pages/image/index.tsx:374-429`
  - `saveLog`：先写 account-scoped localforage，再按 local/remote 分支同步 `generation_tasks`。
- `web/src/pages/image/index.tsx:432-506`
  - `refreshLogs` 从后端 `fetchImageHistory` 为主，fileId 通过 `resolveFileUrls` 换预签名 URL；失败才回退 localforage。
- `web/src/pages/image/index.tsx:957-1025`
  - local 日志读取、URL/fileId 恢复、序列化和配置快照归一化。

### 后端路由、任务、日志和积分

- `router/router.go:35-73,86-99`
  - 图片同步：`POST /api/v1/images/generations`、`/images/edits`。
  - Canvas 图片异步：`POST /api/v1/async/images/generations`、`/async/images/edits`。
  - 图片任务轮询/取消代理：`GET /api/v1/tasks/:id`、`POST /api/v1/tasks/:id/cancel`。
  - 历史/metadata：`GET/POST /api/v1/generation-tasks`、`POST /:id/metadata`。
- `service/ai_proxy.go:20-119`
  - `ProxyAIRequest`：读取模型/数量、校验公开模型、查 `ModelCost`、选渠道、写任务审计、预扣积分、转发上游。
  - 同步响应走 `LogTaskSuccess` 或 `LogTaskFailure`。
  - async 图片响应特殊处理为 `LogTaskCreated`，等待后续轮询终态。
- `service/ai_proxy.go:121-257`
  - `ProxyAIGetRequest` 识别用户拥有的图片任务。
  - `asyncImageTaskRef` 解析 `code/error/status/data/result.data`。
  - `finalizeAsyncImageTask` 更新 payload、错误/耗时，并调用 `arbitrateGenerationTerminalFrom` 完成一次终态和退款。
- `service/generation_service.go:16-65,151-219`
  - `DetermineTaskType`、`DetermineSource`、`RecordUserTask`。
  - `RecordUserTask` 以 `(userID, upstreamTaskId)` upsert；没有 upstream ID 时新增。
- `service/task_lifecycle.go:16-131`
  - `StartCompatibilityTask`（视频兼容持久任务）。
  - `LogTaskStart/Created/Success/Failure`（同步和图片 async 代理使用）。
- `repository/generation_billing.go:15-122`
  - `CreateGenerationTaskWithCharge`：任务、payload、预扣和消费流水同一事务。
  - `ChargeGenerationTask`：按上游 credits 结算兼容/first-party 特定任务。
- `repository/user.go:148-206`
  - `ApplyUserCreditLog`：按 `(taskID,type)` 幂等消费/退款，退款金额取原消费流水。
- `service/generation_mapper.go:89-147,219-255`
  - `ToImageHistoryDTO` 将任务 + payload 映射成工作台历史。
  - 从顶层 `response.data[].url/b64_json` 提取图片 URL；不会读取 `response.result.data`。
- `model/generation_task.go:22-93`
  - 兼容状态 `running/pending/success` 与 first-party `queued/running/succeeded` 并存。
  - 任务包含 `Source`、`UpstreamTaskID`、`Metadata`、审计关联和 first-party 路由快照字段。

## 端到端调用链

### A. Canvas 标准图片生成/编辑（当前 canonical image path）

```text
CanvasNodePromptPanel / ConfigNode
  -> handleGenerateNode(mode=image)
  -> buildNodeConfig + buildNodeGenerationContext + hydrateNodeGenerationContext
  -> 创建 loading image node，写 generationType/model/size/quality/count/references
  -> createAsyncImageTask 或 createAsyncImageEditTask
  -> remote: /api/v1/async/images/* + Bearer user token + X-Source: canvas
     local : buildApiUrl(user channel, /async/images/*) + user API key
  -> remote backend ProxyAIRequest
       -> readAIRequest / publicModelAllowed / ModelCost*n / SelectModelChannel
       -> LogTaskStart(status=running) + CreateGenerationTaskWithCharge/ConsumeUserCredits
       -> upstream async submit
       -> LogTaskCreated(upstreamTaskId), payload response audit
  -> frontend stores upstreamTaskId/taskModel in node metadata
  -> pollCanvasImageNode (5s, max 360)
  -> pollAsyncImageTask -> GET /api/v1/tasks/:upstreamTaskId
  -> remote backend ProxyAIGetRequest
       -> ownership lookup by upstreamTaskId
       -> upstream poll
       -> asyncImageTaskRef
       -> terminal: payload update + latency + arbitrateGenerationTerminalFrom
       -> failed/cancelled: one AI refund; succeeded: no extra fixed charge
  -> frontend parses data URL / external URL
  -> data URL: uploadBlob(..., "results/images")
     external URL: uploadUrlToS3(..., "results/images")
  -> imageMetadata(fileId/url/dimensions) -> setNodes
  -> updateProject -> local Replica -> queued backend Canvas sync
```

Important properties:

- One Canvas batch image child creates one upstream task because the code forces `count: "1"` per target.
- A direct completed response (`data[]` or `result.data[]`) skips polling in `pollAsyncImageTask`; in remote mode the proxy normally recognizes the same terminal shape during submit and finalizes immediately, while an unrecognized provider shape can still leave frontend observation and task-log state divergent.
- The internal platform task ID is returned by the backend in `X-Generation-Task-Id`, but `AsyncImageTask` currently keeps only the upstream task ID. The frontend does not preserve the internal ID for later metadata patching.
- `pollCanvasImageNode` does not call `cancelAsyncImageTask`; Stop Observing aborts the browser poll only.

### B. Canvas Retry / Resume / Cancel semantics

```text
handleRetryNode
  -> saved generation metadata (type/config/references)
  -> createAsyncImageTask/Edit again
  -> new upstream task ID

restoreProject
  -> resetInterruptedGeneration
  -> canvasGenerationResume
  -> pollCanvasImageNode(existing upstreamTaskId, taskModel)
```

- `Stop Observing` (`stopGenerationByRunningId`) aborts local polling and marks `generationPollingPaused`; it does not cancel upstream work.
- An image node with no `upstreamTaskId` after interruption is changed from loading to error by `resetInterruptedGeneration`; there is no image equivalent of first-party video `clientRequestId` recovery.
- `confirmCancelGeneration` is wired only when `generationCancellation` exists. That metadata is set by first-party video preparation, so ordinary image nodes do not expose a valid cancel path.

### C. Canvas mask/angle image tools (different path)

```text
maskEditImageNode / generateAngleNode
  -> requestEdit (synchronous /api/v1/images/edits or local upstream)
  -> first returned image
  -> uploadImage (browser localforage, storageKey)
  -> imageMetadata(storageKey, no platform fileId)
  -> setNodes/updateProject
```

These tools are not aligned with standard Canvas image generation:

- no async task ID or polling;
- no explicit `X-Source: canvas`;
- remote proxy can charge/log the synchronous request, but the node has no stable task association for metadata backfill;
- result is browser-local `storageKey`, not `results/images` platform `fileId`;
- retry/resume after a page/device change is not equivalent to standard async image nodes.

### D. Image workbench local mode

```text
ImagePage.generate
  -> pending localforage log
  -> N slots, each requestEdit/requestGeneration
  -> local direct upstream request
  -> parse result, readImageMeta
  -> uploadBlob(..., "results/images") after all slots finish
  -> final localforage log
  -> recordGenerationTask(status/credits=0, upstreamTaskId=dedupeKey)
  -> RecordUserTask upserts pending/final by dedupeKey
```

- No backend provider charge or proxy audit occurs in local mode.
- `recordGenerationTask` is an after-the-fact compatibility log, not a task that controls upstream work.
- Backend credits are intentionally `0`; this agrees with the local BYOK rule in the architecture document.

### E. Image workbench remote mode

```text
ImagePage.generate
  -> pending localforage log (no backend task yet)
  -> N concurrent slots, each requestEdit/requestGeneration
  -> /api/v1/images/generations or /api/v1/images/edits
  -> ProxyAIRequest
       -> one generation_tasks row + one consume log per slot
       -> synchronous upstream response
       -> LogTaskSuccess or LogTaskFailure + refund
  -> frontend readImageMeta and uploadBlob each successful image
  -> final saveLog
       -> fetchImageHistory(1,5,"image_workbench")
       -> find first same-model task without fileIds
       -> patchGenerationTaskMetadata(match.id, all batch fileIds)
```

Observed consequences:

- A batch of `N` images creates `N` remote backend tasks but one UI `GenerationLog`.
- Only one task is selected by `find`; other task rows can remain without `fileIds`.
- Matching by model and timestamp is not a stable public identity and is race-prone for concurrent batches or identical prompts/models.
- A remote failure is already settled by the proxy; the page only displays the error and does not perform a second refund.
- `requestGeneration`/`requestEdit` do not add `X-Source`; source is inferred from path (`image_workbench`) unless a browser Referer happens to contain `/canvas`.

## Behavior matrix

| Concern | Canvas standard image node | Canvas mask/angle tool | Image workbench local | Image workbench remote |
|---|---|---|---|---|
| Request entry | async create helpers | sync `requestEdit` | sync `requestGeneration/Edit` direct | sync `requestGeneration/Edit` through proxy |
| Endpoint | `/async/images/generations` or `/async/images/edits` | `/images/edits` | user channel `/async` is not used | `/api/v1/images/generations` or `/images/edits` |
| Polling | frontend 5s loop, resumable by upstream ID | none | none | none |
| Result materialization | `uploadBlob` / `uploadUrlToS3` to `results/images` | `uploadImage` to IndexedDB | `uploadBlob` to `results/images` after batch | `uploadBlob` to `results/images` after batch |
| Node/UI persistence | Canvas Replica + backend sync | Canvas Replica, local image bytes | localforage log + backend compatibility log | localforage log + proxy task; fileId patch is heuristic |
| Error source | async parser + proxy terminal state | request error | direct request error | proxy error/refund plus page error |
| Remote task log | one task per Canvas target | proxy sync task may exist, not linked | n/a | one proxy task per slot |
| Local task log | none | none | `recordGenerationTask`, credits `0` | n/a |
| Credit authority | backend proxy; consume on submit, refund on terminal failure | backend proxy for remote sync call | no platform charge | backend proxy |
| Model source | `useConfigStore` + public image list; node overrides | same | same global/effective config | same global/effective config |
| Stable model identity | raw model string | raw model string | raw model string | raw model string |
| Stop/Resume | stop observation only; resume if upstream ID remains | abort request only | no task observation | no task observation |
| Cancel upstream | not used | request abort only | axios abort only | axios abort only |

## Existing reusable helpers

Prefer these before adding new abstractions:

1. Request/protocol:
   - `createAsyncImageTask`
   - `createAsyncImageEditTask`
   - `pollAsyncImageTask`
   - `buildAsyncImageEditRequest`
   - `resolveImageRequestFormat`
2. Result/file:
   - `uploadBlob`
   - `uploadUrlToS3`
   - `resolveFileUrls`
   - `imageMetadata`
   - `readImageMeta`
3. Canvas state:
   - `buildNodeConfig`
   - `buildSavedImageConfig`
   - `buildNodeGenerationContext`
   - `canvasGenerationResume`
   - `useCanvasStore.updateProject` / `waitForLocalPersistence`
4. History/accounting:
   - `fetchImageHistory`
   - `recordGenerationTask`
   - `patchGenerationTaskMetadata`
   - backend `ProxyAIRequest`, `ProxyAIGetRequest`, `RecordUserTask`
   - backend `ApplyUserCreditLog`, `TransitionGenerationTaskTerminal`
5. Shared settings:
   - `fetchPublicSettings`
   - `useConfigStore.loadPublicSettings`
   - `resolveModelRequestConfig`
   - `requestCreditCost`

## Differences that need alignment

### Must align in this task

1. **Generation/polling behavior**: workbench should use the same async create/poll state machine as Canvas for image generation/editing, including immediate-completed responses, `pending/succeeded/failed`, bounded timeout, and Stop Observing semantics.
2. **Result materialization**: use the same data-vs-external-URL split (`uploadBlob` vs `uploadUrlToS3`) so signed provider URLs do not depend on browser CORS.
3. **Task identity**: every remote workbench slot needs the exact internal generation task ID and upstream task ID. Reusing `fetchImageHistory(...).find(...)` is not a reliable association seam.
4. **Remote logging authority**: remote paths must continue to let `ProxyAIRequest` own charge/refund/status; the frontend must enrich exact task metadata, not create a second remote task.
5. **Terminal log shape**: successful results, failed results, pending observation, response payload, error and platform `fileIds` need one predictable mapping for history refresh.
6. **Configuration snapshot**: workbench should snapshot the selected model, request format, Canvas endpoint mode (where relevant), size, quality, background and count before launching slots, as Canvas does.

### Keep explicit as intentional differences

1. `local` mode is BYOK and bypasses platform credits, proxy audit and server-side task orchestration by design. Do not add fake platform charges just to make local and remote look identical.
2. Canvas image nodes need node graph/layout/Replica behavior; the workbench needs a batch result grid and local session UI. Only the generation lifecycle/result contract should be shared.
3. Canvas mask/angle/crop/upscale tools are separate image-editing utilities. Moving all of them into the async workbench contract would widen scope without solving the main workbench mismatch.
4. First-party `/api/v1/generations` remains the future platform seam for images, but adding `image.generate`/`image.edit` Profiles and an `openai-images-v1` Adapter is not a minimal change for this task.

## Recommended minimal implementation boundary

### Smallest viable alignment

1. Keep `web/src/services/api/image.ts` as the image protocol seam.
2. Make the image workbench call the existing async create/poll helpers per slot in both local and remote modes; preserve local direct-channel behavior and remote proxy behavior.
3. Extract only the result materialization operation if duplication becomes unavoidable:
   - input: parsed image result;
   - output: `{ fileId, url, width, height, bytes, mimeType }`;
   - data URLs use `uploadBlob`;
   - HTTP URLs use `uploadUrlToS3`.
4. Extend the async task value minimally to carry both:
   - upstream task identity used for polling;
   - internal platform task identity (available today as `X-Generation-Task-Id` on proxy responses).
5. Patch exact remote task metadata with `fileIds`; do not search by model/time.
6. Keep Canvas node layout and Replica commits in `canvas/project/index.tsx`; keep workbench batch aggregation and UI logs in `image/index.tsx`.
7. Defer first-party image Profiles/Adapters unless the product requirement explicitly changes from “align existing workbenches” to “migrate images to the new Generation Orchestrator”.

### Alternative considered

- **Full first-party image migration**: add `IntentImageGenerate`/`IntentImageEdit`, image Model Profiles, an image Adapter, `FirstPartyGenerationResult.kind = images`, platform-side result persistence, and first-party client polling. This is architecturally cleaner but touches `model`, `service/generation_profiles.go`, `generation_orchestrator.go`, adapters, billing, result DTOs, frontend contracts, and tests. It is outside the minimal boundary because no image Profile/Adapter exists today.

## Candidate public test seams

### Existing seams worth preserving

- `web/src/services/api/image.test.mjs`
  - request format selection;
  - multipart file bytes from platform `fileId`;
  - JSON multi-reference order;
  - direct `b64_json` / `result.data[].url` completion;
  - nine-reference limit.
- `web/src/services/api/async-image-edit-form.test.mjs`
  - pure request body/form construction and transparent background.
- `web/src/pages/canvas/components/canvas-generation-resume.test.mjs`
  - image upstream task resume and first-party video identity distinction.
- `web/src/pages/canvas/components/canvas-node-generation.test.mjs`
  - platform file references and Canvas input compilation.
- `service/ai_proxy_test.go`
  - `TestProxyAsyncImageFailureRefundsAndFinalizesTask`;
  - `TestAsyncImageTaskRefAcceptsTopLevelImageData`;
  - request audit redaction, model/channel routing and API key normalization.
- `service/generation_lifecycle_test.go`
  - terminal arbitration, one-time refunds, callback/poll convergence (first-party baseline).
- `router/generations_integration_test.go`
  - authenticated HTTP task creation, ownership, idempotency and terminal error projection (first-party baseline).

### New seams for the alignment change

1. **Async slot runner seam (frontend)**: inject/create/poll/materialize callbacks and assert one create per slot, no second create during resume, and terminal result storage exactly once.
2. **Remote task identity seam (frontend/backend)**: submit one remote async image task, assert returned internal ID + upstream ID, then patch metadata by exact internal ID.
3. **Batch logging seam**: generate two successful and one failed slots; assert one UI batch log, three remote task rows, each task receives only its own `fileId`, and no duplicate refund.
4. **Nested result history seam**: finalize a response with `result.data[].url` or `result.data[].b64_json`; assert `ImageHistoryDTO` exposes a usable result or fileIds after metadata patch.
5. **Cross-origin materialization seam**: a successful provider URL that cannot be fetched by browser CORS must use `uploadUrlToS3`, not `fetch(url).blob()`.
6. **Canvas persistence seam**: after async image success, await `useCanvasStore.waitForLocalPersistence`; assert node metadata contains platform `fileId` and is preserved in the project payload.
7. **Local-mode accounting seam**: local generation records zero platform credits and never creates a proxy charge/refund; remote generation creates exactly one consume record per remote slot.

Per `tdd` guidance, these should be agreed public seams before implementation; do not test private React closures merely because they are convenient.

## Risks and uncertainties

1. **No server-side image recovery**: async image proxy tasks remain `running` and are not claimed by `StartGenerationWorker`; a browser that disappears after successful submit can leave a charged task without observation.
2. **Lost-create response**: unlike first-party video, image nodes have no client request id lookup. If `createAsyncImageTask` succeeds but metadata is not persisted, `resetInterruptedGeneration` eventually marks the node interrupted.
3. **Nested result history gap**: `service/generation_mapper.go:219-240` only extracts top-level `data`; async providers documented in `docs/image-generation-api.md` can return `result.data`, so history may show no image unless frontend fileId backfill succeeds.
4. **Remote batch race**: same-model/time matching in `image/index.tsx:419-422` can attach all batch fileIds to the wrong task or only the first of several tasks.
5. **Provider URL/CORS mismatch**: workbench `runGenerationSlot` calls `readImageMeta(image.dataUrl)` and later `fetch(image.dataUrl).blob()`; external signed URLs can fail in-browser even though Canvas has a backend proxy-upload path.
6. **Gemini async mismatch**: synchronous `requestGeneration/requestEdit` have Gemini-specific request construction, but `createAsyncImageTask/createAsyncImageEditTask` do not branch for Gemini and send OpenAI-shaped async bodies. Async Canvas support for Gemini is therefore unconfirmed.
7. **Reference snapshot expiry**: `buildImageGenerationMetadata.referenceUrl` prefers local storage key or URL, not `fileId`; a platform-backed source with an expiring presigned URL can make Retry Run references stale.
8. **Tool result locality**: mask/angle use `uploadImage` and do not produce platform file IDs, so they do not satisfy the `Materialized Result` definition for cross-device use.
9. **Cancellation ambiguity**: `cancelAsyncImageTask` exists but is unused; UI Stop is intentionally Stop Observing, while no image-specific user cancel path is wired.
10. **Deletion scope**: workbench log deletion collects `storageKey`, while generated platform results carry `fileId`; deleting a log may not delete the platform result file.
11. **Model identity remains raw string**: image model selection and `imageRequestFormats` are keyed by upstream model names, unlike video Model Profiles; renames/channel changes can invalidate saved image settings.

## Assumptions and rationale

- Assumed “对应的 Canvas 图片节点实现” means the standard async Canvas image path, because it is the only Canvas image path with explicit async task state, result-file materialization, task resume metadata and recent backend refund tests.
- Treated mask/angle as intentionally separate tools rather than the canonical image-generation runner; they are called out as a difference, not silently merged.
- Chose the existing compatibility async route as the minimum implementation target because it is already routed, billed, audited and tested. A first-party image Orchestrator migration remains an alternative, not an implicit recommendation.
- No new abstraction is justified until the workbench switches to the existing helpers; only result materialization and task identity are likely shared seams with immediate leverage.

## Verification performed

- Read `CONTEXT.md`; no `docs/adr/` directory exists in this checkout.
- Read `docs/architecture/generation-platform.md`, `docs/image-generation-api.md`, the relevant usage-log and backend-migration design docs, workflow acceptance/decisions/progress, and all directly relevant frontend/backend tests.
- Confirmed branch: `codex/align-generation-workbenches`.
- Prompt placeholder audit found one occurrence of `{{...}}`, but it is the literal placeholder-syntax mention inside the archived user instruction; there are no unresolved operational values.
- Frontend non-browser focused tests:
  - `bun test src/services/api/image.test.mjs src/services/api/async-image-edit-form.test.mjs src/pages/canvas/components/canvas-node-generation.test.mjs src/pages/canvas/components/canvas-generation-resume.test.mjs src/pages/canvas/components/canvas-node-config.test.ts`
  - Result: `31 pass, 0 fail`.
- Go non-browser pure proxy/parser checks:
  - `go test ./service -run 'Test(ReadAIRequestMultipart|AsyncImageTaskRefAcceptsTopLevelImageData|BuildGeminiUpstreamNonStreamImage|OpenAIAsyncImageAuthUsesNormalizedChannelKeyForSubmitAndPoll|MultipartRequestAuditOmitsFileBytes|TestSafeUpstreamTextTruncates)' -count=1`
  - Result: package passed.
- Did not run real browser tests, start a dev server, create a worktree/branch, or edit business source/tests/config/dependencies.
- Database-backed integration tests were inspected but not executed in this read-only investigation to avoid mutating the shared PostgreSQL state.

## Scope handoff

- Image workbench implementation owner: use the “Smallest viable alignment” section and preserve local/remote accounting boundaries.
- Shared config/log/accounting owner: the exact task identity seam and nested `result.data` history mapping are the highest-leverage shared contracts.
- Verification owner: prioritize the new batch identity, materialization, nested-result, and lost-observation cases before UI/browser validation.
