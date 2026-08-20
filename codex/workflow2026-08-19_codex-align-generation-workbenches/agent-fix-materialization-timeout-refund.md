# Backend Fix: Materialization and Timeout Refund

状态：completed；分支 `codex/align-generation-workbenches`；未建分支/worktree。

## 修复

- `UpdateTaskMetadata` 对 pending 任务仅允许图片任务成功，并逐个校验 `fileId` 属于当前用户且为 `images`/`results/images` 文件；不存在、越权或非图片文件不会宣告成功。
- `scheduleAsyncImageTaskTimeout` 同时观察 `running` 与 `pending`；超时统一调用 `finalizeAsyncImageTask` 和共享终态仲裁，沿用任务/积分流水幂等，退款只发生一次。

## 测试

- 新增失败测试后完成红绿循环：缺失物化文件保持 pending；pending 超时失败并退款一次。
- 聚焦 Go tests：`service`、`handler`、`model`、`config` 通过。
- `git diff --check` 通过。

## 范围

- 仅改相关 Go service 与 service 测试，以及本 Prompt/发现文件。
- 未构建或改写 tracked `server`，未运行浏览器，未提交，未触碰 web、配置 UI、依赖或 `codex-image-resolution-config`。
