# implement-generation-contract-serial

## 状态

- 状态：completed
- 任务 slug：`implement-generation-contract-serial`
- 角色：shared generation/config/log/credit contract implementer
- 模式：写入实现 + 聚焦验证
- 分支：`codex/align-generation-workbenches`
- 范围：后端共享生成生命周期、历史投影、日志与积分终态语义

## 调查与调用链

- 图片调查确认 Canvas 异步图片代理使用 `LogTaskStart`、预扣、上游任务轮询、终态仲裁和 `results/images` 物化；图片工作台仍由前端编排同步请求和结果上传。
- 交叉调查确认 `generation_tasks` 是共享任务账本，`(task_id, credit type)` 保证消费/退款幂等；first-party 与兼容任务共同使用 `arbitrateGenerationTerminalFrom`。
- 测试 seam 调查确认后端以 `service/` 生命周期测试和 `repository/` 事务测试为主，聚焦命令使用 `go test ./service -run ...`，不运行真实浏览器。
- 视频路径：兼容视频创建进入 `ProxyVideoTaskCreate`，任务建立后由浏览器/worker 轮询；`OnTaskCompleted`、取消回调和 `observeCompatibilityTask` 最终都进入共享终态仲裁。

## 改动

- `service/compatibility_lifecycle.go`
  - 兼容任务模型配置不可用和 `TASK_SYNC_TIMEOUT` 现在以 `refund=true` 进入公共终态仲裁。
  - 失败终态会写任务状态、错误信息、terminal event，并通过任务级 credit log 幂等退款。
- `service/task_sync.go`
  - legacy 兼容任务的失败、取消和成功通知统一经过退款型公共仲裁；成功不产生退款，失败/取消只在存在消费时退款。
- `service/generation_mapper.go`
  - `success` 与 `succeeded` 都映射为历史 `success`。
  - `succeeded` 任务也会读取 payload 中的结果 URL/file metadata。
- `service/compatibility_lifecycle_test.go`
  - 新增失败终态重复结算只产生一个 terminal event、余额恢复一次的聚焦测试。
- `service/generation_mapper_test.go`
  - 新增图片/视频 `succeeded` 状态历史投影测试。

## API 契约交接

- 三入口应复用后端任务状态：`queued`/`running`/`pending`/`succeeded`/`failed`/`cancelled`；历史接口统一返回 `status: "success" | "pending" | "failed"`。
- 轮询完成后，前端应以返回任务 ID 或稳定 `clientRequestId` 关联同一 `generation_tasks` 行，不按“最近同模型任务”猜测。
- 成功结果优先消费服务端物化的 `fileIds`/`result_json`；图片结果路径为 `results/images`，视频结果路径为 `results/videos`。
- 失败、超时、取消只由后端终态仲裁改变账务；前端停止观察只暂停本地轮询，不应自行写退款或创建补偿日志。
- 统一响应仍为 `{ code, data, msg }`；错误终态读取 `errorCode`/`errorMessage`，重试应创建新的 request identity。

## 验证与未覆盖项

- 已通过：
  - `go test ./service -run 'TestHistoryMapsFirstPartySucceededStatusToSuccess|TestLegacyCompatibilityFailureUsesSharedRefundSettlement|TestLegacyCompatibilityTerminalNotificationsArbitrateOnce|TestAcceptedCompatibilityWorkerPollsWithoutCreating|TestGenerationCallbackAndPollConvergeOnce|TestCancelGenerationUsesProviderDecisionAndSettlesOnce' -count=1`
- 未运行：真实 provider、浏览器、前端工作台测试、全量 Go 测试。
- 未覆盖：兼容图片缺少独立 server observer 的超时恢复；工作台现有同步请求尚未切换到异步公共创建/轮询；现有客户端 metadata 回填仍需前端按稳定任务 ID 改造。

## 已读 Skills

- `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`

## 阻塞项

- 无。未修改 `web/src`，未触碰 `codex-image-resolution-config`，未提交。
