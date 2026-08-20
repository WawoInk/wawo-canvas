你是当前任务的一个 Subagent。请在当前项目的现有工作区和已检出的任务分支中完成分配给你的工作。

任务契约
- 任务 slug：config-surface-map-resume
- 角色：后端/管理后台配置只读调查
- 并行波次：wave-1
- 并行组：map-resume
- 限定任务：定位图片请求格式相关的后端配置模型、公开配置 API、默认值/校验/持久化、管理后台入口与现有测试；判断新增“分辨率”tab（选项：默认、1k、2k、4k）应复用哪些现有模式，并提出最小实现边界。只读调查，不实现代码。
- 预期输出：准确列出文件、符号、调用链、数据结构、默认行为、API 响应、可复用模式、建议的项目文件写入边界、潜在风险；给出 TDD 候选公开 seams（尚未获用户确认，不得写测试）。
- 范围外事项：不修改业务源码、测试、依赖、配置；不实现画布或生图工作台；不运行真实浏览器。
- 完成定义：覆盖配置入口到持久化/公开读取的端到端调查，明确四个选项的契约影响、测试落点和不确定项。
- 执行模式：只读调查
- 项目文件写入边界：无项目文件；只允许写本任务专属 prompt 归档和发现文件。
- 依赖关系：分支恢复已完成，可立即开始。
- 启动条件：当前分支必须为 codex/image-resolution-config。
- 验证范围：配置 model/service/repository/handler、公开配置响应、后台页面与相关测试；不做浏览器测试。
- 共享资源约束：不得修改或生成项目源码/测试/依赖文件；只写 workflow 目录中的本任务专属文件；不启动服务或占用共享端口。
- 指定 Skills：无；但须遵守仓库 AGENTS.md。若调查 Ant Design API 的现有用法需要当前文档，使用 Context7；不要调用 Web 搜索。
- 提交权限：无。
- Prompt 归档文件：/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-config-surface-map-resume.md

工作环境
- 仓库根目录：/Users/eldenpdx/git-project/infinite-canvas
- 当前工作区：/Users/eldenpdx/git-project/infinite-canvas
- 基准引用：main
- 基准提交：a13233e4649ed39f220b11b0c865a2e4997f581f
- 任务分支：codex/image-resolution-config
- 工作流文档目录：/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config
- 专属发现文件：/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-config-surface-map-resume.md

Subagents 执行协议
1. 先把本次实际收到的完整 prompt 原样保存到 `PROMPT_FILE`；确认除 prompt 内作为说明引用的模板代码外，不存在未替换的 `{{...}}`。
2. 只完成任务契约中的限定任务，不扩大范围。
3. 开始前确认当前分支是指定任务分支。不要切换或创建分支，不要创建 worktree。
4. 未分配用户指定 Skills，不要读取 ponytail/tdd/subagents-workflow；只做只读调查。
5. 严格遵守执行模式和项目文件写入边界。只读项目文件，但可以写自己的 prompt 和 findings 文件。
6. 自主完成调查，并把假设、备选方案、理由、调用链、建议写入范围、候选测试 seams、未覆盖项和残余风险写入专属发现文件。不要修改全局 workflow 文档。
7. 执行与限定任务匹配的聚焦只读验证；不运行真实浏览器，不启动服务。
8. 不提交、合并、推送、stash、reset、删除分支或操作 worktree。
9. 如必须确认产品决策，写入发现文件并返回阻塞摘要；否则做最小合理建议。
10. 完成时只返回简短摘要，不返回长日志、完整 diff 或推理过程。

最终摘要最多 8 行，包含：状态、任务/角色/模式、wave/group、主要发现、建议写入范围、候选 TDD seams、发现文件、阻塞项。
