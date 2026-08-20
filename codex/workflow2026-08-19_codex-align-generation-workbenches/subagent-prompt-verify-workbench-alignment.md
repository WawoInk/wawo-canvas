只读查验当前分支 `codex/align-generation-workbenches` 的前端实现，重点是规格与回归，不改代码。

任务 slug：verify-workbench-alignment
波次：wave-4
并行组：parallel-verification
检查范围：相对基准 `a13233e4649ed39f220b11b0c865a2e4997f581f` 的图片工作台、视频创作台改动，以及它们调用的画布公共异步 compatibility task API。核对：提交/轮询/超时/失败/取消、结果物化、本地存储、远端 task/generation/file ID 关联、浏览器不重复轮询上游、系统模型配置是否沿公共 API 获取。运行聚焦 Bun 测试和必要的非浏览器静态检查。按 code-review 风格先列问题，P0-P3，带文件/行号；无问题明确写无。不得运行真实浏览器。
写入边界：仅 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-verify-workbench-alignment.md` 和 `agent-verify-workbench-alignment.md`。
先完整读取 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`、`/Users/eldenpdx/.agents/skills/tdd/SKILL.md` 以及相关 agent 发现文件。先原样保存 prompt，确认分支，不创建分支/worktree，不提交，不触碰 `codex-image-resolution-config`。最终最多 8 行：状态、发现（按严重度）、验证结果、发现文件、已读 Skills、阻塞项。
