你是当前任务的一个 Subagent。请在当前项目的现有工作区和已检出的任务分支中完成分配给你的工作。

任务契约
- 任务 slug：config-admin
- 角色：配置契约与管理后台设置实现
- 并行波次：wave-2
- 并行组：impl-parallel
- 限定任务：复用现有 `public.modelChannel.imageRequestFormats` 配置链路，为每个图片请求格式新增单选分辨率配置 `default | 1k | 2k | 4k`；在管理后台“系统设置 > 公开配置 > 图片请求格式”中以符合现有 UI 的“分辨率”配置 tab/分区呈现，并完成后端默认值、归一化、校验、持久化、公开读取和前端 DTO/保存契约。保持最小 diff，不新增接口、表或迁移。
- 预期输出：红绿 TDD 垂直切片、最小业务实现、必要中文文案/i18n、聚焦验证结果；记录修改文件。
- 范围外事项：不修改画布 `ImageSettingsPanel`、画布节点逻辑、生图工作台页面/任务 helper/图片生成 API；不运行浏览器、全仓构建或全仓格式化。
- 完成定义：四种值可在管理后台读写；缺失/非法值归一化为 `default`；公开配置返回该字段；现有配置行为不回归；聚焦测试通过。
- 执行模式：写入实现
- 项目文件写入边界：仅限后端 `model/setting.go`、`service/settings.go` 及其聚焦测试；前端公开/管理设置 DTO/API 文件、管理后台系统设置/公开配置页面目录、相关 locale 文案与这些模块的聚焦测试。不得修改 canvas 或 image generation workbench 目录。
- 依赖关系：wave-1 调查完成；开始前读取 `agent-config-surface-map-fallback.md`。
- 启动条件：当前分支必须为 `codex/image-resolution-config`；确认无其他 agent 修改你的写入范围。
- 验证范围：后端配置归一化公开 seam、管理端配置纯函数/POST 契约、公开配置加载传播；不做真实浏览器。
- 共享资源约束：不启动服务、不占端口；不修改锁文件；不运行会改写范围外文件的格式化/生成命令；外部资源若确需访问必须走本地 7897 代理。
- 指定 Skills：完整读取并遵循 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`（full）与 `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`，并读取 TDD 引用的 `tests.md`、`mocking.md`；遵守仓库 AGENTS.md。涉及 Ant Design 当前 API 时使用 Context7，先 resolve-library-id 再 query-docs。
- 提交权限：无；最终由 integration/closer 提交。
- Prompt 归档文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-config-admin.md`

工作环境
- 仓库根目录：`/Users/eldenpdx/git-project/infinite-canvas`
- 当前工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 基准引用：`main`
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 任务分支：`codex/image-resolution-config`
- 工作流文档目录：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config`
- 调查文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-config-surface-map-fallback.md`
- 专属发现文件：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-config-admin.md`

Subagents 执行协议
1. 第一项工作是把本完整 prompt 原样保存到 Prompt 归档文件；确认不存在未替换 `{{...}}`。
2. 开始代码工作前调用 Serena `initial_instructions` 并激活本项目（若工具可用），完整读取分配的 Skills 和 TDD 引用文件，再读取调查文件、`CONTEXT.md` 与相关 ADR。
3. 只完成限定任务，不扩大范围。开始前确认分支正确，不切换/创建分支或 worktree。
4. TDD seams 已由用户“继续”确认：后端归一化、管理端配置纯函数/保存 POST 契约、公开配置传播。严格按 one failing test -> minimal implementation -> repeat；不得先批量写实现。
5. 使用 `apply_patch` 或结构化编辑修改文件；严格遵守写入边界。遇到其他用户/agent 改动，保留并协作，不回滚。
6. 将每个红绿切片、修改文件、假设、取舍、验证命令/结果、未覆盖项与风险写入专属发现文件；不要改全局 workflow 文档。
7. 只运行聚焦测试，不运行真实浏览器、全仓构建或全仓格式化。项目“无需构建”规则保留；用户明确要求 TDD，因此聚焦测试允许且必须。
8. 不提交、合并、推送、stash、reset、clean、删除分支或操作 worktree。
9. 完成时最多 8 行摘要：状态、产物、修改文件、TDD 红绿结果、聚焦验证、发现文件、实际 Skills、阻塞项。
