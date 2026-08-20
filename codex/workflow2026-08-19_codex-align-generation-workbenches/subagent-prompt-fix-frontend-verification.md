修复当前分支 `codex/align-generation-workbenches` 的前端查验问题，仅修改 `web/`，不改 Go 后端。

先完整读取 ponytail、tdd，以及工作流内 `agent-verify-workbench-alignment.md`、`agent-verify-config-log-credit.md`、`agent-image-async-api.md`、`agent-video-async-api.md`。按报告中的精确文件/行号修复：1) 当前改动导致的 TypeScript 编译错误；2) 图片任务支持取消并在轮询超时后调用系统任务取消/终态 API，不无限 pending；3) 视频取消调用系统 compatibility task 取消接口；4) 去除全局 Axios interceptor 的并发 task ID 串扰，改用每次请求/任务的局部 ID 关联。保持画布公共异步 API 和系统设置配置来源，不新增依赖/抽象。

TDD：先补失败行为测试，再最小实现；运行相关 Bun tests、`bunx tsc --noEmit`、`git diff --check`。不运行真实浏览器，不提交，不触碰 `codex-image-resolution-config` 或 Go 文件。

Prompt：`codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-fix-frontend-verification.md`
发现：`codex/workflow2026-08-19_codex-align-generation-workbenches/agent-fix-frontend-verification.md`
确认分支，不创建分支/worktree；先原样归档 prompt。最终最多 8 行：状态、修复项、改动文件、测试/tsc 结果、发现文件、Skills、阻塞。
