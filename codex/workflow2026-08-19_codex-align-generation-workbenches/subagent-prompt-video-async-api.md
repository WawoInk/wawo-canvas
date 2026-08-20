在 `codex/align-generation-workbenches` 上完成一个窄任务：只把“视频创作台”生成、轮询、结果存储对齐画布视频节点现有的异步 compatibility task 公共 API。目标是提交服务端任务后只轮询本系统任务状态，避免浏览器同时轮询上游；成功后按任务返回的远端生成记录 ID/fileId 物化并持久化，失败/超时/取消显示一致状态。不要修改后端、画布、图片工作台或共享配置文件。

先完整读取：
- `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`
- 工作流目录内 `agent-investigate-cross-cutting.md`、`agent-investigate-test-seams.md`、`agent-implement-generation-contract-serial.md`、`agent-image-async-api.md`
- 然后自行只读核对画布视频节点和视频创作台真实调用链。

写入边界：仅视频创作台私有 `web/src` 文件及其同目录测试；自己的归档和发现文件。优先复用画布已有 helper/API，不新增抽象/依赖。公共 seam 已确定为 compatibility task API；按红-绿写一项最小行为测试，至少覆盖“服务端任务完成后用远端任务/生成记录 ID 更新视频 file metadata，且不再调用浏览器上游轮询”。运行聚焦 Bun 测试，不运行浏览器、不提交、不触碰未跟踪 `codex-image-resolution-config` 工作流。

先原样保存本 prompt：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-video-async-api.md`。发现文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/agent-video-async-api.md`。确认当前分支，不创建分支/worktree。最终最多 8 行：状态、改动文件、行为变化、测试结果、发现文件、已读 Skills、阻塞项。
