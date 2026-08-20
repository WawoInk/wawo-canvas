# verify-workbench-alignment

## 状态

完成只读查验。当前分支：`codex/align-generation-workbenches`。基准：`a13233e4649ed39f220b11b0c865a2e4997f581f`。HEAD 与基准相同，审查包含当前工作区 tracked diff 及目标未跟踪前端异步任务文件。

## 发现

### P1 - 前端 TypeScript 编译失败

- [web/src/pages/image/index.tsx:238](/Users/eldenpdx/git-project/infinite-canvas/web/src/pages/image/index.tsx:238)
- `Promise.allSettled(tasks)` 的类型谓词声明为 `PromiseFulfilledResult<GeneratedImage>`，但 `runGenerationSlot` 推断出的成功值要求 `fileId: string`；`GeneratedImage.fileId` 是可选的。`bunx tsc --noEmit --pretty false` 直接报 `TS2677` 和 `TS2339`。这使图片工作台改动无法通过前端类型检查，应修正返回类型或收窄方式。

### P1 - 图片工作台异步任务不可取消，且超时只在浏览器本地失败

- [web/src/pages/image/index.tsx:193](/Users/eldenpdx/git-project/infinite-canvas/web/src/pages/image/index.tsx:193)
- [web/src/pages/image/index.tsx:515](/Users/eldenpdx/git-project/web/src/pages/image/index.tsx:515)
- 新路径没有 `AbortController`、取消动作或 `cancelAsyncImageTask` 调用；`completeImageWorkbenchTask` 超过 360 次后仅抛出本地错误。后端通用 async image 任务没有独立 observer/超时终结，故远端任务可能持续 `running` 且预扣积分不结算，页面也无法把“取消”传递到公共 compatibility task lifecycle。

### P1 - 远程视频取消仍以 `refund=false` 终结兼容任务

- [web/src/pages/video/index.tsx:600](/Users/eldenpdx/git-project/infinite-canvas/web/src/pages/video/index.tsx:600)
- [service/ai_proxy.go:850](/Users/eldenpdx/git-project/service/ai_proxy.go:850)
- 工作台取消会 abort 本地观察后调用兼容 DELETE；后端取消上游成功时对匹配 `generation_tasks` 调用 `arbitrateGenerationTerminalFrom(..., refund=false, ...)`。这与本波次要求的取消/账务公共语义不一致：已预扣的远程视频取消不会退款。`task_sync.go` 对 legacy 终态改为退款并不能覆盖这个 DELETE 分支。

### P2 - 图片/视频通过全局 Axios interceptor 捕获平台 task ID，存在并发串扰风险

- [web/src/pages/image/image-async-task.ts:37](/Users/eldenpdx/git-project/infinite-canvas/web/src/pages/image/image-async-task.ts:37)
- [web/src/pages/video/video-async-task.ts:46](/Users/eldenpdx/git-project/web/src/pages/video/video-async-task.ts:46)
- 每次提交临时安装全局 request/response interceptor。图片批量生成会并行安装多组 interceptor，视频/图片及其它 Axios 请求也会被这些 interceptor 观察；这让 `X-Source` 和最近响应头捕获依赖全局时序。当前测试只覆盖单请求，未证明并发提交下 platform/upstream ID 始终一一对应。公共 API 应直接返回平台 task ID，或至少在请求级 response seam 中传递。

## 验证结果

- 通过：`cd web && bun test src/pages/image/image-async-task.test.mjs src/pages/video/video-async-task.test.mjs src/services/api/image.test.mjs src/services/api/video.test.mjs src/services/api/generations.test.mjs`，`35 pass / 0 fail`。
- 通过：`go test ./service -run 'Test(HistoryMapsFirstPartySucceededStatusToSuccess|LegacyCompatibilityFailureUsesSharedRefundSettlement|LegacyCompatibilityTerminalNotificationsArbitrateOnce|AcceptedCompatibilityWorkerPollsWithoutCreating|GenerationCallbackAndPollConvergeOnce|CancelGenerationUsesProviderDecisionAndSettlesOnce)' -count=1`。
- 失败：`cd web && bunx tsc --noEmit --pretty false`，图片工作台 `index.tsx:238` 报 `TS2677`、`TS2339`。
- `git diff --check` 通过；未运行真实浏览器、未启动服务、未创建分支/worktree、未提交。

## 范围核对

- 远程视频已改为轮询平台 generation task 详情并使用 metadata `fileIds`，不再由浏览器轮询上游；对应 Bun 回归通过。
- 图片结果会先物化平台文件再回写精确平台 task metadata，但 pending 状态主要存在内存，批量结束前刷新页面会丢失图片工作台本地恢复能力。
- 图片/视频模型选择仍经 `useConfigStore` 的公开设置与 `ModelPicker`；未发现工作台新增私有 channel/API key 配置源。
- 未读取、修改或清理 `codex/workflow2026-08-19_codex-image-resolution-config/`。

## 已读 Skills

- `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`
- `/Users/eldenpdx/.agents/skills/code-review/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/tests.md`、`/Users/eldenpdx/.agents/skills/tdd/mocking.md` 未单独读取；本次没有编写测试。

## 阻塞项

- 无外部阻塞；前端类型错误是待修复发现，不影响本次只读报告完成。
