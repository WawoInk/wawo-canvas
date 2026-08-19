第二轮只读回归查验后端，当前分支 `codex/align-generation-workbenches`。不得改业务代码、提交或运行真实浏览器。

先读 ponytail、tdd、`agent-verify-config-log-credit.md`、`agent-fix-backend-verification.md`、`agent-implement-generation-contract-serial.md`。核对上一轮 P1/P2：取消/失败/超时只退款一次、图片服务端超时结算、日志失败不扣费、三入口模型配置统一来自系统设置、结果物化后才成功、fileId/metadata 正确、任务重试不重复扣费。运行聚焦 Go tests（不要构建/改写 tracked `server`），`git diff --check`，检查 server diff 是否仍为生成物。按 code-review 风格列出仍存在的问题和行号；没有则明确无 P1/P2。

仅写：`codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-reverify-backend.md`、`agent-reverify-backend.md`。先原样归档 prompt，确认分支；最终最多 8 行含状态、残余问题、验证结果、发现文件、Skills、阻塞。
