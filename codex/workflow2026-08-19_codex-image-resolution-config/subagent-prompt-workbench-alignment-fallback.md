你是当前任务的 workbench-alignment-fallback Subagent。请在现有工作区和任务分支 `codex/image-resolution-config` 上完成一个窄而完整的实现，不要扩大范围。

原始需求：生图工作台要对齐“我的画布”对图像生成、查询及保存的逻辑；图片模型分辨率配置为 default/1k/2k/4k，画布已由另一 Subagent实现可见选项过滤。

你的限定任务：只修改生图工作台 image 页面及其页面私有 helper/test，必要时复用现有图片 API 文件中已有公开函数但不要修改后端 settings 或画布。把旧同步生图流程替换为/接通现有项目已经使用的异步图像任务 create -> query/poll -> completed/failed 生命周期；完成后使用现有 fileId/S3/素材保存路径，保存 source/task ID 使刷新恢复逻辑与画布一致。若仓库现有 API 已提供这些能力，优先调用，不复制实现；若工作台已有部分异步逻辑，只补缺口。保持 UI 结构不变。

先读取：
- `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`（full）
- `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`
- TDD 引用的 `tests.md` 与 `mocking.md`
- 仓库 `AGENTS.md`、`CONTEXT.md`（若有）、相关 ADR
- 调查 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-canvas-workbench-map-resume.md`

可用 Serena 时先调用 initial_instructions 并激活项目；React/Ant Design 文档按项目规则走 Context7（resolve-library-id 后 query-docs），不要 Web 搜索。

TDD seam 已确认：异步 create/query/complete/fail 生命周期、保存/恢复 source+task ID、引用 fileId。严格按一个失败测试 -> 最小实现 -> 再循环。只跑聚焦测试，不跑浏览器、构建、全仓格式化。

写入边界：
- 允许：工作台 image 页面目录、页面私有 helper、该目录测试；若确有必要，只能读取/调用 `web/src/services/api` 现有函数，不改 settings DTO、管理后台、后端、canvas、共享 ImageSettingsPanel。
- 不允许：任何其他项目文件、依赖/锁文件、全局文档（只写专属 findings）。

第一项把完整 prompt 原样保存到：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-workbench-alignment-fallback.md`；确认无未替换占位符。完成记录写入：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-workbench-alignment-fallback.md`。

不要提交、切分支、stash/reset/clean、创建 worktree。最终最多 8 行摘要，列出状态、修改文件、红绿测试/验证、发现文件、实际 Skills、阻塞项。
