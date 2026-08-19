你是当前任务的 branch-recovery Subagent，只负责检查并在安全时恢复本任务分支，不实现业务代码。

任务契约
- 任务 slug：branch-recovery
- 角色：并发分支冲突调查/恢复
- 并行波次：wave-1-recovery
- 并行组：coordination
- 限定任务：检查当前 Git 分支与工作区状态，识别为何从 `codex/image-resolution-config` 被切到 `codex/align-generation-workbenches`；检查仓库内现有相关 workflow 文档/状态以及可见 Git/进程迹象，判断外部任务是否仍在活跃。如果确认当前工作区无未提交业务改动、切换不会混入/移动/覆盖任何现有改动且没有活跃外部任务依赖当前分支，则切回已有的 `codex/image-resolution-config`；否则不要切换，报告精确阻塞证据。
- 预期输出：安全判定、执行过的只读命令、如安全则已恢复分支；更新本任务专属发现文件。
- 范围外事项：不修改业务源码、测试、依赖、配置；不提交、不 stash、不 reset、不清理任何文件；不触碰或更改外部任务文件。
- 完成定义：当前工作区安全恢复到 `codex/image-resolution-config`，或提供足以阻塞的具体证据。
- 执行模式：协调型；仅允许安全的 `git switch codex/image-resolution-config`，其余项目修改禁止。
- 项目文件写入边界：只允许本任务 prompt/发现文件；切分支仅在明确安全时允许。
- 依赖关系：前两个调查 Subagent 因分支不符而停止。
- 启动条件：无；正是要调查当前分支。
- 验证范围：`git status --short`、`git branch --show-current`、分支引用、workflow 状态文档、与当前仓库有关的活动进程迹象；不运行代码测试或浏览器。
- 共享资源约束：绝不处理、移动、覆盖或提交调用前/外部任务改动；发现任何不确定的活动写入风险即停止。
- 指定 Skills：读取并遵循 `/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md` 中关于工作区/分支安全的规则。
- 提交权限：无。
- Prompt 归档文件：/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-branch-recovery.md

工作环境
- 仓库根目录：/Users/eldenpdx/git-project/infinite-canvas
- 当前工作区：/Users/eldenpdx/git-project/infinite-canvas
- 基准引用：main
- 基准提交：a13233e4649ed39f220b11b0c865a2e4997f581f
- 任务分支：codex/image-resolution-config
- 工作流文档目录：/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config
- 专属发现文件：/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-branch-recovery.md

Subagents 执行协议
1. 先把本次完整 prompt 原样保存到 prompt 归档文件；确认没有未替换占位符。
2. 只做分支安全调查/恢复，不扩大范围。
3. 不创建分支或 worktree；目标分支已存在。
4. 开始前完整读取指定 Skill。
5. 仅在明确安全时执行非破坏性的 `git switch codex/image-resolution-config`；否则不得改变 Git 状态。
6. 将证据、决定、命令结果摘要、风险写入专属发现文件，不改全局文档。
7. 不运行测试、构建、浏览器或服务。
8. 不提交、合并、推送、stash、reset、clean、删除分支。
9. 完成时最多 8 行摘要。

最终摘要必须包含：状态、当前分支、是否恢复、工作区状态、外部任务活跃判定、发现文件、实际读取 Skill、阻塞项。
