# 素材与提示词 i18n

## 发现

- “我的素材”、公共素材库、企业素材库和提示词模块包含按钮、筛选、表单、确认框、Toast、空状态、aria-label、下载文件名及前端错误兜底等硬编码文案。
- `ALL_PROMPTS_OPTION` 原值为中文“全部”，同时承担 UI 文案和查询状态；语言切换后会污染筛选语义。
- 提示词日期和企业素材日期固定使用 `zh-CN`，导入数量与提示词总数未使用 i18next 复数规则。
- 素材标题、标签、分类、描述、提示词正文、服务端错误信息、MIME 和 `metadata.source` 等动态或协议数据必须保持原样。

## 修改文件

- `web/src/pages/assets/index.tsx`
- `web/src/pages/assets/asset-transfer.ts`
- `web/src/pages/asset-library/index.tsx`
- `web/src/pages/enterprise-assets/index.tsx`
- `web/src/pages/enterprise-assets/enterprise-asset-form.ts`
- `web/src/pages/prompts/index.tsx`
- `web/src/components/prompts/prompt-card.tsx`
- `web/src/components/prompts/prompt-detail-dialog.tsx`
- `web/src/components/prompts/prompt-select-dialog.tsx`
- `web/src/services/api/prompts.ts`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`

`web/src/components/prompts/use-prompt-list.ts` 继续复用筛选 sentinel，无需直接接入语言状态，因此未修改。

## 实现结果

- React 组件使用 `useTranslation`，前端工具和校验函数使用全局 i18n 获取当前语言文案。
- 新增 `assets.*`、`assetLibrary.*`、`enterpriseAssets.*`、`prompts.*`，并补充复用的 `common.actions.*`、`common.fields.*`、`common.assetTypes.*` 和 `common.states.*`。
- 提示词“全部”筛选改为稳定 sentinel `__all__`；仅在渲染 sentinel 时显示本地化“全部”，真实分类和标签保持服务端原值。
- `formatPromptDate` 和企业素材时间统一复用 `i18n/formatters.ts`；提示词总数和素材导入数量使用 `{ count }` 复数规则，尺寸数字使用当前 locale。
- 导出 ZIP 文件名、表单校验、上传与下载错误、确认框、空状态和无障碍标签均随语言切换。
- 路由、API 合同、查询参数、业务逻辑、样式和构建命令未调整。

## 边界

- 后端 `{ code, data, msg }` 返回的原始错误继续展示；仅前端拥有的 fallback 和 validation 文案国际化。
- 用户素材内容、提示词正文、服务端分类/标签、企业成员名称、MIME、文件扩展名及 metadata/source 标识不翻译。
- `formatBytes` 沿用项目现有通用工具和标准字节单位，没有在本批次修改共享实现。

## 验证

- 中英文资源各 454 个叶子 key，差异为 0。
- 限定源码中文扫描只剩既有代码注释。
- TypeScript AST 用户可见字符串扫描未发现 JSX、表单属性、Toast 或前端错误中的直接硬编码。
- `git diff --check`：通过。
- `cd web && bun run build`：成功。
- 构建完成 8244 个模块，Vite 用时 4.71 秒。
- 构建仅报告项目已有的动态/静态 import 混用和大 chunk 警告，无 TypeScript 或 Vite 错误。
