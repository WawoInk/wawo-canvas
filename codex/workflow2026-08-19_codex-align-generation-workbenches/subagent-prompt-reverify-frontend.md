第二轮只读回归查验前端，当前分支 `codex/align-generation-workbenches`。不得改业务代码、提交或运行真实浏览器。

先读 ponytail、tdd、`agent-verify-workbench-alignment.md`、`agent-fix-frontend-verification.md`、`agent-image-async-api.md`、`agent-video-async-api.md`。核对上一轮 P1/P2：TypeScript 编译错误、图片取消/超时终态、视频取消调用取消接口、Axios 并发 task ID 串扰、图片/视频正确 fileId 回写。相对基准检查 diff，运行相关 Bun tests、`bunx tsc --noEmit --pretty false`、`git diff --check`。按 code-review 风格列出仍存在的问题和行号；没有则明确无 P1/P2。不得触碰 Go 或 `codex-image-resolution-config`。

仅写：`codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-reverify-frontend.md`、`agent-reverify-frontend.md`。先原样归档 prompt，确认分支；最终最多 8 行含状态、残余问题、验证结果、发现文件、Skills、阻塞。
