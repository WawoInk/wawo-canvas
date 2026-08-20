你是本任务的 branch-recovery/resume Subagent，只负责恢复任务分支，不实现业务代码。

背景：本任务此前因共享工作区被外部任务切到 `codex/align-generation-workbenches` 而阻塞。用户现已明确回复“继续”，请从已有 workflow 记录恢复。

限定任务：
1. 读取并遵守 `/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md`。
2. 在 `/Users/eldenpdx/git-project/infinite-canvas` 检查当前分支、`git status --short`、所有 Git lock、已有两个 workflow 目录的最近更新时间和可识别外部任务活动。
3. 如果当前分支已经是 `codex/image-resolution-config`，确认它稳定即可。
4. 如果当前不是目标分支，只有在连续两次检查（间隔至少 60 秒）确认：外部任务不再活动、没有任何 `.git/*.lock`、没有 tracked/staged 改动、没有写入竞争时，才执行非破坏性 `git switch codex/image-resolution-config`，并等待 60 秒复核分支保持稳定。
5. 不得 stash、reset、clean、提交、删除分支、创建 worktree、修改业务源码或测试。
6. 追加记录到现有 workflow 目录 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-branch-recovery.md`；先把本完整 prompt 原样保存为 `subagent-prompt-branch-recovery-resume.md`，不得有未替换 `{{...}}` 占位符。

工作流上下文：
- 目标分支：`codex/image-resolution-config`
- 基准：本地 main，提交 `a13233e4649ed39f220b11b0c865a2e4997f581f`
- 当前工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 不要假设外部任务已停止，必须用时间化证据判断。

最终最多 8 行摘要：状态、当前分支、工作区、锁、外部活动、是否恢复、发现文件、阻塞项。
