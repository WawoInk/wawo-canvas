# 配置、版本检查与 WebDAV 同步 i18n

## 发现

- 配置弹窗同时覆盖渠道、模型、图片、视频、音频与 WebDAV，是全局用户文案最集中的共享入口之一。
- WebDAV 同步原先把中文阶段名称作为进度状态传递，不适合在运行时切换语言。
- 渠道默认名称、模型标签和 API/WebDAV 前端 fallback 分散在组件、store、hook 与 service 中。
- 服务端 `{ code, data, msg }` 中的动态 `msg` 不应被前端改写；仅迁移前端拥有的 validation 与 fallback。

## 修改文件

- `web/src/components/layout/app-config-modal.tsx`
- `web/src/hooks/use-version-check.ts`
- `web/src/services/api/request.ts`
- `web/src/services/app-sync.ts`
- `web/src/services/blob-storage.ts`
- `web/src/services/upload-blob.ts`
- `web/src/services/webdav-sync.ts`
- `web/src/stores/use-config-store.ts`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`

## 实现结果

- 配置弹窗的 Tab、表单、按钮、placeholder、提示、Toast、同步摘要和模型选项全部进入 `config.*` 资源。
- WebDAV 进度改为稳定的 `AppSyncStage` 机器值；界面渲染时再通过 `config.webdav.stages.*` 翻译。
- 同步事件的动态详情保留在 `detail`，不会被误当作翻译 key 或持久化状态。
- 版本检查、上传、Blob、请求层与 WebDAV 的前端 fallback 进入 `errors.*` 和 `versionRelease.*`。
- 日期、数量和文件大小在展示时按当前 locale 格式化。
- 路由、API 合同、同步域、存储格式、业务流程和构建命令未改变。

## 验证

- 中英文资源各 814 个叶子 key，差异为 0。
- 限定源码中文扫描仅剩开发注释，没有用户可见硬编码。
- `cd web && bun run build`：成功，TypeScript 与 Vite production build 均通过。
- 构建仅报告项目已有的动态/静态 import 混用和大 chunk 警告。
