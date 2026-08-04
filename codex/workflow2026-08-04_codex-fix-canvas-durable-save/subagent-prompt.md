你是当前任务的实现 Subagent。请在指定的独立 worktree 和任务分支中完成工作。

任务契约
- 限定任务：使用 TDD 修复 Canvas 生成视频节点在立即关闭浏览器时可能同时丢失本地 Replica 和服务端同步的问题。先固化失败复现，再实现可等待、串行的账户隔离本地持久化；保证后端同步不会发送尚未本地持久化的更新；让生成视频成功结果经过 durable commit 后才视为已保存。保留现有 dirty/revision/localVersion/CAS/retry/账号隔离语义。
- 预期输出：确认 seam 上的永久回归测试、最小前端实现、必要的 Canvas/progress 文档更新、完整工作流文档，以及一个包含实现和文档的本地提交。
- 范围外事项：不得修改 Generation API 合同、Go model/handler/service/repository、数据库结构或实现服务端节点重建；不得进行 UI 重设计、无关重构、构建、部署、发布、合并 main、推送远端或删除分支/worktree。
- 完成定义：逐个完成 Red-Green slice；120 个代表性媒体节点在本地写阻塞、普通 PUT 在途、模拟关闭和新 hydration 后仍可恢复；后端同步只消费已本地持久化的项目状态；视频成功结果使用 durable commit；现有 canvas-sync、账号隔离及相关 Canvas 测试通过；工作流文档记录实际命令和结果；所有改动提交到任务分支。

已确认的测试 seams
1. `useCanvasStore` 的公共项目 mutation 与账户隔离持久化后的 fresh hydration。
2. 本地 Canvas Project Replica durable commit 与后端 Canvas PUT 之间的边界。
3. Canvas 页面提交生成视频结果所使用的公共 durable operation。
4. 大画布、服务端请求在途、立即关闭/重启后的用户可观察恢复行为。

TDD 约束
1. 每次只做一个 vertical slice：一个失败测试、最小实现、聚焦验证。
2. 测试只 mock 浏览器 storage 和 HTTP 这两个系统边界，不 mock Canvas 内部协作者，不断言私有函数或内部调用次数。
3. 先运行并记录 red，再写对应 green。
4. 不先批量写完所有测试，也不进行额外 refactor。

设计边界
- 本地持久化必须可等待并串行，较旧异步快照不能最终覆盖较新快照。
- 后端同步读取的状态必须已经完成本地 durable write。
- 当关闭时存在普通 PUT，请确保最新 accepted state 已经存在于 dirty local Replica。
- `beforeunload`/`keepalive` 只能作为 best-effort，测试和正确性不得依赖它。
- 优先复用现有 Store、account storage、Zustand persist、dirty/revision 和 project sync queue；只添加真正需要的最小接口。
- 若发现“生成视频成功后 durable commit”无法在不大幅改写项目页的情况下安全实现，请先完成共享 Replica 根因修复，将具体阻塞、已查代码和最小备选方案写入 progress.md，并只向主代理返回阻塞摘要，不得自行扩大架构。

工作环境
- 仓库根目录：`/Users/eldenpdx/git-project/infinite-canvas-worktrees/fix-canvas-durable-save`
- worktree：`/Users/eldenpdx/git-project/infinite-canvas-worktrees/fix-canvas-durable-save`
- 基准引用：本地 `main`
- 基准提交：`1319459c7dc960efeac65958c359fcdee38753c1`
- 任务分支：`codex/fix-canvas-durable-save`
- 工作流文档目录：`/Users/eldenpdx/git-project/infinite-canvas-worktrees/fix-canvas-durable-save/codex/workflow2026-08-04_codex-fix-canvas-durable-save`
- 专属发现文件：`/Users/eldenpdx/git-project/infinite-canvas-worktrees/fix-canvas-durable-save/codex/workflow2026-08-04_codex-fix-canvas-durable-save/agent-implementation.md`

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
