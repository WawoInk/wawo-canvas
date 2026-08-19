单串行恢复任务：你负责 shared generation/config/log/credit contract 实现。

原始需求：在分支 `codex/align-generation-workbenches` 上，把画布、图片生成、视频生成统一到系统设置模型配置；对齐画布节点的异步生成、轮询、结果存储；严格日志落库和积分幂等记账。

任务契约
- 任务 slug：implement-generation-contract-serial
- 角色：shared generation/config/log/credit implementer
- 波次：wave-2-serial
- 并行组：shared-backend-contract
- 限定任务：先读取工作流目录中的 `agent-investigate-image-flow.md`、`agent-investigate-cross-cutting.md`、`agent-investigate-test-seams.md`，再调查视频路径；在后端共享 `handler/ service/ repository/ model/` 和必要共享 API 类型范围内，修复/统一模型配置来源、异步生成/轮询/物化公共契约、日志落库、积分幂等及失败/超时/取消账务语义。遵循项目分层和 `{ code, data, msg }` 响应结构。
- 预期输出：共享后端代码和聚焦测试；专属发现文件记录调用链、改动、验证、未覆盖项和交接给两个前端工作台的 API 契约。
- 范围外：不得修改 `web/src` 图片/视频工作台或画布私有 UI；不得新增依赖；不得执行真实浏览器测试；不得提交。
- 完成定义：三入口可复用同一系统模型配置和公共生成/轮询/存储接口；同任务重试不重复扣费；成功/失败/超时/取消日志与积分状态一致；结果 file/metadata 关联正确；核心测试通过。
- 执行模式：写入实现 + 聚焦验证
- 写入边界：后端共享生成/配置/日志/积分相关文件及后端测试；只写自己的 prompt/发现文件，不改工作流全局文档。
- 启动条件：确认当前分支是 `codex/align-generation-workbenches`；已有用户未跟踪 `codex-image-resolution-config` 工作流不得触碰。
- 验证范围：后端公共 seam 和测试；不运行真实浏览器。
- 指定 Skills：完整读取 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md` 和 `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`。
- Prompt 归档：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-implement-generation-contract-serial.md`
- 专属发现：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/agent-implement-generation-contract-serial.md`

协议：先原样保存完整 prompt 到归档，确认无 `{{...}}`；只在上述边界改动；按 TDD 红-绿循环；运行聚焦测试但不运行真实浏览器；完成后最多 8 行摘要，包含状态、改动文件、验证结果、发现文件、已读 Skills、阻塞项。
