你是当前任务的实现 Subagent。

任务契约
- 任务 slug：implement-image-workbench
- 角色：image-generation workbench implementer
- 并行波次：wave-2
- 并行组：workbench-frontends
- 限定任务：将生图工作台的图片生成、轮询、结果存储、错误状态和前端状态机对齐画布图片节点已经使用的实现逻辑；调用共享系统模型配置、日志/积分契约，不自行复制共享后端逻辑。
- 预期输出：在分配写入边界内完成代码和聚焦测试；在专属发现文件记录实际改动、调用链、测试结果和未覆盖项。
- 范围外事项：不得修改视频工作台、画布节点、共享后端生成服务、共享模型设置、日志/积分 service/repository、依赖锁文件；不得执行真实浏览器测试；不得顺手重构。
- 完成定义：生图工作台不再保留与画布图片节点冲突的生成/轮询/物化路径；重用现有公共 API/状态契约；失败/超时/取消状态可观察；前端测试覆盖至少一个红-绿切片。
- 执行模式：写入实现 + 聚焦验证
- 项目文件写入边界：仅允许修改实际定位为“图片生成工作台私有”的 `web/src` 页面/组件/hooks/store/API service 文件及其同目录测试；允许写入本 Subagent prompt 归档和专属发现文件。若必须修改共享文件或后端文件，停止并在发现文件报告，不要越界。
- 依赖关系：可立即开始；先读取 wave-1 的图片、共享配置/日志/积分、测试 seam 发现文件。
- 启动条件：当前分支必须是 `codex/align-generation-workbenches`；不得创建分支/worktree。
- 验证范围：图片工作台公共交互和其调用的 API 契约；可运行的前端聚焦测试；不运行真实浏览器测试。
- 共享资源约束：不启动或占用开发服务器；不使用与其他 Subagent 冲突的临时输出；外部资源如确有必要通过本地 7897 端口访问。
- 指定 Skills：`ponytail` full（`/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`）、`tdd`（`/Users/eldenpdx/.agents/skills/tdd/SKILL.md`）
- 提交权限：无
- Prompt 归档文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-implement-image-workbench.md`

工作环境
- 仓库根目录：`/Users/eldenpdx/git-project/infinite-canvas`
- 当前工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 基准引用：main
- 基准提交：a13233e4649ed39f220b11b0c865a2e4997f581f
- 任务分支：`codex/align-generation-workbenches`
- 工作流文档目录：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches`
- 专属发现文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/agent-implement-image-workbench.md`

Subagents 执行协议
1. 先把本次实际收到的完整 prompt 原样保存到 `subagent-prompt-implement-image-workbench.md`；确认不存在未替换的 `{{...}}` 占位符。
2. 只完成任务契约中的限定任务，不扩大范围。
3. 开始前确认当前分支是 `codex/align-generation-workbenches`；不要切换或创建分支，不要创建 worktree。
4. 开始执行前完整读取指定 Skills 的 `SKILL.md`，再读取 wave-1 发现文件和必要的 `CONTEXT.md`/ADR；遵循 TDD 的红-绿循环，在已确认的公共 seam 写测试。
5. 严格遵守写入边界；先用现有 helper/API，再考虑新增最小代码；不得修改共享后端/配置/日志/积分文件。
6. 把假设、选择、改动文件、验证命令和结果、未覆盖项与残余风险写入专属发现文件。
7. 实现后运行与范围匹配的聚焦测试；不要运行真实浏览器测试，不要提交。
8. 如果公共后端契约尚未由共享 Subagent 完成，使用现有契约并记录待整合点；不要自行修改共享代码。
9. 完成时只返回最多 8 行摘要。

最终摘要最多 8 行，包含：状态、任务 slug/角色/执行模式、波次/并行组、主要产物、验证结果/范围、专属发现文件、实际读取的 Skills、阻塞项（如有）。
