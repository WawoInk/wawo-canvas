# 公共页面 i18n

## 发现

- 公共首页、登录页、404 页面、版本弹窗、GitHub 链接和复制提示原先包含硬编码 UI 文案。
- 首页富文本说明需要保留两处高亮样式，使用 `Trans` 让不同语言可以独立调整语序。
- 更新日志类型是解析器产出的中文协议值，展示时映射为双语标签，颜色判断与原始数据保持不变。
- `use-version-check.ts` 仍包含中文 toast，更新日志正文也来自动态 CHANGELOG；两者不在本限定任务允许修改的文件范围内。
- 登录 OAuth 错误、接口错误、提示词标题和更新日志正文属于上游动态内容，本任务不改写。

## 改动文件

- `web/src/pages/home/index.tsx`
- `web/src/pages/login/index.tsx`
- `web/src/pages/not-found/index.tsx`
- `web/src/components/layout/version-release-modal.tsx`
- `web/src/components/layout/github-link.tsx`
- `web/src/hooks/use-copy-text.ts`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`

新增了 `home`、`auth`、`notFound`、`versionRelease` 资源，并补充 `common.register`、`common.copied`、`common.github`。两个语言文件递归检查均为 102 个叶子 key，key 集合完全一致。

## 验证

- `git diff --check`：通过。
- 目标 JSX 直接文本节点扫描：无残留 UI 文案。
- `cd web && bun run build`：成功。
- 构建完成 8243 个模块，Vite 用时 5.11 秒。
- 构建仅报告既有动态/静态导入混用和大 chunk 警告，无 TypeScript 或 Vite 错误。
