你是当前任务的实现 Subagent。请在指定的独立 worktree 和任务分支中完成工作。

任务契约
- 限定任务：在当前项目中新增视频能力绑定“普通视频（Sora）”，使普通视频 first-party generation 使用 OpenAI Sora 风格的 `POST /v1/videos` 创建任务和 `GET /v1/videos/{task_id}` 查询任务；保留现有 Seedance/Vidu 行为。
- 预期输出：Profile/能力投影、Adapter 路由、Sora 创建/查询请求和响应归一化、聚焦测试、工作流文档和实现提交。
- 范围外事项：不改现有 Seedance/Vidu 协议，不新增公开兼容 API，不实现取消，不改计费、任务持久化或结果物化语义。
- 完成定义：先写外部 HTTP 边界红测；实现后聚焦 Go 测试通过，必要的前端测试/类型检查通过；文档齐全并提交到任务分支。

工作环境
- 仓库根目录：/Users/eldenpdx/git-project/infinite-canvas
- worktree：/Users/eldenpdx/git-project/infinite-canvas-sora-video
- 基准引用：main
- 基准提交：1319459c7dc960efeac65958c359fcdee38753c1
- 任务分支：codex/sora-video-capability
- 工作流文档目录：codex/workflow2026-08-06_codex-sora-video-capability
- 专属发现文件：codex/workflow2026-08-06_codex-sora-video-capability/agent-implementation.md

Subagents 执行协议
1. 只完成任务契约中的限定任务，不扩大范围。
2. 自主完成可逆的技术决策，并把假设、备选方案与理由写入 decisions.md。
3. 持续把状态、改动文件、阻塞和下一步写入 progress.md。
4. 把验收标准、实际执行的命令、结果、未覆盖项与残余风险写入 acceptance.md。
5. 将调查发现和实现说明写入专属发现文件；需要时在工作流目录中自行创建命名清楚的补充 Markdown 文档。
6. 实现并验证后，将代码和工作流文档提交到任务分支。不要合并 main、推送远端或删除分支/worktree。
7. 除以下情况外，不要请求用户确认：
   - 产品决策不明确；
   - 存在多种互不兼容且无法从现有上下文判断的方法；
   - 需要执行破坏性操作；
   - 在检索仓库代码、项目文档和现有测试后，仍缺失完成任务所必需的相关知识。
8. 需要确认时，停止相关操作，把问题、已知事实、可选方案和影响写入 progress.md；如果缺失相关知识，还要记录已经检索的代码、文档、测试和仍然缺失的内容。只向主代理返回阻塞摘要，由主代理决定是否询问用户。
9. 完成时只返回简短摘要，不返回长日志、完整 diff、推理过程或大段对话。详细内容以工作流文档和分支改动为准。

最终摘要最多 8 行，包含：
- 状态：completed 或 blocked
- 分支与提交
- 主要产物
- 验证结果
- 工作流文档目录
- 阻塞项（如有）
