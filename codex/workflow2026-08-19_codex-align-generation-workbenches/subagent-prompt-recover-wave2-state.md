你是当前任务的 recovery/audit Subagent。主窗口等待三个 wave-2 实现 Subagents 时被用户中断，恢复后旧 agent ids 返回 not_found。你只负责检查共享工作区当前真实状态，不实现业务功能。

任务契约
- 任务 slug：recover-wave2-state
- 角色：recovery auditor
- 并行波次：wave-2-recovery
- 并行组：recovery-audit
- 限定任务：检查当前任务分支、git status/diff、工作流目录、三个 wave-2 prompt/agent 发现文件及可能的局部测试结果，判断 image workbench、video workbench、shared generation contract 各自是否未开始/部分完成/已完成；列出实际改动文件、归属、潜在写入冲突和建议重派边界。
- 预期输出：专属恢复报告，给出三条实现单元的精确状态和下一步调度建议。
- 范围外事项：不得修改任何业务代码、测试、配置、全局工作流文档；不得提交、切分支、stash/reset；不得运行真实浏览器测试。
- 完成定义：主窗口能够仅根据你的 8 行摘要决定哪些 Agent 需要重派、哪些直接进入查验。
- 执行模式：只读审计
- 项目文件写入边界：仅 `subagent-prompt-recover-wave2-state.md` 和 `agent-recover-wave2-state.md`
- 依赖关系：可立即开始
- 启动条件：确认当前分支是 `codex/align-generation-workbenches`
- 验证范围：git status/diff、任务工作流目录、wave-2 归档和发现文件、已存在测试输出记录；不运行真实浏览器。
- 共享资源约束：不修改项目文件，不创建分支/worktree，不启动服务；外部资源无需访问。
- 指定 Skills：`subagents-workflow`（`/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md`）
- 提交权限：无
- Prompt 归档文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-recover-wave2-state.md`

工作环境
- 仓库根目录：`/Users/eldenpdx/git-project/infinite-canvas`
- 当前工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 基准引用：`main`
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 任务分支：`codex/align-generation-workbenches`
- 工作流文档目录：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches`
- 专属发现文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/agent-recover-wave2-state.md`

Subagents 执行协议
1. 先把本次实际收到的完整 prompt 原样保存到指定 prompt 文件；确认不存在未替换的 `{{...}}` 占位符。
2. 只完成限定审计，不扩大范围。
3. 确认当前分支，不切换或创建分支/worktree。
4. 开始前完整读取指定 Skill；未分配 Skill 不要读取。
5. 除自己的 prompt/发现文件外只读。
6. 在发现文件记录每个实现单元的状态、实际改动文件、是否有完整测试、冲突风险和重派建议。
7. 不运行真实浏览器，不提交。
8. 最终只返回最多 8 行摘要。

最终摘要最多 8 行，包含：状态、三个实现单元状态、主要落盘文件、冲突风险、建议重派/查验、专属发现文件、实际读取 Skill、阻塞项。
