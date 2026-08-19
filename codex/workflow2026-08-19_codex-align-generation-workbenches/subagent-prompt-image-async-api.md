在 `codex/align-generation-workbenches` 上完成一个窄任务：只把“生图工作台”从同步生成切到画布图片节点现有的异步 compatibility task 公共 API（提交任务 -> 轮询 -> 结果物化/本地存储），并修正任务 `fileId/metadata` 回写竞态。不要修改后端、画布、视频工作台或共享配置文件。

先完整读取：
- `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`
- 工作流目录内 `agent-investigate-image-flow.md`、`agent-investigate-cross-cutting.md`、`agent-investigate-test-seams.md`、`agent-implement-generation-contract-serial.md`

写入边界：仅生图工作台私有 `web/src` 文件及其同目录测试；自己的归档和发现文件。优先直接复用画布已有 helper/API，不新增抽象/依赖。公共 seam 已确定为 compatibility task API；按红-绿写一项最小行为测试，覆盖异步完成后使用远端生成记录 ID 回写最终 file metadata（不是本地临时 ID）。运行聚焦 Bun 测试，不运行浏览器、不提交、不触碰未跟踪 `codex-image-resolution-config` 工作流。

先原样保存本 prompt：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-image-async-api.md`。发现文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/agent-image-async-api.md`。确认当前分支，不创建分支/worktree。最终最多 8 行：状态、改动文件、行为变化、测试结果、发现文件、已读 Skills、阻塞项。
