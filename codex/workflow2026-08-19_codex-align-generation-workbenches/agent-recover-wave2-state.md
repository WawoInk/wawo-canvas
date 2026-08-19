# Recovery Audit: wave-2

## 状态

- 状态：`completed`
- 任务 slug：`recover-wave2-state`
- 角色：recovery auditor
- 执行模式：只读审计
- 并行波次/组：`wave-2-recovery` / `recovery-audit`
- 当前分支：`codex/align-generation-workbenches`，满足启动条件
- `HEAD`、`main` 与任务分支均为 `a13233e4649ed39f220b11b0c865a2e4997f581f`
- 未切换分支、未创建分支/worktree、未提交、未 stash/reset、未启动服务、未运行真实浏览器测试

## 工作区与实际落盘

`git status --short --untracked-files=all` 只发现两套未跟踪工作流目录：

- `codex/workflow2026-08-19_codex-align-generation-workbenches/`
- `codex/workflow2026-08-19_codex-image-resolution-config/`

当前分支没有 tracked/staged diff；`git diff --stat`、`git diff --name-only` 和暂存区 diff 均为空。未发现任何业务源码、测试、配置、依赖锁文件或构建产物改动。当前任务工作流目录中的实际新增文件均为 workflow 文档。

## 三个 wave-2 实现单元

### 1. image workbench

- 精确状态：`未开始`，不是部分完成。
- 证据：仅有 `subagent-prompt-implement-image-workbench.md`，mtime `2026-08-19 14:48:47`；不存在 `agent-implement-image-workbench.md`；没有业务 diff、测试输出或实现摘要。
- 归属/预期边界：`web/src` 中图片工作台私有页面、组件、hooks、store、API service 及同目录测试；不得修改视频、Canvas、共享后端生成、共享模型设置、日志/积分 service/repository。
- 可复用前置发现：`agent-investigate-image-flow.md`、`agent-investigate-cross-cutting.md`、`agent-investigate-test-seams.md` 已完成；推荐复用 Canvas 异步图片 create/poll/materialize seam，保留 local BYOK 零平台积分策略，远程任务必须保留准确 platform/upstream ID。
- 调度建议：直接重派 image implementer；重派前要求读取上述三份发现和已归档 prompt，先确认实际私有文件清单。完成后只跑非浏览器聚焦测试。

### 2. video workbench

- 精确状态：`未开始`，且 wave-1 视频依赖也未完成。
- 证据：不存在 `agent-investigate-video-flow.md`、`agent-investigate-video-flow-retry.md`、`subagent-prompt-implement-video-workbench.md` 或实现发现文件。只有原始 `subagent-prompt-investigate-video-flow.md` 和补偿调查 `subagent-prompt-investigate-video-flow-retry.md`，均没有对应发现报告。
- 归属/预期边界：视频工作台私有 `web/src` 页面/组件/hooks/store/API service 及同目录测试；不得修改 Canvas 视频节点或共享配置、日志、积分、后端生命周期文件。
- 可复用前置发现：`agent-investigate-cross-cutting.md` 已覆盖视频关键风险，包括 compatibility/first-party 双路径、浏览器/服务端双轮询、legacy failure refund 缺口、local log ID 错配；但它不能替代缺失的专门视频调查。
- 调度建议：先重派只读 `investigate-video-flow` 或 `investigate-video-flow-retry`，完成专属发现文件并锁定私有写入边界；随后再重派 video implementer。不要跳过调查直接实现。

### 3. shared generation contract

- 精确状态：`未开始`。
- 证据：不存在 shared implementation prompt 或 `agent-implement-shared-generation-contract.md`；没有共享后端/配置/日志/积分业务 diff，也没有测试输出。
- 归属/预期边界：共享 settings/model profile、generation task identity/lifecycle、history metadata projection、logging/credit accounting 及其直接测试；不得修改工作台私有 UI 文件。
- 可复用前置发现：`agent-investigate-cross-cutting.md` 已完成并给出明确候选边界；关键项是 platform task ID 传播、兼容请求幂等、统一终态/refund、`success`/`succeeded` 映射、远程 metadata 不使用本地随机 log ID。
- 调度建议：可在视频调查完成后重派 shared implementer；其 prompt 必须引用 cross-cutting 发现，并先声明与 image/video workbench 的文件所有权。若修改共享 API 返回结构，后续两个工作台需以该契约为依赖重派或复核。

## 已有调查与局部验证

- 已完成并可作为实现输入：`agent-investigate-image-flow.md`、`agent-investigate-cross-cutting.md`、`agent-investigate-test-seams.md`。
- 调查记录中的既有非浏览器验证：图片相关 Bun 测试 `31 pass, 0 fail`；一组 Go service proxy/parser 测试通过。它们属于 wave-1 调查基线，不是 wave-2 实现验证。
- 没有发现独立测试输出文件、coverage、JUnit/TAP 或其他 wave-2 测试产物。
- `agent-investigate-cross-cutting.md` 记录的关键未覆盖项仍存在：远程 workbench task identity、兼容请求幂等、legacy video refund、generic async image timeout、history status/result 映射及日志启动失败竞态。

## 冲突风险与重派边界

- 当前没有业务文件写入冲突；所有可见改动都是未跟踪 workflow 文档。`codex-image-resolution-config` 是另一套未跟踪 workflow 产物，不能删除、移动或纳入本任务。
- 最高风险是共享文件竞争：shared implementer 可能触及 `web/src/services/api/*`、generation task/history API、Go service/repository；image/video implementer 必须避免这些共享文件，除非协调后重新划定所有权。
- 建议顺序：补齐视频只读调查 -> 并行重派 image implementer 与 video implementer（各自私有文件边界）-> shared generation contract 串行或在确认无重叠后并行 -> 聚焦 verifier。
- 任何 agent 重派后都必须先归档完整 prompt，并创建对应 `agent-*.md`；旧 agent ids `not_found` 不能视为已完成。

## 实际读取 Skill

- `/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md`（完整读取）

## 阻塞项

- 本恢复审计无阻塞。
- 实现调度阻塞：视频实现缺少专门 wave-1 调查；三个 wave-2 实现均无发现文件、业务改动或测试结果，因此不能进入直接查验。
