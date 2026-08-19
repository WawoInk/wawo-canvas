你是当前任务的一个 Subagent。请在当前项目的现有工作区和已检出的任务分支中完成分配给你的工作。

任务契约
- 任务 slug：canvas-workbench-map
- 角色：画布/生图工作台只读调查
- 并行波次：wave-1
- 并行组：map
- 限定任务：定位“我的画布”中视频节点选择模型/分辨率/宽高比的配置与图像生成、查询、保存逻辑；定位生图工作台对应实现，比较差异并提出最小对齐方案。只读调查，不实现代码。
- 预期输出：将准确文件、符号、调用链、状态结构、API/持久化方式、可复用 helper、测试落点、风险和建议写入专属发现文件。
- 范围外事项：不修改业务源码、测试、依赖、配置；不实现后台配置；不运行真实浏览器。
- 完成定义：覆盖画布视频节点配置到生成/查询/保存，以及工作台同类链路；明确新增允许分辨率如何影响宽高比选项。
- 执行模式：只读调查
- 项目文件写入边界：无项目文件；只允许写本任务专属 prompt 归档和发现文件。
- 依赖关系：可立即开始；不等待其他 Subagent。
- 启动条件：当前分支必须为 codex/image-resolution-config。
- 验证范围：web/src/app/(user)/canvas、工作台相关页面、services/api、stores/hooks、相关类型和测试；不做浏览器测试。
- 共享资源约束：不得修改或生成项目源码/测试/依赖文件；只写 workflow 目录中的本任务专属文件；不启动服务或占用共享端口。
- 指定 Skills：无。
- 提交权限：无。
- Prompt 归档文件：/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-canvas-workbench-map.md

工作环境
- 仓库根目录：/Users/eldenpdx/git-project/infinite-canvas
- 当前工作区：/Users/eldenpdx/git-project/infinite-canvas
- 基准引用：main
- 基准提交：a13233e4649ed39f220b11b0c865a2e4997f581f
- 任务分支：codex/image-resolution-config
- 工作流文档目录：/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config
- 专属发现文件：/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-canvas-workbench-map.md

Subagents 执行协议
1. 先把本次实际收到的完整 prompt 原样保存到 `Prompt 归档文件`；确认除说明引用外不存在未替换的 `{{...}}`。
2. 只完成任务契约中的限定任务，不扩大范围。
3. 开始前确认当前分支是指定任务分支。不要切换或创建分支，不要创建 worktree。
4. 未指定 Skill，无需读取用户指定 Skills；使用现有代码检索工具完成只读调查。
5. 严格遵守执行模式和写入边界。默认只读项目文件，只能写自己的 prompt 和 findings 文件。
6. 自主记录调查发现、假设、备选方案、调用链、文件边界、验证结果、未覆盖项和残余风险到专属发现文件；不要改全局 workflow 文档。
7. 调查完成后执行聚焦的结构/契约检查；不运行真实浏览器，不启动共享服务。
8. 不提交、合并、推送、stash、reset、删除分支或操作 worktree。
9. 只有在无法从仓库代码、文档和测试得出必要结论时才报告阻塞；把已查内容和缺口写入发现文件。
10. 完成时只返回最多 8 行摘要，不返回长日志或完整 diff。

最终摘要最多 8 行，包含：
- 状态：completed 或 blocked
- 任务 slug、角色与执行模式
- 并行波次、并行组与状态
- 主要产物
- 验证结果与验证范围
- 专属发现文件
- 实际读取的 Skills
- 阻塞项（如有）
