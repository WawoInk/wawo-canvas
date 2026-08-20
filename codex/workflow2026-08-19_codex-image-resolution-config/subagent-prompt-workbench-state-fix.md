你是当前任务的 workbench 状态机修复 Subagent。

任务 slug：workbench-state-fix
角色：生图工作台查验问题的聚焦修复
并行波次：wave-3-fix
并行组：workbench-fix
执行模式：写入实现

背景：工作台已从旧同步路径接通异步 create -> poll -> terminal、S3/fileId 保存和刷新恢复。独立查验发现以下问题，必须修复并补 TDD：
- P1：非终态查询/上传错误被误记为失败，导致暂时性错误无法继续轮询或恢复；
- P1：重试任务不可刷新恢复；
- P1：远程取消实际无效；
- P2：删除使用本地 batch ID，后端任务记录会重新出现。

限定任务：只修改 `web/src/pages/image/index.tsx`、`web/src/pages/image/image-async-task.ts` 及其同目录测试/页面私有 helper。为上述四个 findings 写失败测试，再做最小实现，保持现有 UI 和 API 契约；优先复用现有任务 ID、source、fileId、取消/删除 API。不要修改后端 settings、管理后台、画布、共享 ImageSettingsPanel、其他 services、依赖或锁文件。

完成定义：
1. 可区分可重试的查询/上传暂时性错误与明确失败终态；暂时性错误遵循现有重试/恢复语义，不把记录永久标失败。
2. 重试生成记录持久化足够的远程 task/upstream ID，刷新后仍可继续查询。
3. 取消调用真实远程任务 ID，并在本地状态收敛到取消终态。
4. 删除使用远程/服务端记录对应的 ID，而不是仅本地 batch ID。
5. 聚焦测试覆盖四项行为且全绿；不得运行浏览器、构建或全仓格式化。

开始前必须：
- 读取并遵守 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`（full）；
- 读取并遵守 `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`，并完整读取其 `tests.md`、`mocking.md`；
- 读取仓库 `/Users/eldenpdx/git-project/infinite-canvas/AGENTS.md`、`CONTEXT.md`（若有）、相关 ADR；
- 读取查验记录 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-verify-workbench-contract.md` 和实现记录 `agent-workbench-alignment-fallback.md`；
- 可用 Serena 时先调用 `initial_instructions` 并激活项目。

第一项工作：把本完整 prompt 原样保存到 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-workbench-state-fix.md`，确认无未替换 `{{...}}` 占位符。

发现/验证记录写入 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-workbench-state-fix.md`。不提交、切分支、stash、reset、clean、删除分支或创建 worktree。完成后最多 8 行摘要，列出状态、修改文件、红绿测试、验证结果、发现文件、实际读取 Skills、未覆盖风险和阻塞项。
