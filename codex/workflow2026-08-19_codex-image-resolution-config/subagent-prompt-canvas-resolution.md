你是当前任务的一个 Subagent。请在当前项目的现有工作区和已检出的任务分支中完成分配给你的工作。

任务契约
- 任务 slug：canvas-resolution
- 角色：画布图片节点分辨率/宽高比实现
- 并行波次：wave-2
- 并行组：impl-parallel
- 限定任务：在“我的画布”的图片节点模型设置中消费公开配置里的图片请求格式 `resolution: default | 1k | 2k | 4k`，使用户选择对应图片模型/请求格式时，仅看到该分辨率允许的宽高比/尺寸选项；缺失或非法值按 `default`。优先把映射放在现有共享 `ImageSettingsPanel` 或其同目录最小纯 helper 中，复用现有比例/尺寸常量，不另造体系。
- 预期输出：针对分辨率选项 resolver 的红绿 TDD、最小组件接线、选中值在可选项变化时的安全归一化、聚焦验证结果。
- 范围外事项：不修改后端配置/管理后台/DTO/API 契约；不修改生图工作台页面、异步任务 helper 或图片 API；不运行浏览器、全仓构建或全仓格式化。
- 完成定义：`default/1k/2k/4k` 四类配置稳定映射到现有允许尺寸；模型/格式切换后 UI 选项同步且无无效选中值；缺失/非法回落 default；聚焦测试通过。
- 执行模式：写入实现
- 项目文件写入边界：仅限调查确认的 `ImageSettingsPanel` 文件、其同目录纯 resolver/helper、同目录或现有对应测试文件。不得修改 settings DTO/API、管理后台、后端或 image generation workbench 页面。
- 依赖关系：wave-1 调查完成；开始前读取 `agent-canvas-workbench-map-resume.md`。类型字段由 config-admin 并行添加；若编译期暂缺，可在现有类型消费处采用最小兼容读取，不得编辑对方范围。
- 启动条件：当前分支必须为 `codex/image-resolution-config`；确认写入范围不与其他 agent 重叠。
- 验证范围：公开 seam 为“分辨率值 -> 可见宽高比/尺寸选项 resolver”及组件在格式切换时的选中值归一化；不做真实浏览器。
- 共享资源约束：不启动服务、不占端口；不改锁文件；不运行范围外格式化/生成命令；外部资源若确需访问走本地 7897 代理。
- 指定 Skills：完整读取并遵循 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`（full）与 `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`，并读取 TDD 引用的 `tests.md`、`mocking.md`；遵守仓库 AGENTS.md。涉及 React/Ant Design 当前 API 时使用 Context7，先 resolve-library-id 再 query-docs。
- 提交权限：无；最终由 integration/closer 提交。
- Prompt 归档文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-canvas-resolution.md`

工作环境
- 仓库根目录：`/Users/eldenpdx/git-project/infinite-canvas`
- 当前工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 基准引用：`main`
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 任务分支：`codex/image-resolution-config`
- 工作流文档目录：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config`
- 调查文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-canvas-workbench-map-resume.md`
- 专属发现文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-canvas-resolution.md`

Subagents 执行协议
1. 第一项工作是把本完整 prompt 原样保存到 Prompt 归档文件；确认不存在未替换 `{{...}}`。
2. 开始代码工作前调用 Serena `initial_instructions` 并激活本项目（若工具可用），完整读取分配的 Skills 和 TDD 引用文件，再读取调查文件、`CONTEXT.md` 与相关 ADR。
3. 只完成限定任务，不扩大范围；“视频节点”已按用户继续确认解释为图片节点。确认分支正确，不切换/创建分支或 worktree。
4. TDD seams 已确认：resolver 和组件选中值归一化。严格 one failing test -> minimal implementation -> repeat。
5. 使用 `apply_patch` 或结构化编辑；严格写入边界。保留其他 agent 改动，不回滚。
6. 将红绿切片、修改文件、映射依据、验证结果、未覆盖项与风险写入专属发现文件；不要改全局 workflow 文档。
7. 只运行聚焦测试，不运行真实浏览器、全仓构建或全仓格式化。
8. 不提交、合并、推送、stash、reset、clean、删除分支或操作 worktree。
9. 完成时最多 8 行摘要：状态、产物、修改文件、TDD 结果、验证、发现文件、实际 Skills、阻塞项。
