# 图片工作台与共享图片组件 i18n

## 发现

- 图片工作台的本地日志使用中文 `生成中`、`成功`、`失败` 作为持久化状态，并在写入后端历史时再次映射为机器值。
- 日志同时持久化固定 `zh-CN` 格式的 `time` 字符串，切换语言后无法即时更新。
- 图片设置、模型选择器、生成等待组件、图片工具函数和参考图提示词被 Canvas 等模块复用，模块级翻译缓存会让共享调用方无法读取当前语言。
- 图片 API 包含前端校验和 fallback 文案，也包含服务端 `msg`、provider error、Gemini block reason 等动态内容，两者需要保持明确边界。
- `web/src/services/api/image-background.ts` 仅返回协议字段，没有用户可见文案，无需修改。

## 修改文件

- `web/src/pages/image/index.tsx`
- `web/src/components/image-settings-panel.tsx`
- `web/src/components/model-picker.tsx`
- `web/src/components/image-generation-pending.tsx`
- `web/src/services/api/image.ts`
- `web/src/lib/image-utils.ts`
- `web/src/lib/image-reference-prompt.ts`
- `web/src/i18n/formatters.ts`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`
- `codex/workflow20260803_codex-i18n-architecture/agents/image-workbench.md`

## 状态与日期设计

- `GenerationLog.status` 统一为稳定机器值 `pending | success | failed`。
- IndexedDB、本地序列化、后端历史写入、筛选和渲染均使用同一组机器值；渲染时再通过 `imageWorkbench.logs.status.*` 翻译。
- 项目未上线，未增加旧中文状态兼容分支。
- 删除日志中的 locale 格式化 `time` 字段，以 `createdAt` 作为时间事实来源。
- 日志卡片使用 `formatDateTime(log.createdAt)` 在渲染时格式化，因此不刷新切换语言后日期会立即变化。
- 远程任务匹配继续使用同一创建时间语义，仅将比较值改为由 `createdAt` 生成的 ISO 字符串。

## 实现结果

- 图片工作台的标题、按钮、表单、placeholder、Tooltip、aria-label、Drawer、Modal、Toast、错误兜底、空状态、加载状态、下载名、参考图标签和日志文案均进入语言资源。
- `ImageSettingsPanel`、`ModelPicker` 和 `ImageGenerationPending` 使用 `useTranslation`，默认 placeholder、空状态、质量/尺寸标签和 pending messages 会随语言切换。
- `imageQualityLabel`、`imageSizeLabel`、`imageReferenceLabel` 和非 React API/工具在调用时读取全局 i18n，不缓存当前语言的翻译结果。
- `formatBytes`、`formatDuration`、尺寸和计数改用当前 locale 的 Intl；图片张数和日志计数通过 i18next `{ count }` 复数规则选择资源。
- 参考图请求说明使用当前语言和 `Intl.ListFormat`，保留原有引用顺序及从 1 开始的编号语义。
- 图片 API 只翻译前端拥有的 validation/fallback；服务端 `payload.msg`、provider error、原始响应文本和 block reason 保持原样，Gemini block reason 仅嵌入本地化上下文。
- 未调整路由、API 合同、生成流程、存储 key、样式或构建命令。

## 边界

- 用户提示词、素材标题、上传文件名、模型名、协议值、MIME、API 字段和服务端动态错误不翻译。
- 前端自动创建的素材标题、来源、参考图文件名和下载文件名按创建或下载时的当前语言生成。
- 共享 helper 的其他调用方将在其下一次渲染时读取当前语言；本批次未越界修改 Canvas 或视频页面。
- 项目没有 ESLint script 或 ESLint 依赖，本批次不声明 ESLint 验证。

## 验证

- `cd web && bun run build`：成功。
- TypeScript `tsc --noEmit` 与 Vite production build 均通过，完成 8244 个模块，Vite 用时 5.42 秒。
- 构建仅报告项目已有的动态/静态 import 混用和大 chunk 警告。
- 中英文资源各 571 个叶子 key，key 差异为 0。
- 限定文件共检查 134 个静态翻译引用和 7 个动态 key，缺失为 0。
- 限定源码中文硬编码扫描结果为 0。
- TSX 用户可见字符串 AST 扫描仅剩分隔符、方向符号、空图片 alt 和百分号，无直接 UI 文案。
- 中英文运行时 helper 检查通过：字节、时长、尺寸和参考图标签均按当前 locale 输出。
- `git diff --check`：通过。
