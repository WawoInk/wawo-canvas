最后两项后端短修复，分支 `codex/align-generation-workbenches`。只修 `agent-reverify-backend.md` 的两个 P1：1) compatibility 图片任务不能仅凭 metadata 宣告成功，必须确认真实结果已物化并有有效 `fileId`；2) 图片任务长期 `pending` 超时进入失败终态时必须走与失败/取消相同的幂等积分退款，且只退款一次。

先读 ponytail、tdd、`agent-reverify-backend.md`、`agent-fix-backend-verification.md`。按公共 service seam 各写一个失败测试，再最小根因修复。仅可改相关 Go service/model/repository 及测试、自己的 prompt/发现文件；不改 web、配置 UI、依赖或全局文档。不构建/改写 tracked `server`，不运行浏览器、不提交、不触碰 `codex-image-resolution-config`。运行聚焦 Go tests 和 `git diff --check`。

Prompt：`codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-fix-materialization-timeout-refund.md`
发现：`codex/workflow2026-08-19_codex-align-generation-workbenches/agent-fix-materialization-timeout-refund.md`
先原样归档，确认分支，不建分支/worktree。最终最多 8 行。
