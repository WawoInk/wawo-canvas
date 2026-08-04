# 账户模块 i18n

## 发现

- 账户模块覆盖资料、密码、企业概况、成员管理、企业积分流水、个人使用记录和个人积分记录。
- 原实现包含固定中文角色/状态映射、表格与表单文案、消息提示、CSV 文件名与列名，以及固定 `toLocaleString("zh-CN")` 日期格式。
- `account-log-export.ts` 仅提供通用 CSV 转义、分页拉取和下载能力，没有自有用户可见文案，因此无需修改。
- `i18n/formatters.ts` 已提供基于当前语言的 `formatDateTime` 和 `formatNumber`，本任务直接复用，无需扩展。

## 修改文件

- `web/src/pages/account/index.tsx`
- `web/src/pages/account/account-logs.tsx`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`

## 实现结果

- 所有前端自有账户文案迁移到语义化 `account.*` key，并在 React 组件中使用 `useTranslation`。
- 角色、状态、操作、来源和积分流水类型改为翻译 key 映射，未知服务端值仍按原值展示。
- CSV 文件名、列名和值标签在用户点击导出时按当前语言生成。
- 日期时间统一使用 `formatDateTime`；成员数、分页总数和积分单位使用 i18next `count` 复数规则；普通数量使用 `formatNumber`。
- 日期筛选展示格式随语言切换，中文为 `YYYY-MM-DD`，英文为 `MM/DD/YYYY`。
- 账户路由、API、状态更新、积分业务含义和样式均未调整。

## 剩余边界

- 后端 `{ code, data, msg }` 返回的原始错误文本继续直接展示；仅前端兜底错误已国际化。完整翻译服务端错误需要稳定错误码或后端 i18n。
- Ant Design 表格的空状态、分页和加载反馈由全局动态 Ant Design locale 提供，本模块没有重复覆盖。

## 验证

- 中英文资源各 302 个叶子 key，差异为 0。
- 账户代码引用 197 个 `account.*` key，缺失为 0。
- 账户限定源码中未发现中文硬编码或固定 `toLocaleString("zh-CN")`。
- i18next 复数验证通过：`1 member`、`2 members`、`2 records`、`2 积分`。
- `cd web && bun run build` 成功，TypeScript 与 Vite 构建通过。
- 构建仅输出项目已有的动态/静态导入和大 chunk 警告，无新增错误。
