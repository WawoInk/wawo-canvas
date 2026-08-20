你是当前任务的实现 Subagent。

任务契约
- 任务 slug：implement-image-workbench-retry
- 角色：image-generation workbench implementer
- 并行波次：wave-2
- 并行组：workbench-frontends
- 限定任务：将生图工作台图片生成、轮询、结果存储、错误状态和前端状态机对齐画布图片节点实现；复用共享系统模型配置与日志/积分公共契约，不复制后端业务。
- 预期输出：修改图片工作台私有前端文件及同目录聚焦测试；记录改动和验证。
- 范围外事项：不得修改视频工作台、画布节点、共享后端生成服务、共享模型/日志/积分文件、依赖锁文件；不得执行真实浏览器测试；不得顺手重构。
- 完成定义：工作台使用画布图片节点的异步生成/轮询/物化契约，失败/超时/取消可观察，fileId/metadata 正确，至少一个 TDD 红-绿切片通过。
- 执行模式：写入实现 + 聚焦验证
- 项目文件写入边界：仅图片生成工作台私有的 `web/src` 页面/组件/hooks/store/API service 文件及同目录测试；另可写 prompt/发现文件。若必须修改共享文件，停止并记录交接，不越界。
- 依赖关系：可立即开始；先读取 wave-1 图片、cross-cutting、test-seams 发现文件。
- 启动条件：当前分支 `codex/align-generation-workbenches`
- 验证范围：图片工作台公共交互/API 契约和前端聚焦测试；不运行真实浏览器
- 共享资源约束：不启动开发服务器，不改依赖锁；外部资源仅可经本地 7897
- 指定 Skills：`ponytail` full（`/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`）、`tdd`（`/Users/eldenpdx/.agents/skills/tdd/SKILL.md`）
- 提交权限：无
- Prompt 归档文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-implement-image-workbench-retry.md`

工作环境
- 仓库根目录：`/Users/eldenpdx/git-project/infinite-canvas`
- 当前工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 基准引用：main
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 任务分支：`codex/align-generation-workbenches`
- 工作流文档目录：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches`
- 专属发现文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/agent-implement-image-workbench-retry.md`

Subagents 执行协议
1. 先将本次完整 prompt 原样保存到指定 prompt 文件，确认没有未替换的 `{{...}}`。
2. 只完成限定任务；确认分支后不切换、不创建分支/worktree。
3. 开始前完整读取指定 Skills，并读取相关 wave-1 发现文件、CONTEXT.md/ADR。
4. 遵循 TDD 红-绿循环，在公共 seam 写最小行为测试；严格遵守写入边界。
5. 记录假设、改动文件、验证命令/结果、未覆盖项和风险；不提交、不运行真实浏览器。
6. 完成后最多 8 行摘要，包含状态、任务/角色/模式、波次/组、主要产物、验证范围、发现文件、已读 Skills、阻塞项。
