# canvas-workbench-map-resume 调查记录

## 状态

- 结果：`completed`
- 任务 slug：`canvas-workbench-map-resume`
- 角色：画布/生图工作台只读调查
- 执行模式：只读调查
- 并行波次/组：`wave-1` / `map-resume`
- 当前分支：`codex/image-resolution-config`
- 当前 HEAD / 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 实际读取 Skills：无
- Context7：未调用；本次只追踪仓库现有代码，没有需要核实的 React/Ant Design API
- 浏览器/服务：未运行、未启动
- 业务源码/测试/依赖/配置：未修改
- 实现阻塞项：用户原文中的“视频节点”与现有图片模型配置消费链不一致，进入实现前必须确认产品含义

## 结论摘要

1. 契约中的 `web/src/app/(user)/canvas` 是旧路径描述；当前 Vite 项目真实入口是
   `web/src/pages/canvas`，生图工作台是 `web/src/pages/image/index.tsx`。
2. “我的画布”里图片模型、图片尺寸/宽高比由 `CanvasNodeType.Image`，以及
   `CanvasNodeType.Config + generationMode: "image"` 消费；真实视频节点只选择视频模型。
3. 真实视频节点的分辨率和宽高比来自视频 `GenerationProfile.capabilities.settings`，
   值域是 `480p/720p/1080p` 与视频比例，不读取
   `imageRequestFormats`，也不选择图片模型。
4. 画布图片生成已经是异步任务链：
   创建 `/async/images/...` 任务 -> 写节点任务 ID -> 5 秒轮询 ->
   结果上传 S3 -> 写节点元数据 -> Canvas 本地持久化/后端同步。
5. 生图工作台当前仍是同步链：
   `requestGeneration/requestEdit` -> 等待响应 -> 结果上传 S3 -> 写日志；
   它没有使用 Canvas 的异步创建/查询 API，也不能按上游任务 ID恢复查询。
6. 两端都复用 `ImageSettingsPanel`、`ModelPicker`、`useAssetStore`、
   上传和历史 API；最小分辨率消费不应在画布和工作台各复制一套选项规则。
7. 最小工作台对齐应增加一个页面私有的纯异步任务 helper，并小幅扩展
   `services/api/image.ts`，而不是把轮询、取消和结果物化继续堆进 1100 行页面。
8. 本地另一条未合入分支 `codex/align-generation-workbenches` 上存在候选提交
   `f257446`。它验证了上述最小方向，但不是当前分支现状，且仍未完整解决刷新恢复、
   批量历史聚合和图片引用 `fileId` 保留，不能整提交照搬。

## 路径与入口

### 路由

- `web/src/router.tsx:65-68`
  - `/canvas` -> `web/src/pages/canvas/index.tsx`
  - `/canvas/:id` -> `web/src/pages/canvas/project/index.tsx`
  - `/image` -> `web/src/pages/image/index.tsx`
  - `/video` -> `web/src/pages/video/index.tsx`

### 共享设置与 API

- `web/src/stores/use-config-store.ts`
- `web/src/services/api/settings.ts`
- `web/src/services/api/image.ts`
- `web/src/services/api/generation-tasks.ts`
- `web/src/services/upload-blob.ts`
- `web/src/services/blob-storage.ts`
- `web/src/stores/use-asset-store.ts`

## “创建对应视频节点”核实

### 代码事实

`web/src/pages/canvas/types.ts:12-23` 定义：

```ts
CanvasNodeType.Image = "image"
CanvasNodeType.Video = "video"
CanvasGenerationMode = "text" | "image" | "video" | "audio"
```

真实节点创建：

- 底部工具栏：
  `CanvasToolbar.onAddImage/onAddVideo` ->
  `web/src/pages/canvas/project/index.tsx:3219-3220`
  -> `createNode`（942-961）
  -> `createCanvasNode`（141-157）。
- 连接拖放菜单：
  `ConnectionCreateMenu`（206-254） ->
  `createConnectedNode`（743-761）。

普通节点的模式由节点类型固定：

- `web/src/pages/canvas/components/canvas-node-prompt-panel.tsx:233-235`
  - Image -> `"image"`
  - Video -> `"video"`
  - Audio -> `"audio"`
  - Text -> `"text"`

因此：

- 图片节点渲染 `ModelPicker capability="image"` 和
  `CanvasImageSettingsPopover`（154-165）。
- 视频节点渲染 `ModelPicker capability="video"` 和
  `CanvasVideoSettingsPopover`（166-182）。
- 只有 Config 节点能通过 Segmented 在 image/video 等模式间切换：
  `web/src/pages/canvas/components/canvas-config-node-panel.tsx:79-122`。

### 视频节点实际配置来源

`web/src/components/video-settings-panel.tsx:38-78`：

1. 以 `config.model || config.videoModel` 查询 `GenerationProfile`。
2. 分辨率可见性由
   `profile.capabilities.settings.resolution.values` 决定。
3. 比例可见性由
   `profile.capabilities.settings.aspectRatio.values` 决定。
4. 没有 profile 时回退
   `seedanceRatioOptions` 与 `seedanceResolutionOptions`。

视频值域位于 `web/src/lib/seedance-video.ts`：

- 分辨率：`480p`、`720p`、`1080p`（15-19）。
- 比例：`16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9`、
  `adaptive`（21-29）。

图片模型配置位于公开
`public.modelChannel.imageRequestFormats`，当前仅由图片请求服务消费。
视频节点没有图片模型选择，也没有从图片模型推导视频比例的调用链。

### 产品含义结论

原文存在无法由代码消除的冲突：

| 原文字段 | 当前代码对应 |
| --- | --- |
| “图片模型允许使用的分辨率” | 图片节点 / Config 图片模式 / 生图工作台 |
| “创建对应视频节点、选择对应模型” | 视频节点 / Config 视频模式 / 视频模型 profile |
| “用户可见的宽高比可选项” | 图片面板和视频面板都有，但来源完全不同 |

进入实现前需要在以下两种含义中确认一种：

1. **很可能的笔误：目标是图片节点。**
   新字段直接过滤 `ImageSettingsPanel` 的图片宽高比选项；数据契约和页面结构一致。
2. **按字面目标是视频节点。**
   则新字段不应挂在“图片请求格式/图片模型”上；应扩展视频 generation profile
   的 capabilities，或明确图片模型怎样关联某个视频模型。现有代码没有该关联。

本调查不会擅自把“视频节点”改成“图片节点”。以下分辨率映射和写入边界以
“产品确认目标为图片节点/图片生成配置”为前提；若确认字面视频节点，应停止该方案。

## 配置与状态结构

### 全局 AI 配置

`web/src/stores/use-config-store.ts:23-56` 的 `AiConfig` 关键字段：

```ts
{
    channelMode: "remote" | "local";
    model: string;
    imageModel: string;
    videoModel: string;
    imageRequestFormats: ImageRequestFormatSetting[];
    imageModels: string[];
    videoModels: string[];
    quality: string;
    size: string;
    background: "" | "transparent";
    count: string;
    canvasImageCount: string;
}
```

默认值（74-116）：

- `quality: "auto"`
- `size: "1:1"`
- `count: "1"`
- `canvasImageCount: "3"`

持久化：

- key：`infinite-canvas:ai_config_store`（67）。
- Zustand `persist` 保存 `config` 与 `webdav`（203-337）。
- 公开配置始终进入 `publicSettings`。
- 仅后台强制远程模式时，
  `loadPublicSettings` 才把 `imageRequestFormats` 复制进 `AiConfig`
  （227-279）。

配置调查 Subagent 已建议把单选字段
`resolution: "default" | "1k" | "2k" | "4k"`
直接加到现有 `ImageRequestFormatSetting`，而不是新建第二份模型映射。

### Canvas 节点状态

`web/src/pages/canvas/types.ts:25-75` 的 `CanvasNodeMetadata` 关键字段：

```ts
{
    status?: "idle" | "success" | "loading" | "error";
    generationType?: "generation" | "edit";
    model?: string;
    size?: string;
    quality?: string;
    background?: "" | "transparent";
    count?: number;
    upstreamTaskId?: string;
    taskModel?: string;
    generationTaskId?: string;
    generationTaskStatus?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    generationPollingPaused?: boolean;
    content?: string;
    fileId?: string;
    storageKey?: string;
    naturalWidth?: number;
    naturalHeight?: number;
    bytes?: number;
    mimeType?: string;
    references?: string[];
}
```

节点配置合成：

- `web/src/pages/canvas/components/canvas-node-config.ts:5-25`
  `buildNodeConfig(globalConfig, defaults, node, mode)`。
- 节点 `metadata.model/size/quality/background/count` 优先，
  缺失才回退全局配置。
- `buildSavedImageConfig`（28-37）让图片重试使用生成时保存的模型、尺寸、
  质量和背景快照。
- `handleConfigNodeChange`（project/index.tsx:1702-1704）
  -> `applyNodeConfigPatch`（3658-3664）
  -> 写回节点 metadata；空图片/视频节点改变 `size` 时会同步调整节点显示比例。

### 生图工作台状态

`web/src/pages/image/index.tsx:34-75`：

- `GeneratedImage`：结果 URL、`fileId/storageKey`、尺寸、字节、耗时。
- `GenerationResult`：`pending/success/failed` UI 槽位。
- `GenerationLog`：prompt、model、配置快照、引用、状态、图片数组、统计。
- `GenerationLogConfig` 当前只保存
  `model/imageModel/quality/size/count`。

页面状态（89-117）：

- prompt、references、results、logs、running。
- model 来源是 `effectiveConfig.imageModel || effectiveConfig.model`。
- 工作台生成张数限制为 1-10；画布允许 1-15。

## 用户可见分辨率/宽高比映射

### 当前图片选项

`web/src/components/image-settings-panel.tsx:12-44`：

质量按钮：

- `auto`
- `high`
- `medium`
- `low`

宽高比/尺寸按钮：

- 基础组：
  `1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`16:9`、`9:16`
- 2K 组：
  `1:1(2k)` -> `2048x2048`
  `16:9(2k)` -> `2048x1152`
  `9:16(2k)` -> `1152x2048`
- 4K 组：
  `16:9(4k)` -> `3840x2160`
  `9:16(4k)` -> `2160x3840`
- 自动：
  `auto`

此外面板还有自由宽/高输入，并能写入任意通过 API 校验的
`<width>x<height>`。

`web/src/services/api/image.ts:119-205` 还会把：

- `low` 当作约 1K 像素预算
- `medium` 当作约 2K 像素预算
- `high` 当作约 4K 像素预算
- 比例字符串转换为显式像素尺寸

因此“质量”“宽高比按钮”“自由宽高输入”是三条独立输入路径。

### 推荐的最小可见选项映射

配置调查已建议 `resolution` 为单选，并让 `"default"` 保持现有行为。
在该契约下，推荐：

| 配置值 | 用户可见的宽高比/尺寸按钮 |
| --- | --- |
| `default` | 不过滤，保留当前全部 13 个按钮 |
| `1k` | `1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`16:9`、`9:16` |
| `2k` | `1:1(2k)`、`16:9(2k)`、`9:16(2k)` |
| `4k` | `16:9(4k)`、`9:16(4k)` |

理由：

- 与现有 `aspectOptions` 的自然分组一一对应。
- `"default"` 不改变未配置/旧配置模型的已有功能。
- 不创造仓库里不存在的 2K/4K 比例或像素值。
- 能在一个共享组件内同时服务 Canvas 图片节点和生图工作台。

备选的严格解释是：

- `default` 只显示 `auto`。

该解释会使所有缺失字段的已有模型从 13 个选项退化成 1 个，风险较高，
不建议在没有产品确认时采用。

### 该映射不是实际请求限制

只过滤按钮仍有三类绕过：

1. `quality=high/medium/low` 会改变比例字符串对应的实际像素预算。
2. 自由宽高输入仍可写入 2K/4K 或其他合法尺寸。
3. 切换模型后，节点或全局 `config.size` 可能保留一个已被隐藏的旧值，
   生成时仍会发送它。

如果“允许使用的分辨率”是强约束，而不只是“用户可见选项”，还需要：

- 在模型切换或面板接收新 tier 时归一化隐藏的旧 `size`。
- 定义质量按钮是否同时过滤/锁定。
- 定义自由尺寸输入是否隐藏、禁用或按 tier 校验。
- 最好在 `resolveRequestSize` 前再做请求级验证，避免 UI 旁路。

这些规则不能从需求原文和当前代码唯一推导，应由产品确认；最小实现仅处理原文明确提到的
“用户可见宽高比可选项”。

## Canvas 图片生成调用链

### 1. 选择模型与设置

普通图片节点：

1. `CanvasNodePromptPanel`（41）。
2. `defaultMode(Image)` -> `"image"`（233-235）。
3. `buildNodeConfig` 合并全局配置和节点 metadata。
4. `ModelPicker capability="image"`（154-157）。
5. `CanvasImageSettingsPopover`（157-164）。
6. `ImageSettingsPanel`（canvas-image-settings-popover.tsx:123-126）。
7. `onConfigChange` -> `handleConfigNodeChange` ->
   `applyNodeConfigPatch` -> 节点 metadata。

Config 图片模式：

1. `CanvasConfigNodePanel`（32）。
2. `node.metadata.generationMode || "image"`（38）。
3. Segmented 切换 image/video/text/audio（79-122）。
4. image 模式同样使用 `ModelPicker capability="image"` 与
   `CanvasImageSettingsPopover`（137-162）。

### 2. 生成请求

入口：

- `handleGenerateNode`
  `web/src/pages/canvas/project/index.tsx:2188-2562`。

图片分支（2221-2350）：

1. `buildNodeConfig` 得到本次 config。
2. `buildNodeGenerationContext` + `hydrateNodeGenerationContext`
   收集提示词和连接的图片引用。
3. 有图片引用时 `generationType="edit"`，否则 `"generation"`。
4. `buildImageGenerationMetadata`（3567-3577）保存：
   model、size、quality、background、count、references。
5. 先创建 loading 的根图片节点/批量子节点。
6. 每个输出单独创建任务，始终 `count: 1`：
   - 纯生成：
     `createAsyncImageTask`
   - 有引用：
     `createAsyncImageEditTask`
7. 把 `task.id` 和 `task.model` 写入目标节点：
   `upstreamTaskId/taskModel`。
8. 后台调用 `pollCanvasImageNode`。

API：

- `createAsyncImageTask`
  `web/src/services/api/image.ts:932-956`
  -> `POST /async/images/generations`。
- `createAsyncImageEditTask`
  `web/src/services/api/image.ts:958-988`
  -> 根据 `canvasRequestMode` 使用
  `/async/images/edits` 或 `/async/images/generations`。
- 远程模式 URL 为 `/api/v1/...`；本地模式直接请求渠道地址。
- 当前 `X-Source` 固定为 `"canvas"`。
- `readAsyncImageTask` 支持提交接口直接返回已完成图片，避免重复查询。

### 3. 查询/轮询

`pollCanvasImageNode`
`web/src/pages/canvas/project/index.tsx:2699-2750`：

1. 创建 `AbortController` 并登记生成请求。
2. 最多 360 次。
3. 每次 `pollAsyncImageTask`。
4. pending 后等待 5000ms。
5. 总上限约 30 分钟。
6. succeeded：
   - data URL -> `uploadBlob(..., "results/images")`
   - URL -> `uploadUrlToS3(..., "results/images")`
7. `fitNodeSize` 按真实图片比例计算显示尺寸。
8. `imageMetadata` 写入：
   content、fileId/storageKey、status、naturalWidth/Height、bytes、mimeType。
9. failed/timeout 写 `status: error` 和 `errorDetails`。

`pollAsyncImageTask`
`web/src/services/api/image.ts:990-1021`：

- `GET /tasks/:id?model=...`
- 识别 backend envelope error、failed/cancelled、completed、top-level/result data。

停止/恢复：

- `stopGenerationByRunningId` 中止本地查询并把可恢复节点标记
  `generationPollingPaused: true`（447-460）。
- `canvasGenerationResume`
  `web/src/pages/canvas/components/canvas-generation-resume.ts`
  从 `upstreamTaskId/taskModel` 还原图片任务描述。
- `resumeGenerationQuery`（476-492）支持用户手动恢复。
- `restoreProject` 后 `resumePendingGenerations`（539-588）会自动恢复
  `status=loading` 的任务。
- `cancelAsyncImageTask` 存在，但普通 Canvas 图片 UI 当前停止的是查询；
  远端图片任务取消不是普通节点的显式操作。

### 4. Canvas 结果持久化

页面状态写入：

- 所有 `setNodes` 变化由 effect
  `web/src/pages/canvas/project/index.tsx:631-634`
  调用 `updateProject(projectId, { nodes, ... })`。

Canvas store：

- `web/src/pages/canvas/stores/use-canvas-store.ts`
- 项目包含 nodes/connections/chat/viewport 等（16-31）。
- account-scoped localforage，key
  `infinite-canvas:canvas_store`（55-71）。
- `updateProject` 先更新 Zustand，再等待本地持久化（190-197）。
- store subscription 触发 `canvas-sync.ts` 后端同步（286-293）。
- 后端保存完整 project JSON 到 `/api/v1/canvas/projects`。

结果文件：

- `uploadBlob` -> `POST /api/v1/files`，返回 `fileId` 和 URL。
- `uploadUrlToS3` -> `POST /api/v1/files/proxy-upload`。
- 打开项目时 `hydrateCanvasImages`（3613-3629）用 `fileId`
  刷新预签名 URL，或从 IndexedDB `storageKey` 还原本地 blob。

### 5. Canvas 保存到“我的素材”

`saveNodeAsset`
`web/src/pages/canvas/project/index.tsx:1727-1787`：

- 图片节点必须已有 content。
- 写入 image asset：
  dataUrl/storageKey/fileId/真实尺寸/bytes/mimeType。
- `useAssetStore.addAsset` 负责真正保存。

`web/src/stores/use-asset-store.ts:71-93`：

- 先 `saveAssetToLibrary` 写后端。
- 后端 ID 为最终 ID。
- 本地 Zustand/localforage 只作缓存。
- store key：`infinite-canvas:asset_store`。

## 生图工作台现有调用链

### 1. 模型与设置

`web/src/pages/image/index.tsx:739-754`：

- `ModelPicker capability="image"`
- 选择写全局 `config.imageModel`
- 复用同一个 `ImageSettingsPanel`
- 设置写全局 `quality/size/background/count`

这与 Canvas 的差别：

- Canvas 写节点 metadata，是节点级配置快照。
- 工作台写全局 AI config，是跨页面持久设置。

### 2. 生成

`generate`
`web/src/pages/image/index.tsx:192-280`：

1. 校验 prompt 和 AI config。
2. `buildRequestSnapshot` 保存本次 model/config/references。
3. 先创建一个 batch pending log。
4. 根据 `generationCount` 并行运行多个 `runGenerationSlot`。
5. 等待 `Promise.allSettled`。
6. 所有成功图片再统一上传 S3。
7. 写 final log。

`runGenerationSlot`
`web/src/pages/image/index.tsx:534-548`：

- 无引用 -> `requestGeneration`
- 有引用 -> `requestEdit`
- 两者都是同步请求，不返回可恢复任务 ID。
- 请求完成后读取图片 meta，写 result success。
- 没有轮询循环、AbortController、远端取消或刷新恢复。

同步 API：

- `requestGeneration`
  `web/src/services/api/image.ts:812-844`
  -> `/images/generations`
- `requestEdit`
  `web/src/services/api/image.ts:846-896`
  -> `/images/edits`
- Gemini 另走 `generateContent`/backend compatibility body。

### 3. “查询”现状

工作台没有查询上游图片任务。

现有两类“查询”容易混淆：

1. `syncScheduler.onRunningTaskCountChange(1)` 让全局 tasks domain
   更频繁同步，但它只刷新后端日志，不查询上游图片结果。
2. `refreshLogs` 调用
   `fetchImageHistory(..., "image_workbench")`，只查询已记录的历史。

后端返回 pending 日志时，页面只显示 pending；
`ImageHistoryItem` 当前不包含 `upstreamTaskId`，
页面无法像视频工作台或 Canvas 一样恢复上游轮询。

### 4. 结果保存

自动结果物化：

- `generate` 完成后把每张图片 fetch 成 blob。
- `uploadBlob(..., "results/images")` 上传 S3。
- 结果 state 回填 `fileId`。
- `saveLog` 记录 fileIds。

历史：

- localforage instance：
  database `infinite-canvas`
  + account-scoped store
  `image_generation_logs`（80-84）。
- `saveLog` 先写 local cache（374-376）。
- 登录用户的 `refreshLogs` 以
  `GET /api/v1/generation-tasks?task_type=image&source=image_workbench`
  为 source of truth（432-459）。
- 远程同步请求由 backend proxy 自动建立 generation task；
  页面当前再用“最近 5 条 + model/createdAt”启发式查找任务并 patch fileIds
  （413-427），不是稳定任务身份。
- 本地渠道由页面 `recordGenerationTask` 写入后端。

保存到素材：

- `saveResultToAssets`（297-337）。
- 已有 `fileId` 时复用；否则重新上传。
- 最终调用同一个 `useAssetStore.addAsset`。

### 5. 图片引用持久身份差异

Canvas 引用会保留 `ReferenceImage.fileId`：

- `canvas-node-generation.ts:289-298`
- `project/index.tsx:3720-3731`

工作台当前上传引用时：

- `uploadBlob` 返回 `fileId`
- 但代码把它写进 `ReferenceImage.storageKey`
  （image/index.tsx:158-185）
- 没有写 `fileId`

从素材插入时，`InsertAssetPayload` 明明带 `fileId`，
工作台仍调用 `uploadImage` 写本地 IndexedDB，丢掉平台文件身份
（339-347）。

把生成结果重新作为引用时，也调用 `uploadImage`，同样不保留原 `fileId`
（291-295）。

这会让工作台编辑请求无法复用 Canvas 已有的
`referenceImageToFile(fileId)` 鉴权下载路径，也是“保存/引用逻辑未对齐”的一部分。

## Canvas 与工作台差异表

| 行为 | Canvas 图片节点 | 生图工作台当前 |
| --- | --- | --- |
| 模型配置作用域 | 节点 metadata | 全局 config |
| 设置 UI | `ImageSettingsPanel` | 同一个 `ImageSettingsPanel` |
| 生成接口 | `/async/images/...` | `/images/...` |
| 每张输出 | 独立 async task | 独立同步请求 |
| task ID | 写 `upstreamTaskId/taskModel` | 不保存 |
| 查询 | 5 秒轮询，约 30 分钟 | 无上游轮询 |
| 立即完成响应 | 支持 | 同步响应本身即结果 |
| 停止 | 中止查询，可恢复 | 主按钮运行时禁用 |
| 远端取消 | API helper 存在，图片节点未显式使用 | 无 |
| 刷新恢复 | 自动/手动恢复 | 无 |
| URL 结果物化 | backend proxy-upload | browser fetch 后 uploadBlob，可能受 CORS 影响 |
| data URL 物化 | uploadBlob | uploadBlob |
| 结果配置快照 | 节点 metadata | GenerationLog.config |
| 历史 | Canvas project JSON | localforage + generation_tasks |
| 平台 task 身份 | 节点保存上游 ID | remote history patch 依赖启发式 |
| 结果保存到素材 | 显式按钮 | 显式按钮 |
| 引用 fileId | 保留 | 多条路径丢失 |
| 批量上限 | 15 | 10 |

## 可复用 helper / seam

### 已存在且应直接复用

- `ImageSettingsPanel`
  `web/src/components/image-settings-panel.tsx`
- `ModelPicker`
  `web/src/components/model-picker.tsx`
- `buildNodeConfig` / `buildSavedImageConfig`
  `web/src/pages/canvas/components/canvas-node-config.ts`
- `createAsyncImageTask`
  `web/src/services/api/image.ts`
- `createAsyncImageEditTask`
- `pollAsyncImageTask`
- `cancelAsyncImageTask`
- `uploadBlob` / `uploadUrlToS3`
  `web/src/services/upload-blob.ts`
- `patchGenerationTaskMetadata`
  `web/src/services/api/generation-tasks.ts`
- `resolveFileUrls`
- `useAssetStore.addAsset`
- `canvasGenerationResume`
- `ReferenceImage.fileId`

### 不建议直接抽取

- 不建议把 `pollCanvasImageNode` 从 3700 行 Canvas 页面直接搬到工作台。
  它强耦合 `setNodes`、批量根节点、Canvas 尺寸和 config-node 状态。
- 应抽取的是不含 UI/store 的“创建任务 + 完成任务”生命周期。

## 最小对齐方案

### A. 分辨率消费（仅在确认目标是图片节点后）

依赖 config-admin 提供：

```ts
ImageRequestFormatSetting.resolution:
    | "default"
    | "1k"
    | "2k"
    | "4k"
```

最小实现：

1. 在 `ImageSettingsPanel` 内按当前 `config.model` 查找对应
   `config.imageRequestFormats` 项。
2. `default` 或未匹配模型时保持当前全部选项。
3. 其他 tier 按本文映射过滤 `aspectOptions`。
4. 同一组件被 Canvas 图片节点、Config 图片模式和生图工作台复用，
   避免三处复制规则。
5. 若要求防止隐藏旧值继续提交，在该组件或一个纯 resolver 中归一化
   `config.size`；不要在 `project/index.tsx` 再造一套。
6. 本地自定义渠道建议不应用后台公开限制；匹配时使用原始
   `modelOptionName`，并以 `channelMode === "remote"` 为门槛。

建议把选项解析做成公开纯函数，仍放在同一组件文件即可，避免新建无必要模块：

```ts
visibleImageAspectOptions(resolution)
normalizeImageSizeForResolution(resolution, currentSize)
```

### B. 生图工作台异步对齐

建议新增页面私有 helper：

- `web/src/pages/image/image-async-task.ts`

公开两个 seam：

```ts
createImageWorkbenchTask(config, prompt, references)
completeImageWorkbenchTask(task, dependencies)
```

职责：

1. 有引用时调用 `createAsyncImageEditTask`，否则
   `createAsyncImageTask`。
2. source 明确传 `"image_workbench"`。
3. 保存上游 task ID 和 backend platform generation task ID。
4. 最多 360 次、每 5 秒 poll，保持与 Canvas 一致。
5. 支持 AbortSignal、best-effort cancel。
6. succeeded 时调用注入的 materialize：
   - data URL -> `uploadBlob`
   - URL -> `uploadUrlToS3`
7. 用 platform task ID 精确 patch `{ fileIds }`，删除当前
   “最近 5 条任务”启发式。

`web/src/services/api/image.ts` 最小扩展：

- `AsyncImageTask` 增加 `platformTaskId?: string`
- `createAsyncImageTask(..., source = "canvas")`
- `createAsyncImageEditTask(..., source = "canvas")`
- 从响应头 `X-Generation-Task-Id` 读取 platform task ID
- 默认 `"canvas"` 保持 Canvas 调用方零改动

`web/src/pages/image/index.tsx`：

- `runGenerationSlot` 改用 helper。
- 每个 slot 保存 controller/task。
- 运行时按钮变为可点击取消，不使用 Ant Button `loading`
  阻断点击。
- 成功结果已经是 S3 `fileId`，删除第二次统一上传。
- remote `saveLog` 不再用最近任务启发式 patch。
- 引用上传、素材插入、结果转引用时保留 `ReferenceImage.fileId`。

### C. 刷新恢复的范围选择

上面的最小方案只对齐“当前页面会话内”的创建、查询、物化和保存。

若验收要求与 Canvas 一样刷新后继续：

1. `GenerationLog` 需保存每个 slot 的上游 task 描述。
2. batch count > 1 时要保存 `tasks[]`，不能只有一个 task。
3. `serializeLog/normalizeLog` 必须 round-trip task 信息。
4. `refreshLogs` 后应像视频工作台的 `resumePendingLogs` 一样恢复。
5. 后端 `ImageHistoryDTO` 当前不返回 upstream task ID；
   跨设备恢复需要扩展 DTO，或明确只支持本机 localforage 恢复。

这是比候选提交 `f257446` 更完整的 Canvas parity，必须在实现范围中明确。

## 建议的互不重叠写入边界

### config-admin 单点拥有

沿配置调查结论：

- `model/setting.go`
- `service/settings.go`
- `service/settings_test.go`
- `web/src/services/api/admin.ts`
- `web/src/services/api/settings.ts`
- `web/src/pages/admin/settings/index.tsx`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`
- `web/test/admin-settings.test.tsx`
- 可选 `web/src/stores/use-config-store.test.ts`

### canvas-resolution / shared image settings 单点拥有

在确认目标是图片节点后：

- `web/src/components/image-settings-panel.tsx`
- 建议新增或补充
  `web/src/components/image-settings-panel.test.tsx`
- 如纯函数拆文件，文件也归此角色独占

尽量不改：

- `web/src/pages/canvas/project/index.tsx`
- `web/src/pages/canvas/components/canvas-node-prompt-panel.tsx`
- `web/src/pages/canvas/components/canvas-config-node-panel.tsx`

共享 `ImageSettingsPanel` 已能同时覆盖两个 Canvas 图片入口。

如果产品确认目标是字面视频节点，以上边界作废，应重新调查/分配：

- `web/src/components/video-settings-panel.tsx`
- generation profile capabilities/types/tests

### workbench-alignment 单点拥有

- `web/src/pages/image/index.tsx`
- 新增 `web/src/pages/image/image-async-task.ts`
- 新增 `web/src/pages/image/image-async-task.test.mjs`
- 可选页面取消按钮/引用身份测试
- `web/src/services/api/image.ts`
- `web/src/services/api/image.test.mjs`

该角色不应修改：

- `web/src/components/image-settings-panel.tsx`
- `web/src/pages/canvas/**`
- admin/settings/backend 配置文件

### integration/closer

- 协调共享类型完成后的消费顺序。
- 决定是否吸收本地候选提交 `f257446` 的局部实现。
- 不应整提交 cherry-pick `f257446`；它包含另一个 workflow 和大量后端/视频改动。
- 统一更新 docs/progress/CHANGELOG。

## 候选 TDD 公开 seams

用户尚未确认写测试，本调查没有新增测试。以下只列候选。

### 1. 图片分辨率到可见选项

建议 seam：

```ts
visibleImageAspectOptions(resolution)
```

候选断言：

- `default` 返回全部当前选项，顺序不变。
- `1k` 只返回 7 个基础比例。
- `2k` 精确返回
  `2048x2048/2048x1152/1152x2048`。
- `4k` 精确返回
  `3840x2160/2160x3840`。
- 非法/缺失值按 `default`。

### 2. 隐藏旧值归一化

建议 seam：

```ts
normalizeImageSizeForResolution(resolution, currentSize)
```

候选断言：

- 合法 currentSize 保持。
- 从 4k 模型切到 2k 模型不会继续提交 4k。
- 尽量保留 landscape/portrait/square 方向。
- `default` 不改已有自定义尺寸。

### 3. 画布配置快照

已有公开 seam：

- `buildNodeConfig`
- `buildSavedImageConfig`

候选断言：

- 节点模型覆盖全局图片模型。
- 切换模型后的 normalized size 写入节点 metadata。
- retry 继续使用当时的模型/tier/size，不被当前全局设置污染。

### 4. 异步图片 API

已有公开 seam：

- `createAsyncImageTask`
- `createAsyncImageEditTask`
- `pollAsyncImageTask`

候选断言：

- 默认 source 仍是 `canvas`。
- 工作台 source 是 `image_workbench`。
- 正确区分 upstream task ID 与 platform task ID。
- AxiosHeaders 和普通对象两种响应头都能读取。
- immediate completed response 不发 GET。
- URL、b64、backend envelope、failed/cancelled 均正确映射。

### 5. 工作台任务生命周期

建议 seam：

```ts
createImageWorkbenchTask(...)
completeImageWorkbenchTask(...)
```

候选断言：

- 无引用走 generation，有引用走 edit。
- pending -> succeeded -> materialize -> patch exact platform task。
- URL 使用 proxy upload，data URL 使用 blob upload。
- failed 不 materialize。
- timeout 触发 best-effort cancel。
- AbortSignal 触发 best-effort cancel 并抛 AbortError。
- patch metadata 失败是否阻断结果需明确；建议不丢失已生成结果。

### 6. 工作台引用身份

建议纯 helper：

```ts
referenceFromUploadedFile(...)
referenceFromAssetPayload(...)
referenceFromGeneratedImage(...)
```

候选断言：

- `fileId` 不再塞进 `storageKey`。
- 素材/生成结果转引用保留 `fileId`。
- 本地 IndexedDB 图片仍保留 `storageKey`。

### 7. 刷新恢复（若纳入）

建议公开 seam：

```ts
resumableImageWorkbenchTasks(log)
```

候选断言：

- pending batch 的所有 slot round-trip。
- 已成功/失败 slot 不重复查询。
- 同一 log 不并发启动两次 poll。
- backend 无 upstream ID 时明确为不可恢复，而不是创建新任务。

### 8. 页面行为

页面层可沿用仓库 happy-dom 测试方式：

- running 时生成按钮仍可点击，并显示取消。
- 取消不会因为 Ant Button `loading` 被禁用。
- 单个 slot 失败不清除其他成功结果。
- 工作台 maxCount 仍为 10。
- 保存素材复用已有 `fileId`。

## 现有测试落点

直接相关：

- `web/src/pages/canvas/components/canvas-node-config.test.ts`
- `web/src/pages/canvas/components/canvas-generation-resume.test.mjs`
- `web/src/pages/canvas/components/canvas-node-generation.test.mjs`
- `web/src/pages/canvas/components/canvas-image-background.test.mjs`
- `web/src/services/api/image.test.mjs`
- `web/src/services/api/async-image-edit-form.test.mjs`
- `web/src/components/video-settings-panel.test.tsx`
- `web/src/stores/use-config-store.test.ts`
- `web/test/canvas-durable-save.test.ts`
- `web/test/canvas-sync.test.ts`
- `web/test/admin-settings.test.tsx`

明显缺口：

- 当前没有 `ImageSettingsPanel` 分辨率/比例过滤测试。
- 当前没有 `ImagePage` 生成生命周期测试。
- 当前没有工作台图片任务取消/超时/恢复测试。
- 当前没有图片工作台引用 `fileId` 保留测试。

## 本地未合入候选实现

本地 branch：

- `codex/align-generation-workbenches`
- commit：`f257446ef36066d7f63f6e3f295fb1dbb7d3b936`

与本调查一致的部分：

- 新增 `web/src/pages/image/image-async-task.ts`
- 新增生命周期测试
- `services/api/image.ts` 增加 source 参数和 platformTaskId
- `ImagePage` 改为异步 create/poll/materialize
- 运行按钮改为取消

仍需修正/确认：

- 未实现 Image Workbench 刷新恢复。
- batch 历史仍可能从一个本地批次变成多个 backend task 行。
- 没有修复工作台引用 `fileId` 丢失。
- helper 中有未国际化的英文错误。
- `responseHeader` 在 helper 中重复且未使用。
- commit 同时包含另一个 workflow、后端和视频改动，超出本任务可直接吸收范围。

因此该 commit 可作为 TDD 和最小结构参考，不能当成当前代码或完整答案。

## 聚焦验证

执行：

```text
bun test \
  src/pages/canvas/components/canvas-node-config.test.ts \
  src/pages/canvas/components/canvas-generation-resume.test.mjs \
  src/services/api/image.test.mjs \
  src/components/video-settings-panel.test.tsx
```

结果：

- `17 pass`
- `0 fail`
- 覆盖节点配置快照、图片/视频任务恢复描述、异步图片创建/编辑/轮询解析、
  视频设置共享行为。

只读结构检查：

- 当前分支：`codex/image-resolution-config`
- HEAD：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- tracked diff：空
- staged diff：空
- 工作区只有 workflow 目录未跟踪
- prompt 占位符扫描仅命中协议正文中的双花括号字面示例

未执行：

- build / tsc / format
- 服务启动
- 真实浏览器
- 外部 Web 搜索

## 风险与残余不确定项

1. **图片/视频节点语义冲突**：这是实现前的首要产品阻塞。
2. **单选/多选**：配置调查推荐单选 `resolution`；若要同时开放多组，
   数据契约和 UI 都要改为数组。
3. **default 语义**：本文推荐“不过滤”；`auto only` 需要明确确认。
4. **可见性不等于限制**：质量和自由尺寸输入可绕过按钮过滤。
5. **隐藏旧值**：模型切换后若不归一化，仍可能提交不可见尺寸。
6. **本地同名模型**：后台公开规则不应意外限制本地自定义渠道。
7. **异步 provider 兼容**：工作台改走 Canvas async API 后，会继承 Canvas 对渠道
   `/async/images/...` 支持的要求，尤其要覆盖 Gemini/local channel。
8. **平台/上游 task ID**：必须分开保存，不能用 platform ID 查询上游 `/tasks/:id`。
9. **批量历史**：Canvas 每张图一任务；工作台当前一批一日志，需明确后台展示粒度。
10. **刷新恢复**：当前 ImageHistoryDTO 无 upstream ID，完整跨设备恢复需要后端契约。
11. **取消语义**：`cancelAsyncImageTask` 是 best-effort；UI 应区分停止查询与取消上游。
12. **结果物化失败**：上游已成功但 S3 上传失败时，任务退款/状态和用户重试策略需明确。
13. **metadata patch 失败**：不能让已生成结果消失，但历史跨设备会暂时缺 fileIds。
14. **预签名 URL**：保存/下载/预览必须继续通过 `resolveFileUrls` 刷新。
15. **素材保存依赖登录后端**：`useAssetStore.addAsset` 不是纯本地保存。
16. **候选 commit 污染范围**：不要把另一个 workflow 或视频/后端无关改动带入本分支。

## 未覆盖项

- 未决定用户原文“视频节点”是否为笔误。
- 未决定分辨率是单选还是多选；本文件仅采用当前最小单选建议。
- 未决定“允许”是否需要请求级强校验。
- 未决定工作台刷新恢复是否属于本次完成定义。
- 未运行真实浏览器验收。
- 未修改或新增任何业务测试。
