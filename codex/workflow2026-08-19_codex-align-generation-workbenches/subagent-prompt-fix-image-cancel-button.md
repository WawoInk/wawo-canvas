最后一项前端短修复，分支 `codex/align-generation-workbenches`。只修 `agent-reverify-frontend.md` 的 P1：`web/src/pages/image/index.tsx` 运行态取消按钮因 Ant Design `loading` 被禁用，用户无法点击取消。

先读 ponytail、tdd、context7-mcp skill 和该复查报告；按项目 AGENTS 使用 Context7 查当前 Ant Design Button loading/click 语义。TDD 先写失败测试，确保生成中按钮仍可点击并触发系统 task cancel，同时保留明确的运行中视觉反馈；最小改动，不新增组件/依赖。仅可改图片工作台私有 web 文件和同目录测试、自己的 prompt/发现文件。运行聚焦 Bun、`bunx tsc --noEmit --pretty false`、`git diff --check`；不跑浏览器、不改 Go、不提交、不触碰 `codex-image-resolution-config`。

Prompt：`codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-fix-image-cancel-button.md`
发现：`codex/workflow2026-08-19_codex-align-generation-workbenches/agent-fix-image-cancel-button.md`
先原样归档，确认分支，不建分支/worktree。最终最多 8 行。
