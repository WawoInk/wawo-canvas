# Prompt

修复当前分支 `codex/align-generation-workbenches` 的后端查验问题，仅修改 Go 后端/测试，不改 `web/`。

先完整读取 ponytail、tdd，以及工作流内 `agent-verify-config-log-credit.md`、`agent-verify-workbench-alignment.md`、`agent-implement-generation-contract-serial.md`、三份 wave-1 调查。按报告精确位置用最小根因修复：1) 图片/视频 compatibility task 取消、失败、超时统一进入幂等终态并只退款一次；2) 异步图片有服务端超时结算，避免永久 pending；3) 生成日志创建失败必须阻止扣费/启动，日志和账务同一可验证流程；4) 画布/图片/视频统一读取系统设置的 generation profile/model/provider 投影，删除入口级分叉；5) 只有结果已物化并拿到正确 `fileId/metadata` 后才标成功。保持 handler/service/repository/model 分层和 `{ code,data,msg }`。

TDD：逐个公共 seam 红-绿，运行聚焦 Go tests 和 `git diff --check`；不要运行会重写 tracked `server` 的构建，若 `server` 已有 diff只记录给 closer。不得修改 web、依赖、文档全局文件，不提交、不运行浏览器、不触碰 `codex-image-resolution-config`。

Prompt：`codex/workflow2026-08-19_codex-align-generation-workbenches/subagent-prompt-fix-backend-verification.md`
发现：`codex/workflow2026-08-19_codex-align-generation-workbenches/agent-fix-backend-verification.md`
确认分支，不创建分支/worktree；先原样归档 prompt。最终最多 8 行：状态、修复项、改动文件、测试结果、发现文件、Skills、残余风险/阻塞。
