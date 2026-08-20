# recover-image-workbench

- 状态：completed
- 任务 slug/角色/执行模式：`recover-image-workbench` / image workbench recovery auditor / 只读审计
- 波次/并行组：`wave-3-recovery` / `recovery-audit`
- 分支与基准：当前分支为 `codex/align-generation-workbenches`；`HEAD` 与基准提交 `a13233e4649ed39f220b11b0c865a2e4997f581f` 相同，未产生提交。
- 图片工作台状态：未发现 `web/src` 图片工作台业务或测试 diff；不存在 `agent-implement-image-workbench.md` 或 `agent-implement-image-workbench-retry.md`；仅存在两个实现 prompt 归档，故不是部分完成，当前可继续重派实现。
- 当前非 workflow 改动：`service/compatibility_lifecycle.go`、`service/compatibility_lifecycle_test.go`、`service/generation_mapper.go`、`service/generation_mapper_test.go`、`service/task_sync.go`，以及已跟踪二进制 `server`；这些属于共享后端首轮改动，不归图片工作台私有文件。
- 共享后端首轮改动：仍在工作区，内容包括兼容失败/超时退款进入共享终态仲裁、`success`/`succeeded` 历史映射、对应退款幂等与状态投影测试；`agent-implement-generation-contract-serial.md` 记录了来源及聚焦 Go 测试通过。
- Git 状态与风险：工作区还包含两套未跟踪 workflow 目录；`codex-image-resolution-config` 未读取、未修改、未移动、未删除。`server` 的二进制变更无法仅凭当前 diff 归因，需后续整合者确认是否保留。
- 下一步建议：可直接重派图片工作台实现 Agent，先读取图片/cross-cutting/test-seams 发现和共享后端交接；限定 `web/src` 图片工作台私有文件及同目录测试，禁止触碰共享后端和另一 workflow；不运行真实浏览器。
- 实际读取 Skill：`/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md`（完整）。
