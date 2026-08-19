只读审计当前分支 `codex/align-generation-workbenches` 的后端共享契约，重点确认用户明确要求是否真正落实，不改代码。

任务 slug：verify-config-log-credit
波次：wave-4
并行组：parallel-verification
检查范围：相对基准 `a13233e4649ed39f220b11b0c865a2e4997f581f` 的后端改动与现有画布/图片/视频三入口调用链。逐项核对：1) 三入口都复用系统设置中的模型/provider/能力配置，没有独立硬编码或双投影漂移；2) 每次生成任务日志严格落库，任务状态和结果关联正确；3) 积分扣账按任务幂等，重试/重复轮询不重复扣费；4) 失败/超时/取消只退款一次；5) 远程图片和视频结果 `fileId/metadata` 对应正确。运行聚焦 Go 测试（避免改写 tracked 二进制；若现有 `server` diff 是生成物，记录为必须清理）。按 code-review 风格先列问题，P0-P3，带文件/行号；无问题明确写无。不得运行真实浏览器。
写入边界：仅 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-verify-config-log-credit.md` 和 `agent-verify-config-log-credit.md`。
先完整读取 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`、`/Users/eldenpdx/.agents/skills/tdd/SKILL.md` 以及相关调查/实现发现文件。先原样保存 prompt，确认分支，不创建分支/worktree，不提交，不触碰 `codex-image-resolution-config`。最终最多 8 行：状态、发现（按严重度）、验证结果、发现文件、已读 Skills、阻塞项。
