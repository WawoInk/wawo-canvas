你是当前任务的一个 Subagent。请在当前项目的现有工作区和已检出的任务分支中完成分配给你的工作。

任务契约
- 任务 slug：workbench-alignment
- 角色：生图工作台生成/查询/保存逻辑对齐
- 并行波次：wave-2
- 并行组：impl-parallel
- 限定任务：将生图工作台的图像生成流程对齐“我的画布”现有逻辑：使用同类异步任务创建、查询/轮询、错误/完成状态、S3/素材保存、刷新恢复所需的 task/source/fileId 数据，并消费相同的模型请求配置。优先复用现有 API/helper/类型，保持工作台 UI 结构不做无关改版。
- 预期输出：围绕公开异步任务生命周期 seam 的红绿 TDD；最小工作台页面/helper/API 修改；生成记录和保存语义与画布一致；聚焦验证及用户手动浏览器清单素材。
- 范围外事项：不修改后端 settings、管理后台公开配置、`ImageSettingsPanel` 或画布节点；不做视觉重设计；不运行真实浏览器、全仓构建或全仓格式化。
- 完成定义：工作台不再走旧同步生图路径；可创建任务、查询到完成/失败、保存并恢复生成记录，引用图优先使用现有 `fileId` 语义；错误状态不丢数据；聚焦测试通过。
- 执行模式：写入实现
- 项目文件写入边界：仅限调查确认的生图工作台 image 页面目录、其页面私有 task/helper/test、现有图片生成 API 文件及专属测试。不得修改 canvas、settings DTO/后台/后端/i18n。
- 依赖关系：wave-1 调查完成；开始前读取 `agent-canvas-workbench-map-resume.md`。
- 启动条件：当前分支必须为 `codex/image-resolution-config`；确认写入范围不与其他 agent 重叠。
- 验证范围：公开 seam 为异步任务 create/query/complete/fail 生命周期、保存/恢复来源与 task ID、引用 `fileId`；不做真实浏览器。
- 共享资源约束：不启动服务、不占端口；不改锁文件；不运行范围外格式化/生成命令；外部资源若确需访问走本地 7897 代理。
- 指定 Skills：完整读取并遵循 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`（full）与 `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`，并读取 TDD 引用的 `tests.md`、`mocking.md`；遵守仓库 AGENTS.md。涉及 React/Ant Design 当前 API 时使用 Context7，先 resolve-library-id 再 query-docs。
- 提交权限：无；最终由 integration/closer 提交。
- Prompt 归档文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-workbench-alignment.md`

工作环境
- 仓库根目录：`/Users/eldenpdx/git-project/infinite-canvas`
- 当前工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 基准引用：`main`
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 任务分支：`codex/image-resolution-config`
- 工作流文档目录：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config`
- 调查文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-canvas-workbench-map-resume.md`
- 专属发现文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-workbench-alignment.md`

Subagents 执行协议
1. 第一项工作是把本完整 prompt 原样保存到 Prompt 归档文件；确认不存在未替换 `{{...}}`。
2. 开始代码工作前调用 Serena `initial_instructions` 并激活本项目（若工具可用），完整读取分配的 Skills 和 TDD 引用文件，再读取调查文件、`CONTEXT.md` 与相关 ADR。
3. 只完成限定任务，不扩大范围。确认分支正确，不切换/创建分支或 worktree。
4. TDD seams 已由用户“继续”确认：异步 create/query 生命周期、完成/失败状态、保存/恢复 source+task ID、引用 fileId。严格 one failing test -> minimal implementation -> repeat。
5. 优先复用画布已有逻辑和 API，不复制大段实现；按 ponytail full 选择最小可靠路径。使用 `apply_patch` 或结构化编辑，严格写入边界。
6. 将红绿切片、修改文件、与画布对齐点、验证结果、手动浏览器检查项、未覆盖项和风险写入专属发现文件；不要改全局 workflow 文档。
7. 只运行聚焦测试，不运行真实浏览器、全仓构建或全仓格式化。
8. 不提交、合并、推送、stash、reset、clean、删除分支或操作 worktree。
9. 完成时最多 8 行摘要：状态、产物、修改文件、TDD 结果、验证、发现文件、实际 Skills、阻塞项。
