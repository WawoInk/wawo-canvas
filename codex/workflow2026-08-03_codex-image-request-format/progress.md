# 当前状态

- 已读取 `AGENTS.md`、`CONTEXT.md`、前端/API/业务流程知识文档，以及 `ponytail`、`diagnosing-bugs` 技能说明。
- 已确认当前工作区位于 `codex/image-request-format`，存在并行中的后端、Canvas 和文档改动；本任务不会覆盖这些改动。
- 已通过 Context7 查阅 Ant Design 6.5 的 `Form.List` 动态数组用法；项目当前 `antd` 版本为 `^6.4.2`。
- 已确认公开配置复用 `GET/POST /api/admin/settings` 完整设置链路，图片模型来源为 `modelChannel.imageModels`。
- 已在 `web/src/services/api/admin.ts` 增加管理端协议映射类型。
- 已在 `web/src/pages/admin/settings/index.tsx` 增加“图片请求格式”动态配置、默认值及归一化。
- 已完成局部格式检查和真实浏览器验证，未点击保存，未修改数据库。
- 未修改 Go、后端测试、Canvas/图片请求构建、Store、CHANGELOG、todo 或 pending-test 文件。

## 主线完成状态

- 后端公开设置新增并归一化 `imageRequestFormats`，仅保留当前图片模型和两种合法格式。
- 普通用户公开设置 DTO 与配置 Store 已加载该字段。
- 同步/异步图片生成和编辑请求均支持显式格式覆盖，未配置模型保持原默认格式。
- 本地管理员设置已保存 `gpt-image-2-open-1-edit -> application/json`。
- 已补充 `CHANGELOG.md`、待测试记录和 API 知识文档；TODO 中没有对应待办，无需移动。

## URL 结果修复

- 已确认 `gpt-image-2-open-1-edit` 的异步任务成功响应为 `data.images[].url`，与生成任务共用前端解析和结果保存路径。
- API 容器日志显示失败发生在 `/api/v1/files/proxy-upload` 下载供应商 URL 时，具体为 `TLS handshake timeout` 和 `unexpected EOF`，不是响应字段解析错误。
- 共享代理下载入口现最多尝试 3 次，将 TLS 握手等待放宽到 30 秒，并在 GET 或完整读取出现瞬时错误时重新下载。
- 明确的非重试型 4xx 仍立即失败；该修复不包含模型名称特判，同时覆盖图片生成和图片编辑 URL 结果。
