你是当前任务唯一的 integration/closer Subagent。请在同一工作区、同一任务分支 `codex/align-generation-workbenches` 完成最终整合、验收、文档收尾和提交；主窗口不会代替你执行项目任务。

原始需求：
1. 生图工作台生成/轮询/存储对齐画布图片节点。
2. 视频创作台生成/轮询/存储对齐画布视频节点。
3. 画布、图片生成、视频生成统一复用系统设置模型配置。
4. 严格落实日志落库和积分记账。
5. 外部资源经本地 7897；真实浏览器测试由用户自行运行，本任务不运行浏览器。

必须先读取并遵循：
- `/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md`
- `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`
- 项目 `/Users/eldenpdx/git-project/infinite-canvas/AGENTS.md` 已由上下文提供，仍需按其规则执行。

工作环境：
- 仓库根目录：`/Users/eldenpdx/git-project/infinite-canvas`
- 当前工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 任务分支：`codex/align-generation-workbenches`
- 基准引用：`main`
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 工作流目录：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches`
- 专属 prompt：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-integration-closer.md`
- 专属发现：`/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/agent-integration-closer.md`

第一步：将本次完整 prompt 原样保存到专属 prompt 文件，检查所有本任务 prompt 归档不存在未替换的 `{{...}}` 占位符（Skill 文本中作为示例的字面占位符可按文档规则区分）。确认当前分支和启动前工作区状态；不要切换分支、创建 worktree 或拉取远端。

整合输入：读取工作流目录内所有 `agent-*.md`、`decisions.md`、`progress.md`、`acceptance.md`、`subagent-plan.md`，以及对应 prompt 归档；检查当前 diff 和测试文件。不要读取、修改或提交用户已有的未跟踪 `codex-image-resolution-config` 工作流。

验收重点：
- 图片工作台和视频工作台实际调用画布相同的 compatibility task 提交/轮询/物化契约；无上游浏览器重复轮询；结果按任务返回的远端 task/generation/file ID 回写。
- 系统模型配置只有一个有效来源，三入口没有独立投影漂移；若现有代码仍有分叉，做最小根因修复并补测试。
- 日志在生成任务启动前正确落库；日志失败不能扣积分或启动任务；成功/失败/取消/超时终态可观察。
- 积分扣账按任务幂等；重试/重复轮询不重复扣费；失败/取消/超时只退款一次；图片 pending 超时也必须结算。
- 图片成功必须以真实、属于当前用户的有效 `fileId`/物化结果为门槛，不能只靠 metadata。
- 前端取消按钮在运行态可达；TypeScript 无错误；所有新增测试行为化。

允许整合/修复的项目文件范围：本任务已有改动涉及的 `web/src` 图片/视频工作台和共享 API 文件、后端相关 `handler/ service/ repository/ model/` 与测试、必要项目进度/API 文档、以及工作流目录。不要改无关模块。

特殊清理：启动时工作区由 bootstrap 记录为干净，但 Go 测试/构建曾造成 tracked `server` ELF 二进制 diff。确认它不是本任务源码产物后，将 `server` 恢复到基准提交内容；不得恢复任何启动前已有用户改动。保留并不触碰 `codex-image-resolution-config` 未跟踪工作流。

验证：
- 运行相关 Bun 测试、`bunx tsc --noEmit --pretty false`、`git diff --check`。
- 运行相关 Go 测试；如全量测试需要外部数据库而失败，区分环境失败与代码失败并记录。不要运行真实浏览器测试，不要启 dev server，不要改依赖锁。
- 检查基准祖先关系、任务分支、无额外 worktree、所有工作流 prompt 无未替换占位符、无未归属任务文件。

文档收尾：根据实际变更更新工作流 `decisions.md`、`progress.md`、`acceptance.md`、`subagent-plan.md`；按项目 AGENTS 更新 `docs/content/docs/progress/todo.mdx` 与 `pending-test.mdx`（本版本新增/修复但待用户浏览器验证的内容放 pending-test；todo 只保留未完成项），必要时更新 API/功能文档。不要写过期日期；可使用任务目录日期 `2026-08-19`。

提交：只有在整合和验证完成后，将本任务代码、测试和工作流文档统一提交到当前任务分支；不要提交用户已有 `codex-image-resolution-config` 工作流，不要推送、合并、切回 main、删除分支。提交信息简洁，例如 `feat: align generation workbenches with canvas tasks`。

最终摘要最多 8 行，包含：状态 completed/blocked、角色/波次、主要产物、关键验证及结果、最终提交哈希、任务分支/基准、工作流目录、未覆盖项/残余风险、已读 Skills。
