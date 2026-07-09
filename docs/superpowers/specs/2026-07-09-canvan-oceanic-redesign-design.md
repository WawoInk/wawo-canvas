# Canvan 海洋蓝全站重设计

- **日期**: 2026-07-09
- **范围**: 全站视觉重设计（品牌、配色、logo、页面布局、AI 状态动效）
- **约束**: 仅改视觉层，绝对不影响前端调用 URL 与后端功能
- **方案**: A — 集中换肤 + 分层精修

## 背景与目标

项目是 Vite + React 19 + TS 应用，同时使用两套 UI：

- **Ant Design v6** — 51 个文件，主题集中在 `src/lib/app-theme.ts` 的 `getAntThemeConfig()`，当前为单色中性（黑/白/stone 灰）。
- **shadcn / Tailwind v4** — 4 个文件，token 在 `src/styles/globals.css`，当前 CSS 变量也是单色灰。`components.json` 已配置 `@react-bits` 与 `@magicui` registry。

现有品牌为"无限画布 / Infinite Canvas"，logo `public/logo.svg` 是 `currentColor` 单色三角符号，通过 CSS `mask` 插入。约 170 处 `stone-` 暖灰散布在页面 JSX 中。应用默认深色，主题经 zustand 持久化（`infinite-canvas:theme_store`）。

新品牌 **Canvan** 提供了 `web/public/logos/canvan-logo.svg`（2:1 宽幅彩色横排锁子，CANVAN 文字）与 `docs/design.md`（Oceanic 设计系统：深蓝 + 电青 + 海洋能量）。

**目标**：按 design.md 将全站重塑为 Canvan 海洋蓝视觉，更换 logo 与品牌名，引入克制的 reactbits/magicui 装饰，且不触碰任何 API 调用、路由与状态逻辑。

## 决策摘要

| 议题 | 决策 |
|---|---|
| 重设计范围 | 全站重设计 |
| 主题策略 | 双模式，默认深色（保留切换） |
| Logo 用法 | 彩色原锁子（非 mask 单色） |
| UI 路径 | antd 为主 + 局部 reactbits/magicui 点缀 |
| 品牌名 | 改为 CANVAN |
| AI 动效强度 | 中等：生成状态 + hero |
| 实现路径 | 方案 A：集中换肤 + 分层精修 |

## 第 1 节 · 调色板映射（品牌基底层）

将 design.md 色值映射到两个 token 源，使全部 antd + shadcn 组件自动跟随。

### `src/styles/globals.css` — shadcn CSS 变量

深色模式（`.dark`）：

| 角色 | 变量 | 值 |
|---|---|---|
| 背景 | `--background` | `#060F30` |
| 表面 | `--card` / `--popover` / `--sidebar` | `#0B163D` |
| 高亮表面 | （派生） | `#12204D` |
| 前景文字 | `--foreground` | `#FDFDFD` |
| 次要文字 | `--muted-foreground` | `#7183A8` |
| 边框 | `--border` | `#1D3A68` |
| 主色 | `--primary` | `#0A6CFE` |
| 焦点环 | `--ring` | `#01C7FD` |
| 危险 | `--destructive` | `#FF4D6D` |

浅色模式（`:root`）：

| 角色 | 变量 | 值 |
|---|---|---|
| 背景 | `--background` | `#F7FAFF` |
| 表面 | `--card` / `--popover` / `--sidebar` | `#FFFFFF` |
| 高亮表面 | （派生） | `#EEF5FF` |
| 前景文字 | `--foreground` | `#060F30` |
| 次要文字 | `--muted-foreground` | `#64748B` |
| 边框 | `--border` | `#D7E5FF` |
| 主色 | `--primary` | `#0A6CFE` |
| 焦点环 | `--ring` | `#0A6CFE` |
| 危险 | `--destructive` | `#FF4D6D` |

`--radius` 对齐 design.md。现有派生：`--radius` 基准 `0.625rem`(10px) 对应按钮/输入；`--radius-2xl = calc(var(--radius) * 1.8)` ≈ 18px 偏大。卡片目标 16px，故将 `--radius-2xl` 改为 `calc(var(--radius) * 1.6)` ≈ 16px（仅改 globals.css 该派生公式）。

新增显式高亮表面变量，深浅各一（shadcn 无内置 elevated token，需自定义）：

- 深色：`--surface-elevated: #12204D`
- 浅色：`--surface-elevated: #EEF5FF`

并在 `@theme inline` 映射 `--color-surface-elevated: var(--surface-elevated)`，供 Tailwind 类 `bg-surface-elevated` 使用（用于控件底色、表头、admin 菜单选中）。

### `src/lib/app-theme.ts` — antd token

将 `neutral` 对象改为 oceanic（函数签名 `getAntThemeConfig(dark)` 不变）：

- `colorPrimary` = `#0A6CFE`（深浅一致）；`colorInfo` / `colorLink` 跟随；`colorLinkHover` = `#0586FD`
- 深色 `menuBg` = `#12204D`，`menuText` = `#FDFDFD`，选中态加 cyan 左边条
- `selectSelectedBg` = `rgba(10,108,254,0.18)`，`selectSelectedColor` = `#FDFDFD`
- `tableSelectedBg` = `rgba(1,199,253,0.10)`，`tableSelectedHoverBg` = `rgba(1,199,253,0.16)`
- `borderRadius` 对齐：按钮/输入 10px，卡片 16px
- `colorBgLayout`（深）= `#060F30`，`colorBgContainer`（深）= `#0B163D`

### 语义色（全局）

success `#16C784`、warning `#FFB020`、error `#FF4D6D`、info `#0A6CFE`。

### `stone-` 批量替换策略

约 170 处 `stone-50…950` 暖灰 → 蓝灰语义，按映射表机械替换（不改逻辑）：

| 原 stone | 替换为 |
|---|---|
| `stone-950` / `stone-900`（深文字） | `foreground` 或 `#060F30` |
| `stone-800` / `stone-700`（次要文字） | `muted-foreground` / `#34466D` |
| `stone-200` / `stone-100`（浅表面/边） | `border` / `#D7E5FF` |
| `stone-500` / `stone-400`（占位/描述） | `#7183A8` / `#64748B` |
| `dark:bg-stone-900` 等 | `dark:border-[#1D3A68]` / surface 色 |

优先用 Tailwind 语义类（`bg-background`/`text-foreground`/`border-border`），硬编码色值次之。替换后 grep 核对，避免误伤非色值语境的 `stone`。

## 第 2 节 · Logo 与品牌替换

新锁子 2:1 宽幅彩色横排（CANVAN 文字），现有 CSS `mask`（只能单色）不再适用，改为直接 `<img>` 彩色。

### 资源

- `public/logo.svg` 内容替换为彩色 canvan-logo.svg（保持文件名，所有现有 `/logo.svg` 引用自动生效，零路由改动）。`public/logos/canvan-logo.svg` 保留为源。
- favicon：`index.html` `<link rel="icon" href="/logo.svg">` 已指向彩色锁子，直接生效。锁子 2:1 在方形 favicon 中被浏览器 contain 居中，可接受；如需更精致的方形图标，后续单独出，本期不做。
- `<title>` → `Canvan · AI 创作平台`；`<meta name="description">` → `Canvan — AI 无限画布创作平台`。

### Logo 组件

新增 `src/components/layout/brand-logo.tsx`，一处复用四处：

- props: `variant: "full" | "mark"`、`className?`、`height?: number`
- `full`：`<img src="/logo.svg" />`，按 height 等比缩放（2:1）
- `mark`：锁子的彩色图标符号。两种实现方式，实现时择一（优先方式 a，若裁切视觉效果不佳回退 b）：
  - (a) 从锁子裁出左侧符号区（CANVAN 文字左侧的图形部分）作独立 `<img src="/logo-mark.svg">`，需在 `public/` 生成该裁切文件
  - (b) 一个 `#0A6CFE` 实心圆角方块 + 白色 `C` 字（纯 CSS/inline SVG，无新资源）
- 用于空间受限处（移动端导航、浅色背景品牌位、favicon 邻近）
- 深色背景用 `full` 彩色原锁子；浅色背景用 `mark` 变体 + `Canvan` 文字（避免深底大色块在浅背景突兀）

### 四处替换

1. `app-top-nav.tsx:29-32` — mask span → `<BrandLogo variant={dark ? "full" : "mark"} height={22} />`，删去文字 `无限画布`（锁子已含 CANVAN 文字，导航不再重复显示品牌名）
2. `admin-layout.tsx:76` — mask span → `<BrandLogo variant="mark" height={28} />` + `Typography.Text` 改 `Canvan`
3. `login/index.tsx:94-95` — mask span → `<BrandLogo variant={dark ? "full" : "mark"} height={40} />`，标题 `账号登录` 保留
4. `admin/prompts` & `admin/assets` 的 `Image fallback="/logo.svg"` — 保持 `/logo.svg`，现指向彩色锁子，作占位封面可接受

### 品牌名

全站 `无限画布` → `Canvan`（标题、导航品牌、footer、后台侧栏）。不改产品功能文案（按钮"开始使用""打开画布"等保留）。

## 第 3 节 · 公开页与导航重设计

### 顶部导航 `app-top-nav`

- 背景 `bg-background/90 backdrop-blur-xl`（保留毛玻璃），底边 `border-border`（深蓝边替代 `stone-200/800`）
- 品牌：左侧 `<BrandLogo variant={dark ? "full" : "mark"} height={22} />`
- 导航项激活态：`primary` 下划线 + `primary` 文字；hover `text-primary`；图标 lucide 保留
- 右侧 `UserStatusActions`、主题切换、GitHub link 跟随新 token
- `MobileNavDrawer` 配色跟随

### 首页 `home`

- Hero 背景径向点阵：深色 `rgba(29,58,104,0.25)` 蓝点替代灰点；浅色 `#D7E5FF` 蓝点
- Hero 标题 `ai-title-aurora` 渐变改为蓝→青：`#0A6CFE → #01C7FD → #0CE0FC`，深浅两套
- 装饰圆圈虚线边 `border-primary/20` 替代 `stone-200`
- 副文案 `Highlighter` 高亮色：`#FF9800` 橙 → 删除或改 `#01C7FD`（design.md 禁暖色与海洋混用）；`#87CEFA` → `#0CE0FC`
- CTA：antd `type="primary"` 自动变蓝；次要按钮跟随
- 提示词展示网格：卡片边 `border-border`、hover 蓝光 shadow、`Tag` 跟随 token
- reactbits 点缀：hero 标题 Aurora 文字动画；magicui `BorderBeam` 包裹主 CTA 卡片（仅 hero）

### 登录页 `login`

- 背景同首页蓝点
- `<BrandLogo variant={dark ? "full" : "mark"} height={40} />`
- 标题 `账号登录` 字色 `foreground`；副文案 `text-muted-foreground`
- Form label `text-foreground`/`text-muted-foreground` 替代 `stone-800/200`
- `Segmented`/`Input`/`Button` antd 自动跟随海洋 token
- 登录卡片加 `rounded-lg border-border shadow` + 顶部一条 cyan 渐光线

### 404 `not-found`

跟随 token，logo + 蓝青配色。

## 第 4 节 · 工作台与后台精修

### 工作台（image / video / prompts / assets / canvas 列表 / asset-library）

- 容器/面板/卡片：antd `Card`/`Drawer`/`Modal` 自动跟随海洋 token（深 surface `#0B163D`、边 `#1D3A68`、圆角 16px）
- `stone-` 暖灰按第 1 节映射表替换为蓝灰语义
- 图标 lucide / @ant-design/icons 保留，颜色 `text-muted-foreground` / 激活 `text-primary`
- `canvas-project-card`：hover 加蓝光 shadow + `border-primary/30`
- 工具栏、缩放控件、mini-map 跟随 token，控件底色 surface-elevated

### 画布工作区（`canvas/project` + components/）

- 画布背景：深色 `#060F30` + 极淡蓝点阵；浅色 `#F7FAFF`
- 节点 `canvas-node`：surface `#0B163D`、边 `#1D3A68`、圆角 16px；选中态 `border-primary` + cyan 微光 `shadow-[0_0_0_1px_#01C7FD40]`
- **AI 生成状态**（design.md 核心）：节点生成中/任务运行时 →
  - cyan 渐变动画边框（`@keyframes canvan-gen-glow`，复用 globals.css 现有 `canvas-batch-child-in` 模式）
  - 底部进度条 cyan 渐变填充
  - 不加在静态节点上（遵守"不让每个元素发光"）
- 连接线 `canvas-connections`：`stroke` `#1D3A68`（深）/`#D7E5FF`（浅），激活连线 `#01C7FD`
- 右键菜单、各 dialog（crop/mask/split/upscale/angle）跟随 token
- `canvas-image-settings-popover` 等 antd Popover：globals.css 已有专属样式，灰值改蓝灰
- composer `canvas-config-composer`：控件跟随 token，发送按钮 `primary` 蓝

### 后台 admin（dashboard/users/credit-logs/generation-tasks/prompts/assets/settings）

- `admin-layout` 侧栏：surface `#0B163D`、品牌 `Canvan` + mark logo、菜单选中 `#12204D` + cyan 左边条 + `text-primary`
- `Layout`/`Menu`/`Table`/`Form`：antd 自动跟随 token
- `Table` 选中行 `rgba(1,199,253,0.10)`，表头 surface-elevated
- `Image` fallback `/logo.svg` → 彩色锁子占位
- `dashboard` 数据卡片：边 `border-border`、关键数字 `text-primary`、图表色 chart-1..5 重设为蓝→青梯度

### `ai-title-aurora` 与 chart 色

- `globals.css` chart-1..5：灰梯度 → 海洋梯度（`#0A6CFE #0586FD #01AEFD #01C7FD #0CE0FC` 近似）
- aurora 渐变蓝→青（见第 3 节）

## 第 5 节 · reactbits / magicui 装饰组件清单

克制的局部点缀，通过已配置 registry 用 shadcn 拉取。

| 组件 | 来源 | 用在哪 | 作用 |
|---|---|---|---|
| `BorderBeam` | magicui | 首页 hero 主 CTA 卡片边、登录卡片顶边 | cyan 能量描边动画 |
| `AuroraText` / `ai-title-aurora` 升级 | reactbits 或就地改 CSS | 首页 hero 标题 | 蓝→青流动渐变文字 |
| `AnimatedGradientText` | reactbits | "AI 生成中"状态徽章、工作台任务运行徽章 | 渐变流动状态标签 |
| `GlowEffect` / `ShimmerButton` | magicui | 画布生成发送按钮 hover、工作台"开始生成" | 蓝青发光，AI 行动信号 |

### AI 生成状态动画（集中实现，复用）

- `globals.css` 新增 `@keyframes canvan-gen-glow`：cyan 边框 `box-shadow` 脉冲 + 渐变边框旋转（参考现有 `canvas-batch-child-in` 写法）
- 新增工具类 `.canvan-gen-active`：画布生成中节点、工作台运行任务卡片加此类
- 进度条 cyan 渐变填充类 `.canvan-progress-fill`

### 不引入（避免过度）

- 不加全屏 Aurora 背景、3D/粒子、鼠标光标跟随（design.md："不要让每个元素发光""避免过度渐变"）
- 不用 reactbits 重交互组件（全页 scroll 动画），保性能与现有交互

### 依赖与体积

- 全部走 shadcn CLI 从 registry 拉到 `src/components/ui/`，不额外装 npm 包（motion 已在依赖，多数动效基于 CSS/motion）
- 每组件独立文件，按需 import，不全局注入

### 实现注意（保功能）

- 装饰组件只包视觉，不改任何 `onClick`/`href`/表单提交逻辑
- `BorderBeam` 包 antd `Button` 时用 `relative` 容器包裹，不破坏 antd 内部 DOM
- AI 动效类由现有生成状态布尔驱动（节点/任务已有 `isGenerating`/`status==='running'` 之类），只改 className

## 第 6 节 · 改动边界与功能保护

### 绝对不动（红线）

- `src/services/api/*` — 所有 axios 请求、URL、参数、响应处理
- `src/router.tsx` — 路由路径、组件映射
- `src/stores/*` — user/config/theme/asset 状态逻辑（`use-theme-store` 的 `theme`/`setTheme`/persist 逻辑不改，只改 CSS 变量值）
- `src/hooks/*`、`src/lib/*` 业务逻辑（`app-theme.ts` 只改色值不改函数签名；`canvas-theme.ts`/`image-utils.ts` 等不动）
- `vite.config.ts` 的 `proxy` `/api` 转发
- `index.html` 内联主题初始化脚本（读 `infinite-canvas:theme_store`）— 保留，只改 `<title>`/`<meta>`/favicon href
- 所有 antd 组件的 `onFinish`/`onChange`/`onClick`/`href`/数据绑定
- 登录的 `safeRedirect`、token 处理、Linux.do 跳转 `href` — 只改样式不改逻辑

### 改（视觉层）

- `src/lib/app-theme.ts` — `neutral` 色值 → 海洋色（函数签名不变）
- `src/styles/globals.css` — `:root`/`.dark` CSS 变量 + `ai-title-aurora` 渐变 + chart 色 + 新增 `canvan-gen-glow` 动画/工具类；`canvas-*` 灰值改蓝灰
- `index.html` — `<title>`、`<meta description>`、favicon
- `public/logo.svg` — 内容替换为彩色锁子
- `src/components/layout/brand-logo.tsx` — 新增
- `src/components/layout/app-top-nav.tsx`、`mobile-nav-drawer.tsx` — 配色 + logo + 品牌名
- `src/pages/home/index.tsx`、`login/index.tsx`、`not-found/index.tsx` — 重设计
- `src/pages/{image,video,prompts,assets,asset-library}/index.tsx`、`src/pages/canvas/index.tsx`、`canvas/components/*` — `stone-` 替换 + 生成状态动效类
- `src/layouts/admin-layout.tsx`、`src/pages/admin/*` — 配色 + logo + 品牌名 + chart 色
- 新增 `src/components/ui/` 装饰组件（BorderBeam/AuroraText/AnimatedGradientText/ShimmerButton 等）

### 回归保护

- 改 `app-theme.ts` 后 antd 全组件自动跟随，关键路径（登录提交、画布生成、admin 表格）人工点一遍
- `stone-` 替换用映射表 + grep 核对，避免误伤
- 改完跑 `bun run build`（`tsc --noEmit`）确认无类型/编译破坏
- dev server 预览关键页：首页、登录、画布、image、admin dashboard

### 实现顺序（风险递增）

1. token 换肤（`app-theme.ts` + `globals.css`）→ 预览全站已变色
2. logo + favicon + 品牌名 → 预览
3. 公开页重设计（nav/home/login/not-found）→ 预览
4. reactbits 装饰组件接入 → 预览
5. 工作台 + 画布 `stone-` 替换 + AI 动效 → 预览
6. admin `stone-` 替换 + chart 色 → 预览
7. `build` 验收

## 验收标准

- 全站呈现 Canvan 海洋蓝视觉（深蓝基底 + 电青高亮），无残留 `stone-` 暖灰
- logo 为彩色 CANVAN 锁子，favicon 与品牌名一致为 Canvan
- 深色为主、浅色可切，两套配色均符合 design.md
- AI 生成状态有 cyan 发光/渐变动效（仅生成状态与 hero，不过度）
- 登录、画布生成、admin 表格等关键功能行为与重设计前完全一致
- `bun run build` 通过，无类型/编译错误
- `src/services/api/*`、`router.tsx`、`vite.config.ts` proxy 零改动
