你是配置实现的替补 Subagent。当前任务分支必须是 `codex/image-resolution-config`，仓库 `/Users/eldenpdx/git-project/infinite-canvas`。

限定任务：仅实现管理后台公开配置中图片请求格式的分辨率字段，四值 `default | 1k | 2k | 4k`。复用 `public.modelChannel.imageRequestFormats` 现有 JSON/settings upsert/公开配置链路，不新增表、迁移或接口。范围只包括后端配置 model/service 及聚焦测试、管理设置页面/DTO/API/locale 及聚焦测试；不得修改画布、ImageSettingsPanel、生图工作台、图片生成 API。

先完整读取 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`、`/Users/eldenpdx/.agents/skills/tdd/SKILL.md` 以及 TDD 引用的 `tests.md`、`mocking.md`，再读仓库 `AGENTS.md`、`CONTEXT.md`（若有）、相关 ADR 和调查文件 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-config-surface-map-fallback.md`。可用 Serena 时先调用 `initial_instructions` 并激活项目；Ant Design 文档按项目要求用 Context7。

TDD seams 已由用户“继续”确认：后端归一化、管理端配置/保存 POST 契约、公开配置传播。严格红 -> 最小绿垂直切片；只跑聚焦测试，不跑真实浏览器、构建或全仓格式化。不要提交、切分支、stash/reset/clean、创建 worktree。

第一项工作把完整 prompt 原样保存到：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-config-admin-fallback.md`；确认无未替换占位符。完成记录写入：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-config-admin-fallback.md`。最终最多 8 行摘要，列出状态、修改文件、红绿测试/验证、发现文件、实际 Skills、阻塞项。
