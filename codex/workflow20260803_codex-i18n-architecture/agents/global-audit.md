# 全局非 Canvas / 非管理后台 i18n 只读审计

## 范围与结论

- 扫描范围：`web/src`。
- 排除：`pages/canvas/**`、`pages/admin/**`、`i18n/locales/**`、`*.test.*`、`*.spec.*`、`__tests__/**`。
- 共扫描 101 个 TypeScript/JavaScript 模块，并补充检查 `styles/globals.css`。
- 未修改任何业务代码。
- 未发现高严重度问题；发现 4 项中严重度、2 项低严重度遗漏。

## 发现

### 中严重度

#### 1. 自适应比例仍显示英文 `adaptive`

- `web/src/components/video-settings-panel.tsx:125`

自适应比例按钮的第二行直接渲染 `"adaptive"`。这不是必须原样展示的协议字段，而是展示层提示；同文件调用的 `seedancePixelLabel()` 已能通过 `videoSettings.autoMatch` 返回本地化文本，但该分支绕过了它。中文界面会混入英文。

#### 2. 上游积分空值使用英文技术占位 `null`

- `web/src/pages/account/account-logs.tsx:70`
- `web/src/pages/account/account-logs.tsx:161`

表格和 CSV 导出在 `upstreamCredits` 缺失时由前端主动生成 `"null"`。它不是服务端原文或协议透传，而是用户可见的空值文案，应改用语义化 i18n key，例如“暂无”/“Not available”。

#### 3. 高精度积分仍使用固定英文式数字分隔符

- 定义：`web/src/lib/decimal.ts:38-43`
- UI：`web/src/components/layout/user-status-actions.tsx:73`
- UI/CSV：`web/src/pages/account/index.tsx:57-58,168,240,450,452,617`
- UI/CSV：`web/src/pages/account/account-logs.tsx:69,83-84,159,377,379`

`formatDecimal()` 手工固定使用 `,` 分组和 `.` 小数点，没有读取当前 locale，不符合数字应通过 `Intl.NumberFormat` 本地化的要求。`zh-CN` 与 `en-US` 当前恰好大多采用相同分隔符，因此现有两种语言下影响不明显，但扩展其他语言后会直接产生错误格式。高精度计算/存储与用户界面格式化应分离，CSV 是否需要机器稳定格式也应单独定义。

#### 4. 版本日期直接显示源字符串

- 解析：`web/src/lib/release.ts:13-16`
- 展示：`web/src/components/layout/version-release-modal.tsx:77`

版本日期以 `YYYY-MM-DD` 源字符串直接显示，没有经过 `Intl.DateTimeFormat`/`formatDate()`。切换语言时日期顺序和本地习惯不会变化。日期为空的 `Unreleased` 项可以继续保持空白。

### 低严重度

#### 5. WebDAV 英文错误中混入中文全角冒号

- `web/src/services/webdav-sync.ts:139`

错误由 `` `${fallback}：${response.status}` `` 拼接。英文 locale 下也会出现全角中文冒号。该标点是前端展示模板的一部分，不属于 HTTP 协议值，应该进入翻译模板或至少使用 locale 中性的分隔方式。

#### 6. 少量可见数字未经过 locale 格式化

- 生成进度百分比：`web/src/components/image-generation-pending.tsx:41`
- 视频秒数选项：`web/src/components/video-settings-panel.tsx:136`
- 负面提示词计数：`web/src/components/video-settings-panel.tsx:181`
- 视频秒数摘要：`web/src/components/video-settings-panel.tsx:204`
- 自动渠道序号：`web/src/stores/use-config-store.ts:431`

这些位置直接拼接整数、百分号或计数。当前支持语言下视觉差异很小，但仍未完整落实 `Intl.NumberFormat` 要求。分辨率、宽高比、MIME、模型参数等协议/技术值不计入此项。

## Key 与资源校验

- `zh-CN.json`：1,560 个叶子 key。
- `en-US.json`：1,560 个叶子 key。
- 两份资源 key 差异：0。
- 插值变量集合差异：0。
- 翻译调用：939 次，其中静态 key 897 次、动态 key 42 次。
- 静态 key 按 i18next 复数规则（基础 key 或 `_one`/`_other`）校验，缺失 0。
- 对动态模板的 62 个有限展开值进行核对，缺失 0；范围包括模型能力、WebDAV 域/阶段、SEO 页面、素材类型、工作台状态和参考素材类型。
- `en-US.json` 中唯一中文值为语言选项 `"中文"`，属于预期显示。

## 扫描方法

1. 使用 TypeScript AST 扫描 JSX 文本、可见属性、对象式 UI 配置、Toast/Modal/Error fallback、模板字符串以及 `t()`/`i18n.t()` 调用。
2. 使用文本扫描补充中文及中文标点、英文展示 fallback、日期/数字/货币格式化调用、CSS `content`。
3. 将两份 locale 展平后比较叶子 key、插值变量和 i18next 复数变体。
4. 对动态 key 的类型联合、常量映射和模板取值逐项展开。
5. 对候选逐条人工区分展示文案与合法技术值。

AST 结果未发现直接 JSX 中文/英文句子、硬编码 `placeholder`/`title`/`aria-label`/Tooltip/Modal 按钮文案，也未发现缺失的静态翻译 key。

## 合法豁免

- 用户或内容数据：用户名、素材标题/正文、提示词、标签、备注、服务端 `msg`/上游错误原文。
- 品牌与模型：Canvan、GitHub、OpenAI、Gemini、XvanAI、Codex、Agent、模型名和音色名。
- 协议与技术值：URL、路由、HTTP 方法/状态、MIME、文件扩展名、模型协议值、分辨率、宽高比、像素尺寸、`AbortError`。
- 解析标记：`Unreleased` 和“新增/修复/调整/文档”用于解析/匹配，实际标签已通过 i18n 展示。
- 开发内容：注释、CSS class、事件名、store key、文件名和日志内部状态。

## 残余风险

- 动态 key 目前依赖有限类型和常量映射；未来新增状态或能力时仍可能忘记补资源，建议后续加入 CI 静态检查或类型化 key。
- API、localStorage、用户内容和远端 Changelog 正文属于运行时内容，AST 无法验证其语言。前端 fallback 已本地化，但原始内容会按原语言展示。
- `CHANGELOG.md` 条目正文当前作为版本内容原样展示；英文界面仍可能看到中文发布说明。本审计将其视为内容本地化问题，而不是组件 UI 硬编码。
- Canvas、`pages/admin/**` 和测试文件按要求未纳入本次审计。
- 本次为只读审计，未执行浏览器冒烟、构建或运行时语言切换验证。

## 主任务处理结果

- 自适应比例、上游积分空值、版本日期、WebDAV 状态标点、百分比、秒数、计数和渠道序号已按审计建议修复。
- `formatDecimal()` 继续保留精确 decimal string，不转换为有精度损失的 JavaScript number；分组、小数点、负号和数字字形由 `Intl.NumberFormat.formatToParts()` 提供。
- 新增 `web/src/lib/decimal.test.mjs`，覆盖超出安全整数范围的小数格式化与中英文 locale。
- `bun test src/lib/decimal.test.mjs src/services/api/generations.test.mjs`：12 个测试全部通过。
- 整合后的 `cd web && bun run build`：成功；仅保留项目已有的 import/chunk 警告。
