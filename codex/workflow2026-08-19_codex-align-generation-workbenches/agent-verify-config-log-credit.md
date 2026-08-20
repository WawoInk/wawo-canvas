# verify-config-log-credit

状态：completed；只读审计；分支 `codex/align-generation-workbenches`；基准 `a13233e4649ed39f220b11b0c865a2e4997f581f`。

## Findings

### P1: 取消路径不退款

`service/ai_proxy.go:848-855` 的 `ProxyVideoTaskDelete` 在命中 `generation_tasks` 后，以 `refund=false` 调用终态仲裁；视频工作台使用的 `cancelVideoGenerationTask` 会进入该 DELETE 路径（`web/src/services/api/video.ts:310`、`web/src/pages/video/index.tsx:608`）。因此已扣费的兼容视频任务取消后余额不会恢复，违反“失败/超时/取消只退款一次”。任务级唯一索引只能防重复退款，不能补偿这里明确关闭的退款。

### P1: 异步图片超时不会终态化或退款

`web/src/pages/image/image-async-task.ts:63-78` 在 360 次轮询后只抛出本地错误；服务端 `service/ai_proxy.go:152-159` 只在浏览器继续请求 `/tasks/:id` 时触发 `finalizeAsyncImageTask`，没有 worker/lease/deadline observer。浏览器停止观察或超时后，任务可保持 `running` 且预扣积分不退款，违反超时结算要求。

### P1: 图片日志创建错误被吞掉，可能出现扣费与任务行脱节

`service/ai_proxy.go:70-78` 忽略 `LogTaskStart` 错误并继续使用随机 `genTaskID` 写 `X-Generation-Task-Id`、调用 `ConsumeUserCreditsWithTask`。`LogTaskStart` 本身在 `service/task_lifecycle.go:32-62` 单独落库；当创建失败时仍可能留下带 task ID 的 credit log，却没有对应 `generation_tasks` 行，违反每次任务日志严格落库及任务/账务关联要求。

### P1: 三入口仍不是同一 provider/profile 能力投影

Canvas 远程视频使用 `/api/v1/generations` 的稳定 `GenerationProfile`，而视频工作台 `web/src/pages/video/video-async-task.ts:38-52` 仍通过兼容 `/api/v1/contents/generations/tasks`，由客户端构造 provider-shaped payload；后端 `service/ai_proxy.go:693-723` 再按公开模型名和兼容 profile 重写。两条链路可使用不同的 profile/provider/能力快照，不能证明三入口复用单一系统设置投影；这是用户要求的“没有独立硬编码或双投影漂移”未完全落实。

### P2: 图片成功先于平台文件物化，结果 metadata 可能永久缺失

`service/ai_proxy.go:219-236` 将上游返回 URL/base64 视为 succeeded，`service/ai_proxy.go:242-254` 随即终态化并扣留成功状态；工作台之后才在 `web/src/pages/image/image-async-task.ts:67-73` 上传并 patch `fileIds`。若上传或 patch 失败，任务已是成功但没有平台 `fileId`，历史只能看到不完整结果，违反远程图片 `fileId/metadata` 对应正确及 materialized-result 约束。

### P2: `server` 是 tracked ELF 生成物 diff，必须清理

`server` 相对基准存在 ELF 二进制 diff（基准 BuildID `05f0adcc...`，工作区 BuildID `c0be51f...`）；本次测试前后哈希均为 `30a15908...`，测试未改写它。应由整合者清理该 tracked 生成物 diff。

## Verified

- `go test ./config ./model ./service ./handler -run 'Test(GenerationProfilesAreValid|HistoryMapsFirstPartySucceededStatusToSuccess|LegacyCompatibilityFailureUsesSharedRefundSettlement|LegacyCompatibilityTerminalNotificationsArbitrateOnce|AcceptedCompatibilityWorkerPollsWithoutCreating|GenerationCallbackAndPollConvergeOnce|CancelGenerationUsesProviderDecisionAndSettlesOnce|ReadAIRequestMultipart|AsyncImageTaskRefAcceptsTopLevelImageData|AIUpstreamErrorDetail|SafeUpstreamTextTruncates|ResolveAIProxyPathPassesThroughTasksPath|BuildOpenAIUpstreamTasksCreateURL|ViduDramaProfileContract|NormalizePrivateSettingAcceptsGeminiProtocol|ModelProfilesExposeVideoAdaptersWithoutSecrets|CreateGenerationPassesPlatformReferences)' -count=1`
- Result: `RC=0`; `config/model` had no matching tests, `service/handler` passed.
- No real browser, server startup, build, commit, branch/worktree operation, or access to `codex-image-resolution-config`.
- `ponytail`, `tdd`, `code-review` Skills read in full; also read `CONTEXT.md` and all related investigation/implementation/acceptance/recovery findings listed in the task context.
