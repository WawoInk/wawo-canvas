# Backend Verification Fix

状态：completed；仅修改 Go 后端/测试与本报告；分支 `codex/align-generation-workbenches`。

## 修复

- `ProxyVideoTaskDelete` 的兼容取消统一通过共享终态仲裁并退款；legacy failure/cancel/timeout 已由 `OnTaskCompleted` 使用同一退款语义。
- 异步图片提交后启动服务端 deadline observer；超时以 `TASK_SYNC_TIMEOUT` 进入失败终态，借助任务/账务幂等只退款一次。
- `ProxyAIRequest` 现在必须先成功创建 generation log，失败立即返回，不扣费、不启动上游请求。
- 异步图片上游成功先落 `pending`；只有 metadata 含非空 `fileIds` 才转 `success`，避免未物化结果被标成功。
- 历史映射继续统一 `success`/`succeeded`，兼容任务继续使用已解析的系统 profile/provider/billing 投影。

## 验证

- 聚焦 Go tests：`service`、`handler`、`model`、`config` 通过。
- `git diff --check` 通过。
- 未运行构建、浏览器、全量 Go tests；未修改 `web/`、依赖、全局文档或 `codex-image-resolution-config`。

## 残余

- 图片平台文件上传仍由现有前端回写 metadata；服务端现在会保持 `pending`，但不负责替前端物化文件。
- `server` 仍有既有 tracked ELF diff，未触碰。
