# Backend Reverification

状态：completed；第二轮只读回归；分支 `codex/align-generation-workbenches`。

## Findings

### P1: 通用 metadata 回写可绕过服务端结果物化并伪造成功

`service/generation_service.go:74-100` 对任意属于当前用户且状态为 `pending` 的任务，只要 metadata 含非空字符串 `fileIds` 就直接写 `status=success`；它没有限制为异步图片任务，也没有通过 `repository.GetUserFileByID` 校验文件存在、归属当前用户和图片类型。第一方视频在服务端下载/入库期间也会进入 `pending`（`service/generation_lifecycle.go:171-188`），因此客户端可在物化完成前调用通用 metadata 接口，用不存在或不属于自己的 file ID 抢先把任务标成功；后续服务端从 `pending` 终态转换会失去资格，留下无可信 `result_json` 的成功任务。该问题同时违反“结果物化后才成功”和“fileId/metadata 正确”。

### P1: 图片上游成功后服务端超时观察器停止，任务可永久 pending 且不退款

`service/ai_proxy.go:262-268` 在上游图片成功时把任务转为 `pending`，但 `service/ai_proxy.go:275-288` 的 deadline goroutine 只结算 `running`，看到 `pending` 会直接返回。若浏览器上传文件或 metadata 回写失败，任务不会再由服务端失败终态化，预扣积分也不会退款。新增测试 `service/ai_proxy_test.go:174-208` 只覆盖一直保持 `running` 的超时，未覆盖成功后卡在 `pending` 的路径。

### P2: tracked `server` 仍是生成物 diff

`server` 仍为 tracked ARM64 ELF：HEAD BuildID `05f0adcc055bf1417184d58203ece18c3cf8e13d`，工作区 BuildID `f48e0874f31039f54fe45f17d4f52bc420ca7751`；SHA-256 分别为 `1050e847e7fd505a70530e4e6656925aad5b3e30f536d60aaed7145817e813c5` 与 `d00234915e5d23d8cde368adce7b8ba85483de2b32c009f01a753edffc5412f8`。本轮未构建、未改写该文件。

## Verified

- 取消、失败和 running 超时均进入共享终态仲裁；任务状态锁与 `(task_id, type)` 唯一索引共同防止重复退款。
- `ProxyAIRequest` 在 `LogTaskStart` 失败后立即返回，未进入扣费和上游请求。
- 第一方创建以 `(user_id, client_request_id)` 唯一索引和 command hash 复用同一任务，聚焦测试确认重试不重复扣费。
- `compatibilityProfileForModel` 与第一方创建都读取 `generationProfiles()`，其绑定由系统 settings 投影；未发现后端新增独立 profile/provider 配置源。
- 聚焦命令：`go test ./service ./handler ./model ./config -run 'Test(ProxyAsyncImageFailureRefundsAndFinalizesTask|AsyncImageSuccessWaitsForMaterializedFileMetadata|AsyncImageServerTimeoutRefundsRunningTask|LegacyCompatibilityFailureUsesSharedRefundSettlement|LegacyCompatibilityTerminalNotificationsArbitrateOnce|AcceptedCompatibilityWorkerPollsWithoutCreating|GenerationCallbackAndPollConvergeOnce|CancelGenerationUsesProviderDecisionAndSettlesOnce|CreateGenerationRefundsFailedTaskOnce|CreateGenerationDefaultsProduceSameIdempotencyHash|CreateGenerationRejectsIdempotentCommandConflict|CreateGenerationReusesIdempotentCommand|CreateGenerationUsesOperationalBindingRouteAndPublicPrice|CreateGenerationChargesVideoBindingByResolutionAndSeconds|HistoryMapsFirstPartySucceededStatusToSuccess|CreateGenerationPassesPlatformReferences)' -count=1`
- 结果：`service`、`handler` 通过；`model`、`config` 通过且无匹配测试。`git diff --check` 通过。
- 未运行构建、真实浏览器、全量 Go tests、提交或业务代码写入。

## Skills

- `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`

## 阻塞

- 无执行阻塞；上述两个 P1 和 tracked `server` P2 仍需整合者处理。
