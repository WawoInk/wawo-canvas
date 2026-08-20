# verify-workbench-contract 查验记录

## 状态

- 结果：`completed_with_findings`
- 当前分支：`codex/image-resolution-config`
- 审阅范围：生图工作台异步创建、查询/轮询、终态、S3/fileId/素材保存、task/source ID 持久化与刷新恢复
- 写入范围：仅本 Subagent 的 prompt 归档与本发现文件；项目源码、测试、依赖、分支和 Git 状态未修改

## Findings

### [P1] 短暂查询或结果上传错误会被写成供应商终态失败，原任务永久失去恢复入口

位置：

- `web/src/pages/image/image-async-task.ts:160-180`
- `web/src/pages/image/index.tsx:665-700`
- `web/src/pages/image/image-async-task.ts:93-96`
- `web/src/pages/image/index.tsx:504-506`

`completeImageWorkbenchTask` 会把任意 poll 异常、`uploadBlob` / `uploadUrlToS3`
物化异常直接抛给页面；页面随后把 slot 记录写成 `failed`。恢复函数只接受
`status === "pending"`，因此一次临时网络错误或 S3 上传失败就会永久停止查询同一个
upstream task。远程模式下，本地 durable log 又会按 `platformTaskId` 隐藏后端对应记录：
即使后端任务仍在运行，或已经保存了供应商成功响应，本地失败记录也会遮住它。

复现：让第一次 `pollAsyncImageTask` 抛网络错误，或让供应商返回 succeeded 后令
`uploadUrlToS3` 失败；刷新页面后该 slot 不会继续查询，且不会显示匹配的平台任务。
这会丢失已付费且仍可能成功的生成结果。应区分供应商明确 failed/cancelled 与
observer/materialization 错误；后两者必须保留 pending task identity 供恢复。

### [P1] 失败卡“重试”创建的新任务没有 durable log/task 绑定，刷新即丢失

位置：

- `web/src/pages/image/index.tsx:717-723`
- `web/src/pages/image/index.tsx:647-661`
- `web/src/pages/image/index.tsx:689-700`

`retryResult` 调用 `runGenerationSlot(index, snapshot)` 时没有传 `logId`。因此重试任务虽然
走异步 create/poll，但不会写入 `ImageWorkbenchTaskRecord`，成功/失败也不会更新任何
GenerationLog。若用户在重试期间刷新或离开页面，本地没有 upstream/platform task ID；
而当前 `ImageHistoryItem` 也不返回 image upstream task ID，刷新后无法恢复查询。

此外该路径不设置 `running`，用户看不到可取消状态，并可同时再启动一批生成。应让重试
更新原 slot 或建立新的 durable log，再开始 create。

### [P1] 工作台新增的取消按钮在远程模式下实际无法取消上游任务

位置：

- `web/src/services/api/image.ts:1033-1038`
- `router/router.go:69-74`
- `service/ai_proxy.go:474-493`
- `web/src/pages/image/index.tsx:693-713`

`cancelAsyncImageTask` 向 `/api/v1/tasks/:id/cancel` POST `null`，没有发送 model。该路由进入
`ProxyAIRequest`，而 `readAIRequest` 强制从 JSON/multipart body 读取非空 model，因此请求
在转发上游前即失败；前端又吞掉所有取消错误。工作台随后仍把本地 slot 标成 failed，
用户会看到“已取消”，但远程任务继续运行且不再可恢复。

现有聚焦测试只验证 helper 调用了注入的 `cancel`，没有验证真实 HTTP 请求和后端路由。
取消应使用能按现有任务所有权找到 model/platform task 的专用接口，且只有确认终态后
才能把本地记录改成 cancelled/failed。

### [P2] 删除本地批量记录时使用了 batch nanoid，而不是每个 slot 的平台任务 ID

位置：

- `web/src/pages/image/index.tsx:448-458`
- `web/src/pages/image/index.tsx:504-506`
- `web/src/pages/image/index.tsx:658-661`

新实现的 GenerationLog `id` 是本地 batch nanoid；后端每个 slot 的真实记录 ID 保存在
`tasks[].platformTaskId`。`deleteSelectedLogs` 仍只对 `log.id` 调用
`deleteGenerationTask`，错误被吞掉。删除后 durable log 消失，下一次 `refreshLogs` 不再
过滤这些平台记录，于是同一批任务会按多个后端历史项重新出现。

删除本地 batch 时应同时删除其所有唯一 `platformTaskId`；后端来源且没有 tasks 的旧记录
才继续使用 `log.id`。

## 通过项

- 工作台主生成路径已移除 `requestGeneration` / `requestEdit` 同步调用。
- create generation/edit 正确发送 `X-Source: image_workbench`，并区分 upstream task ID 与平台 task ID。
- 正常 pending -> succeeded、供应商明确 failed、即时完成、5 秒轮询与超时路径存在。
- 结果会物化到 `results/images`，保存 `fileId`，并按准确 platform task ID 回填 metadata。
- 上传引用、素材引用和结果转引用保留 `fileId`；保存到素材库时复用已有平台文件。
- 同浏览器 localforage 日志保存 source、upstream/platform task ID、task model 和 slot 终态。
- 批量历史预览可重建 success/failed/pending slot，不再只保留成功图片。

## 测试与覆盖

执行：

```text
cd web
bun test src/pages/image/image-async-task.test.mjs src/services/api/image.test.mjs
```

结果：`24 pass`，`0 fail`。

附加只读检查：

- `git diff --check`（限定工作台/API 目标文件）：通过，无输出。
- `requestGeneration|requestEdit` 扫描工作台目录：无匹配。
- 未运行浏览器、构建、全仓测试或全仓格式化。

现有测试主要覆盖纯 helper 与图片 API 请求形状；未覆盖页面级重试持久化、非终态错误恢复、
删除 platform task IDs、真实远程取消路由、恢复任务的 running/cancel UI 状态。

## Skills / 工具

- `ponytail`（full）
- `tdd`，含 `tests.md`、`mocking.md`
- Serena `initial_instructions` + 项目激活
- 未使用 Context7：本次只核对仓库现有行为，没有需要确认的 React/Ant Design API

## 阻塞项

- 无查验阻塞；上述 P1/P2 findings 需要 workbench 实现角色修复后再复验。
- `ImageHistoryItem` 缺少 upstream task ID，导致跨设备 pending 恢复仍不成立；fallback 已明确其超出当前写入边界，本次作为已知残余限制保留。
