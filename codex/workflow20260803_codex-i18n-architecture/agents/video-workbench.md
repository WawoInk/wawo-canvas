# 视频工作台与共享音视频组件 i18n

## 发现

- 视频工作台与图片工作台一样，把中文 `生成中`、`成功`、`失败` 作为本地日志状态，并持久化固定 `zh-CN` 格式的时间字符串。
- `seedance-video.ts` 同时为视频工作台和 Canvas 提供比例标签、引用编号、提示词上下文与校验错误，是共享国际化边界。
- 视频与音频 API 同时包含前端 validation/fallback 和服务端动态错误，必须只翻译前端拥有的文案。
- Node 测试环境没有浏览器语言检测结果，会使用英文 fallback，因此旧中文文本断言不再稳定。

## 修改文件

- `web/src/pages/video/index.tsx`
- `web/src/components/video-settings-panel.tsx`
- `web/src/components/audio-settings-panel.tsx`
- `web/src/lib/seedance-video.ts`
- `web/src/services/api/video.ts`
- `web/src/services/api/audio.ts`
- `web/src/components/video-settings-panel.test.tsx`
- `web/src/services/api/video.test.mjs`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`

## 实现结果

- 视频日志状态统一为 `pending | success | failed`，本地缓存、后端历史、任务恢复、取消和渲染使用同一组机器值。
- 删除持久化的格式化 `time`，日志卡片按 `createdAt` 和当前 locale 动态格式化。
- 页面按钮、引用媒体、空状态、Modal、Toast、文件名、aria-label、日志状态与设置面板全部进入语言资源。
- Seedance 比例、引用编号、提示词上下文、引用视频校验与帮助文案在调用时读取当前语言。
- 视频和音频 API 仅翻译前端 validation/fallback；服务端 `msg`、provider error 与动态状态错误保持原样。
- 视频设置与 API 测试显式使用 `en-US`，避免测试结果依赖宿主浏览器语言。
- 路由、API 合同、任务轮询、存储 key、生成流程、样式和构建命令未调整。

## 验证

- 中英文资源各 697 个叶子 key，差异为 0。
- 限定业务源码中文扫描结果为 0；测试文件仅保留作为输入数据的中文提示词。
- `bun test src/services/api/video.test.mjs src/components/video-settings-panel.test.tsx`：4 个测试全部通过。
- `cd web && bun run build`：成功，TypeScript 与 Vite production build 均通过。
- 构建仅报告项目已有的动态/静态 import 混用和大 chunk 警告。
- `git diff --check`：通过。
