# 图片 URL 结果链路调查

## 结论

`gpt-image-2-open-1-edit` 的响应字段解析正确。最终显示“下载文件失败”的根因是：

- 上游任务已经返回 `succeeded`，`data.images[].url` 中是完整的 Mule Router 签名 PNG URL。
- Canvas 将该 URL 交给后端 `/api/v1/files/proxy-upload` 物化为平台文件。
- 2026-08-03 08:14:49，API 容器在下载该 URL 时发生 `net/http: TLS handshake timeout`，原实现只有一次 GET，因此 `handler.ProxyUpload` 直接返回“下载文件失败”。
- 另一编辑结果下载还出现过 `unexpected EOF`，说明同一下载边界也会遇到响应流中断。
- 同一个失败 URL 随后从宿主机 GET 返回 `HTTP 200`、`Content-Type: image/png`，排除 URL 字段层级错误、固定失效地址和缺少图片结果。

准确失败符号是：

- `handler/user_file.go:ProxyUpload`
- 当前工作树中的下载边界已提取为 `handler/user_file.go:downloadProxyFile`
- 前端触发点是 `web/src/services/upload-blob.ts:uploadUrlToS3`

## 完整代码路径

1. Canvas 判断图片编辑：
   - `web/src/pages/canvas/project/index.tsx:2282-2287`
   - 编辑调用 `createAsyncImageEditTask`，生成调用 `createAsyncImageTask`。
   - 上游 task ID 写入节点 `metadata.upstreamTaskId/taskModel`。

2. 编辑任务提交：
   - `web/src/services/api/image.ts:createAsyncImageEditTask`，当前约在 931 行。
   - 显式配置为 JSON 时，`buildAsyncImageEditRequest` 将源图片 data URL 写入 `image` 字段。
   - 请求发送到 `/api/v1/async/images/edits`。

3. 后端创建任务代理：
   - `router/router.go:52-53`
   - `service/ai_proxy.go:ProxyAIRequest`
   - 该层透明转发上游创建响应，提取 `task_id` 并记录 generation task。

4. 图片任务轮询：
   - `web/src/services/api/image.ts:pollAsyncImageTask`，当前约在 963 行。
   - 前端 GET `/api/v1/tasks/:id?model=...`。
   - `router/router.go:66-68` 调用 `service.ProxyAIGetRequest`。
   - `service.ProxyAIGetRequest` 带渠道 Authorization 请求上游 `/v1/tasks/:id`，`proxyCopyAIResponse` 原样返回响应体。

5. 成功响应解析：
   - `pollAsyncImageTask` 在 `body.status === "succeeded"` 时读取 `body.data.images`。
   - 每项统一按 `dataUrl -> url -> b64_json` 顺序转换。
   - 失败任务实际进入了 `img.url` 分支，得到完整的签名 PNG URL；没有发生 JSON 字符串转义或错误层级提取。

6. Canvas 结果物化：
   - `web/src/pages/canvas/project/index.tsx:pollCanvasImageNode`，当前约在 2649 行。
   - data URL 调用 `uploadBlob`。
   - HTTP URL 调用 `uploadUrlToS3`。

7. URL 下载与平台文件创建：
   - `web/src/services/upload-blob.ts:uploadUrlToS3` POST `/api/v1/files/proxy-upload`。
   - `handler/user_file.go:ProxyUpload` 下载供应商 URL，然后调用 `service.UploadUserFile` 上传 S3 并创建 `user_files`。
   - 下载成功后，`imageMetadata` 将 `content/fileId/naturalWidth/naturalHeight` 写回 Canvas 图片节点并标记成功。
   - 下载失败时，异常回到 `pollCanvasImageNode`，节点被标记为 error，错误文案即“下载文件失败”。

## 图片任务同步边界

`service/task_sync.go` 不参与这条图片链路。

- `SyncTaskStatus` 只从 `service/ai_proxy.go:proxyVideoTaskPost` 调用。
- 它固定查询 `/v1/contents/generations/tasks/:id`，属于兼容视频任务观察。
- 图片 edit/gen 均由浏览器直接轮询 `/api/v1/tasks/:id`。
- `ProxyAIRequest` 在异步图片创建接口返回 task ID 后即调用 `LogTaskSuccess`；它记录的是“创建请求成功”，不是最终图片已物化成功。
- Canvas 的恢复依据是节点 `upstreamTaskId/taskModel`，仍会重新进入同一个 `pollCanvasImageNode`。

因此 generation task 日志与 Canvas 最终文件物化不是同一个终态事实；这解释了上游任务显示成功、Canvas 节点仍可能因下载失败而报错。

## 与 gpt-image-2-open-1-gen 的差异

| 阶段 | edit | gen |
| --- | --- | --- |
| 创建函数 | `createAsyncImageEditTask` | `createAsyncImageTask` |
| 创建路径 | `/async/images/edits` | `/async/images/generations` |
| 默认请求格式 | `multipart/form-data`，本模型显式覆盖为 JSON | `application/json` |
| 主要请求字段 | `prompt + image` | `prompt` |
| task ID 后的轮询 | `pollAsyncImageTask` | `pollAsyncImageTask` |
| 成功响应解析 | `data.images[].dataUrl/url/b64_json` | 完全相同 |
| URL 结果物化 | `uploadUrlToS3 -> ProxyUpload` | 完全相同 |
| Canvas 节点写入 | `pollCanvasImageNode -> imageMetadata` | 完全相同 |

代码中没有针对 `gpt-image-2-open-1-edit` 或 `gpt-image-2-open-1-gen` 的响应解析分支。实际差异只可能来自上游返回内容：

- 返回 `b64_json/dataUrl` 时走浏览器 Blob 上传，不经过 URL 下载代理。
- 返回 `url` 时两种模型都经过同一个 `ProxyUpload`，共享相同的瞬时网络失败风险。

因此不能通过给 edit 增加专用响应解析来修复该错误。

## 建议的最小修复范围

最小修复应只落在共享 URL 下载边界：

- 修改 `handler/user_file.go:ProxyUpload`，或提取共享的 `downloadProxyFile`。
- 对 TLS 握手失败、连接错误和完整读取失败进行少量重试，每次重新发起完整 GET。
- 适当放宽 `TLSHandshakeTimeout`。
- 408、429、5xx 可重试；明确的其他 4xx 立即失败。
- 保持最终上传和 Canvas 写入逻辑不变。

当前未提交工作树中的 `downloadProxyFile` 已符合该范围：最多 3 次尝试、30 秒 TLS 握手超时，并对传输/读取错误重试。

不需要修改：

- `resolveImageDataUrl` 或 `pollAsyncImageTask` 的响应字段解析。
- `createAsyncImageEditTask` 的 JSON 请求构建。
- `service/task_sync.go`。
- Canvas 的 edit/gen 模型分支。
- `imageMetadata` 或 Canvas 节点结构。

另有一个独立风险：`ProxyAIGetRequest` 的上游轮询出现瞬时网络错误时，`pollAsyncImageTask` 会抛错并结束当前 Canvas 轮询。它不会产生“下载文件失败”，不属于本次最小修复范围。

## 调查验证

- 只读取了当前代码、Git diff 和现有 API 容器日志。
- 日志确认失败 task 的轮询已成功到达最终 URL，随后 `/files/proxy-upload` 报 TLS 握手超时。
- 对日志中的同一签名 URL 执行只读 GET，返回 `HTTP 200 image/png`。
- 未运行测试、构建或数据库命令，未修改任何业务代码。
