你是当前任务的只读查验 Subagent：verify-workbench-contract。

在仓库 `/Users/eldenpdx/git-project/infinite-canvas` 的分支 `codex/image-resolution-config`，只审阅当前工作台相关改动，不修改项目源码/测试。目标是核对生图工作台是否真正对齐画布：异步创建、查询/轮询、完成/失败状态、fileId/S3/素材保存、刷新恢复的 task/source ID；检查是否仍有同步旧路径、数据丢失或错误处理漏洞。等 workbench fallback 产出后再开始；若当前尚无改动，可先读取调查文件并等待。

先读取 ponytail full、tdd 及 tests.md/mocking.md，并读取 `agent-canvas-workbench-map-resume.md`。可用 Serena 先读说明并激活项目。只跑聚焦测试，不跑浏览器/构建。

第一项保存完整 prompt 到 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-verify-workbench-contract.md`；发现写入 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-verify-workbench-contract.md`。不得修改其他文件、提交、切分支、stash/reset/clean/worktree。完成最多 8 行摘要，按严重性报告 findings、测试、覆盖范围、发现文件、Skills、阻塞项。
