你是当前任务的只读调查 Subagent，补齐视频路径调查。

任务契约
- 任务 slug：investigate-video-flow-final
- 角色：canvas/video-flow investigator
- 并行波次：wave-2a
- 并行组：video-readonly
- 限定任务：梳理画布视频节点与视频创作台的端到端视频生成、轮询、结果存储、错误处理、模型配置、日志落库、积分记账流程，找出需要对齐的公共入口和差异。
- 预期输出：写入专属发现文件，列出关键文件/符号、调用链、现有可复用 helper、差异、最小实现边界、候选测试 seam。
- 范围外事项：不得修改业务代码、测试代码、配置或依赖；不得执行真实浏览器测试；不得实现修复。
- 完成定义：明确生成/轮询/存储/日志/积分/模型配置真实调用链及风险。
- 执行模式：只读调查
- 项目文件写入边界：无；仅本 Subagent 的 prompt 归档和专属发现文件
- 依赖关系：可立即开始；其他 wave-1 调查已完成
- 启动条件：当前分支 `codex/align-generation-workbenches`
- 验证范围：相关前后端代码、CONTEXT.md、ADR、现有测试；不运行真实浏览器
- 共享资源约束：不修改共享项目文件，不创建分支/worktree，不占用服务端口；外部资源仅可经本地 7897
- 指定 Skills：`ponytail` full（`/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`）、`tdd`（`/Users/eldenpdx/.agents/skills/tdd/SKILL.md`）
- 提交权限：无
- Prompt 归档文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-investigate-video-flow-final.md`

工作环境
- 仓库根目录：`/Users/eldenpdx/git-project/infinite-canvas`
- 当前工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 基准引用：`main`
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 任务分支：`codex/align-generation-workbenches`
- 工作流文档目录：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches`
- 专属发现文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/agent-investigate-video-flow-final.md`

Subagents 执行协议
1. 先将本次完整 prompt 原样保存到指定 prompt 文件，确认没有未替换的 `{{...}}`。
2. 只完成限定任务；确认分支后不切换、不创建分支/worktree。
3. 开始前完整读取指定 Skills 的 SKILL.md，并遵循其规则。
4. 只读项目文件；把调用链、假设、建议、验证结果、未覆盖项和风险写入发现文件。
5. 不运行真实浏览器，不提交。
6. 完成后最多 8 行摘要，包含状态、任务/角色/模式、波次/组、主要发现、验证范围、发现文件、已读 Skills、阻塞项。
