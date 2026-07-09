# Canvan 海洋蓝全站重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将全站视觉从单色中性灰重塑为 Canvan 海洋蓝（深蓝基底 + 电青高亮），更换彩色锁子与品牌名 CANVAN，引入克制的 reactbits/magicui 装饰与 AI 生成状态动效，且不触碰任何 API 调用、路由与状态逻辑。

**Architecture:** 三层自底向上：(1) 集中换肤——改 `app-theme.ts`（antd token）与 `globals.css`（shadcn 变量）+ `canvas-theme.ts`（canvas 渲染色）为海洋色板，使 51 个 antd 文件 + 4 个 shadcn 文件 + canvas 渲染自动跟随；(2) 公开页重设计——nav/home/login/not-found 布局 + reactbits 装饰；(3) 工作台/画布/admin 精修——`stone-` 批量替换 + AI 状态动效 + chart 色。

**Tech Stack:** Vite + React 19 + TypeScript, Ant Design v6（主题经 `app-theme.ts`），shadcn / Tailwind v4（token 在 `globals.css`），lucide-react，motion；shadcn CLI（v4.13.0）从 `@magicui` / `@react-bits` registry 拉组件；zustand 主题持久化。

## Global Constraints

- **红线（绝对不动）**：`src/services/api/*`、`src/router.tsx`、`src/stores/*` 状态逻辑、`src/hooks/*`、`src/lib/*` 业务逻辑（`app-theme.ts`/`canvas-theme.ts` 只改色值不改函数签名与导出名）、`vite.config.ts` 的 `/api` proxy、`index.html` 内联主题初始化脚本、所有 antd 组件的 `onFinish`/`onChange`/`onClick`/`href`/数据绑定、登录的 `safeRedirect`/token/Linux.do 跳转逻辑。
- **调色板（design.md，逐字）**：primary `#0A6CFE`、primary-hover `#0586FD`、primary-active `#01AEFD`、secondary `#01C7FD`、tertiary `#0CE0FC`；dark-background `#060F30`、dark-surface `#0B163D`、dark-surface-elevated `#12204D`、dark-border `#1D3A68`、dark-text-primary `#FDFDFD`、dark-text-secondary `#B8C7E8`、dark-text-muted `#7183A8`；light-background `#F7FAFF`、light-surface `#FFFFFF`、light-surface-elevated `#EEF5FF`、light-border `#D7E5FF`、light-text-primary `#060F30`、light-text-secondary `#34466D`、light-text-muted `#64748B`；semantic：success `#16C784`、warning `#FFB020`、error `#FF4D6D`、info `#0A6CFE`。
- **圆角（design.md）**：卡片 16px、按钮/输入 10px、标签全圆。`--radius` 基准 `0.625rem`(10px) 不变；`--radius-2xl` 改 `calc(var(--radius) * 1.6)` ≈ 16px。
- **品牌名**：`无限画布` → `Canvan`（仅品牌位文案，不改功能文案如"开始使用""打开画布"）。`<title>` → `Canvan · AI 创作平台`，`<meta description>` → `Canvan — AI 无限画布创作平台`。
- **AI 动效强度**：中等——仅 hero 与生成状态（`metadata.status === "loading"` 的画布节点、工作台运行任务），不加全屏 Aurora/3D/粒子/光标跟随。
- **不引入新 npm 包**：装饰组件全部走 shadcn CLI 从 registry 拉到 `src/components/ui/`，动效基于 CSS 或已安装的 `motion`。
- **验证方式**：无单元测试框架（YAGNI）。每个任务以 `cd web && bun run build`（含 `tsc --noEmit`）+ dev server 预览关键页为验收。功能行为须与重设计前一致。
- **字体**：保留现有 body font-family（main.tsx 内联）；design.md 的 Inter 在本项目以系统 sans 近似，不引入新字体文件。
- **提交节奏**：每个任务结束 commit 一次，commit message 前缀 `style:` / `feat:` 视性质。

## File Structure

**新增**：
- `web/public/logo.svg` — 内容替换为彩色锁子（覆盖现有单色三角）
- `web/public/logo-mark.svg` — 锁子左侧符号区裁切（mark 变体方式 a）
- `web/src/components/layout/brand-logo.tsx` — 品牌 logo 组件（`variant: "full" | "mark"`），四处复用
- `web/src/components/ui/border-beam.tsx` — magicui `BorderBeam`（shadcn 拉取）
- `web/src/components/ui/aurora-text.tsx` — reactbits `AuroraText`（shadcn 拉取）
- `web/src/components/ui/animated-gradient-text.tsx` — reactbits `AnimatedGradientText`（shadcn 拉取）
- `web/src/components/ui/shimmer-button.tsx` — magicui `ShimmerButton`（shadcn 拉取）

**修改（视觉层）**：
- `web/src/lib/app-theme.ts` — `neutral` 对象色值 → 海洋色（函数签名不变）
- `web/src/lib/canvas-theme.ts` — `canvasThemes` 暖色 → 海洋色（类型/导出名不变）
- `web/src/styles/globals.css` — `:root`/`.dark` 变量 + `@theme inline` surface-elevated 映射 + `ai-title-aurora` 渐变 + chart 色 + 新增 `canvan-gen-glow` 动画/工具类 + `canvas-*` 灰值改蓝灰 + `--radius-2xl` 公式
- `web/index.html` — `<title>`、`<meta description>`（favicon href 已是 `/logo.svg`，不动）
- `web/src/components/layout/app-top-nav.tsx` — 配色 + logo + 品牌名
- `web/src/components/layout/mobile-nav-drawer.tsx` — 配色跟随
- `web/src/pages/home/index.tsx` — 重设计 hero/背景/网格/CTA
- `web/src/pages/login/index.tsx` — 配色 + logo + 卡片
- `web/src/pages/not-found/index.tsx` — 配色 + logo
- `web/src/pages/image/index.tsx`、`video/index.tsx`、`prompts/index.tsx`、`assets/index.tsx`、`asset-library/index.tsx`、`canvas/index.tsx` — `stone-` 替换 + 生成状态动效类
- `web/src/pages/canvas/components/canvas-node.tsx` — 生成节点加 `.canvan-gen-active`
- `web/src/layouts/admin-layout.tsx` — 配色 + logo + 品牌名
- `web/src/pages/admin/*` — `stone-` 替换 + chart 色

---

### Task 1: 集中换肤 — antd token（`app-theme.ts`）

**Files:**
- Modify: `web/src/lib/app-theme.ts`

**Interfaces:**
- Consumes: 无
- Produces: `getAntThemeConfig(dark: boolean): ThemeConfig`（签名不变，色值变为海洋色）；`adminLayoutStyle`（不变）。后续所有 antd 组件经 `AppProviders` 自动跟随。

- [ ] **Step 1: 替换 `neutral` 对象为 oceanic 色值**

将 `web/src/lib/app-theme.ts` 中的 `const neutral = { ... }` 整块替换为：

```ts
const oceanic = {
    light: {
        primary: "#0A6CFE",
        primaryHover: "#0586FD",
        primaryText: "#ffffff",
        menuBg: "#EEF5FF",
        menuText: "#060F30",
        selectActiveBg: "#EEF5FF",
        selectSelectedBg: "rgba(10,108,254,0.12)",
        selectText: "#060F30",
        tableSelectedBg: "rgba(1,199,253,0.10)",
        tableSelectedHoverBg: "rgba(1,199,253,0.16)",
    },
    dark: {
        primary: "#0A6CFE",
        primaryHover: "#0586FD",
        primaryText: "#ffffff",
        menuBg: "#12204D",
        menuText: "#FDFDFD",
        selectActiveBg: "#12204D",
        selectSelectedBg: "rgba(10,108,254,0.18)",
        selectText: "#FDFDFD",
        tableSelectedBg: "rgba(1,199,253,0.10)",
        tableSelectedHoverBg: "rgba(1,199,253,0.16)",
    },
};
```

- [ ] **Step 2: 更新 `getAntThemeConfig` 引用与新增布局色 token**

将函数体里的 `const color = dark ? neutral.dark : neutral.light;` 改为 `const color = dark ? oceanic.dark : oceanic.light;`，并在 `token` 对象内追加布局/容器色（保留原有 token 项）：

```ts
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorBgLayout: dark ? "#060F30" : "#F7FAFF",
            colorBgContainer: dark ? "#0B163D" : "#FFFFFF",
            colorBgElevated: dark ? "#12204D" : "#FFFFFF",
            colorBorder: dark ? "#1D3A68" : "#D7E5FF",
            colorBorderSecondary: dark ? "rgba(29,58,104,0.6)" : "#EEF5FF",
            colorText: dark ? "#FDFDFD" : "#060F30",
            colorTextSecondary: dark ? "#B8C7E8" : "#34466D",
            colorTextTertiary: dark ? "#7183A8" : "#64748B",
            colorSuccess: "#16C784",
            colorWarning: "#FFB020",
            colorError: "#FF4D6D",
            borderRadius: 10,
            borderRadiusLG: 16,
        },
```

并将 `components.Menu` 内的 `darkItemHoverBg: neutral.dark.menuBg` 等三处 `neutral.` 引用改为 `oceanic.dark.`。

- [ ] **Step 3: 构建验证**

Run: `cd web && bun run build`
Expected: 通过（`tsc --noEmit` + vite build 无错）。`app-theme.ts` 只改色值，类型不变。

- [ ] **Step 4: 预览验证**

Run: `cd web && bun run dev`，浏览器开 `http://localhost:3000`，切深色与浅色。
Expected: antd 按钮/输入/菜单/表格已呈蓝色主色；深色背景为深蓝（非黑）。登录表单、admin 表格仍可正常交互（不改逻辑）。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/app-theme.ts
git commit -m "style: antd token 换肤为 Canvan 海洋蓝"
```

---

### Task 2: 集中换肤 — shadcn 变量与全局样式（`globals.css`）

**Files:**
- Modify: `web/src/styles/globals.css`

**Interfaces:**
- Consumes: 无
- Produces: shadcn CSS 变量（`:root`/`.dark`）、`--surface-elevated`、Tailwind 类 `bg-surface-elevated`、`ai-title-aurora` 蓝青渐变、chart-1..5 海洋梯度、`.canvan-gen-active` / `.canvan-progress-fill` 工具类、`canvan-gen-glow` keyframes。

- [ ] **Step 1: 在 `@theme inline` 块新增 surface-elevated 映射**

在 `web/src/styles/globals.css` 的 `@theme inline { ... }` 内，`--color-card: var(--card);` 行后追加：

```css
    --color-surface-elevated: var(--surface-elevated);
```

并把 `--radius-2xl: calc(var(--radius) * 1.8);` 改为：

```css
    --radius-2xl: calc(var(--radius) * 1.6);
```

- [ ] **Step 2: 替换 `:root`（浅色）变量块**

将 `:root { ... }` 整块替换为（保留 `--radius: 0.625rem;`）：

```css
:root {
    --radius: 0.625rem;
    --surface-elevated: #EEF5FF;
    --border: #D7E5FF;
    --ring: #0A6CFE;
    --background: #F7FAFF;
    --foreground: #060F30;
    --card: #FFFFFF;
    --card-foreground: #060F30;
    --popover: #FFFFFF;
    --popover-foreground: #060F30;
    --primary: #0A6CFE;
    --primary-foreground: #ffffff;
    --secondary: #EEF5FF;
    --secondary-foreground: #060F30;
    --muted: #EEF5FF;
    --muted-foreground: #64748B;
    --accent: #EEF5FF;
    --accent-foreground: #060F30;
    --destructive: #FF4D6D;
    --input: #D7E5FF;
    --chart-1: #0A6CFE;
    --chart-2: #0586FD;
    --chart-3: #01AEFD;
    --chart-4: #01C7FD;
    --chart-5: #0CE0FC;
    --sidebar: #FFFFFF;
    --sidebar-foreground: #060F30;
    --sidebar-primary: #0A6CFE;
    --sidebar-primary-foreground: #ffffff;
    --sidebar-accent: #EEF5FF;
    --sidebar-accent-foreground: #060F30;
    --sidebar-border: #D7E5FF;
    --sidebar-ring: #0A6CFE;
}
```

- [ ] **Step 3: 替换 `.dark` 变量块**

将 `.dark { ... }` 整块替换为：

```css
.dark {
    --surface-elevated: #12204D;
    --background: #060F30;
    --foreground: #FDFDFD;
    --border: #1D3A68;
    --ring: #01C7FD;
    --card: #0B163D;
    --card-foreground: #FDFDFD;
    --popover: #0B163D;
    --popover-foreground: #FDFDFD;
    --primary: #0A6CFE;
    --primary-foreground: #ffffff;
    --secondary: #12204D;
    --secondary-foreground: #FDFDFD;
    --muted: #12204D;
    --muted-foreground: #7183A8;
    --accent: #12204D;
    --accent-foreground: #FDFDFD;
    --destructive: #FF4D6D;
    --input: rgba(29,58,104,0.6);
    --chart-1: #0A6CFE;
    --chart-2: #0586FD;
    --chart-3: #01AEFD;
    --chart-4: #01C7FD;
    --chart-5: #0CE0FC;
    --sidebar: #0B163D;
    --sidebar-foreground: #FDFDFD;
    --sidebar-primary: #0A6CFE;
    --sidebar-primary-foreground: #ffffff;
    --sidebar-accent: #12204D;
    --sidebar-accent-foreground: #FDFDFD;
    --sidebar-border: #1D3A68;
    --sidebar-ring: #01C7FD;
}
```

- [ ] **Step 4: 改 `ai-title-aurora` 为蓝青渐变**

在 `@layer utilities` 内，将 `.ai-title-aurora { ... }` 的 `background` 改为蓝青，深浅两套：

```css
    .ai-title-aurora {
        background: linear-gradient(90deg, #0A6CFE 0%, #0A6CFE 30%, #01C7FD 50%, #0CE0FC 70%, #0A6CFE 100%);
        background-size: 220% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: ai-title-aurora 7s ease-in-out infinite;
    }

    .dark .ai-title-aurora {
        background: linear-gradient(90deg, #01C7FD 0%, #01C7FD 30%, #0CE0FC 50%, #01AEFD 70%, #01C7FD 100%);
        background-size: 220% 100%;
        -webkit-background-clip: text;
        background-clip: text;
    }
```

（保留已有 `@keyframes ai-title-aurora` 不动；将其 `drop-shadow` 的 `rgba(28,25,23,...)` 改为 `rgba(10,108,254,0.18)`。）

- [ ] **Step 5: 新增 AI 生成状态动画与工具类**

在 `@layer utilities` 末尾（`@keyframes canvas-batch-child-out` 之后）追加：

```css
    @keyframes canvan-gen-glow {
        0%, 100% {
            box-shadow: 0 0 0 1px rgba(1,199,253,0.45), 0 0 18px rgba(1,199,253,0.18);
        }
        50% {
            box-shadow: 0 0 0 1px rgba(12,224,252,0.7), 0 0 28px rgba(12,224,252,0.32);
        }
    }

    .canvan-gen-active {
        animation: canvan-gen-glow 1.8s ease-in-out infinite;
        border-color: #01C7FD;
    }

    .canvan-progress-fill {
        background: linear-gradient(90deg, #0A6CFE 0%, #01C7FD 60%, #0CE0FC 100%);
    }
```

- [ ] **Step 6: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。CSS 变量与 Tailwind 类无语法错。

- [ ] **Step 7: 预览验证**

dev server 下查看首页 hero 标题呈蓝青流动渐变；深色背景深蓝、浅色蓝白；antd + shadcn 组件配色一致。

- [ ] **Step 8: Commit**

```bash
git add web/src/styles/globals.css
git commit -m "style: shadcn 变量与全局样式换肤为 Canvan 海洋蓝"
```

---

### Task 3: 集中换肤 — canvas 渲染色（`canvas-theme.ts`）

**Files:**
- Modify: `web/src/lib/canvas-theme.ts`

**Interfaces:**
- Consumes: 无
- Produces: `canvasThemes`（导出名/类型 `CanvasColorTheme`/`CanvasBackgroundMode`/`CanvasTheme` 不变），被 `image`/`video`/`user-status-actions`/canvas 渲染消费。

- [ ] **Step 1: 替换 `canvasThemes` 整块为海洋色**

将 `web/src/lib/canvas-theme.ts` 的 `export const canvasThemes = { ... } as const;` 整块替换为：

```ts
export const canvasThemes = {
    light: {
        canvas: {
            background: "#F7FAFF",
            dot: "rgba(29,58,104,.22)",
            line: "rgba(29,58,104,.10)",
            selectionStroke: "#0A6CFE",
            selectionFill: "rgba(10,108,254,.08)",
        },
        node: {
            label: "#34466D",
            fill: "#FFFFFF",
            panel: "#FFFFFF",
            stroke: "#D7E5FF",
            activeStroke: "#0A6CFE",
            placeholder: "#64748B",
            text: "#060F30",
            muted: "#34466D",
            faint: "#64748B",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "#D7E5FF",
            item: "#34466D",
            itemHover: "#EEF5FF",
            activeBg: "#EEF5FF",
            activeText: "#0A6CFE",
        },
    },
    dark: {
        canvas: {
            background: "#060F30",
            dot: "rgba(29,58,104,.32)",
            line: "rgba(29,58,104,.16)",
            selectionStroke: "#01C7FD",
            selectionFill: "rgba(1,199,253,.10)",
        },
        node: {
            label: "#B8C7E8",
            fill: "#0B163D",
            panel: "#0B163D",
            stroke: "#1D3A68",
            activeStroke: "#01C7FD",
            placeholder: "#7183A8",
            text: "#FDFDFD",
            muted: "#B8C7E8",
            faint: "#7183A8",
        },
        toolbar: {
            panel: "rgba(11,22,61,.96)",
            border: "#1D3A68",
            item: "#B8C7E8",
            itemHover: "#12204D",
            activeBg: "#12204D",
            activeText: "#01C7FD",
        },
    },
} as const;
```

- [ ] **Step 2: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。类型不变。

- [ ] **Step 3: 预览验证**

dev server 下打开 `/image`、`/video`、`/canvas/:id`，查看 canvas 画布背景深蓝、节点深蓝面板、连线深蓝边、选中态 cyan。

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/canvas-theme.ts
git commit -m "style: canvas 渲染色换肤为 Canvan 海洋蓝"
```

---

### Task 4: Logo 资源与品牌组件

**Files:**
- Create: `web/public/logo-mark.svg`
- Modify: `web/public/logo.svg`（内容替换）
- Create: `web/src/components/layout/brand-logo.tsx`

**Interfaces:**
- Consumes: `useThemeStore`（判断 dark 选 variant）
- Produces: `BrandLogo`（props: `{ variant?: "full" | "mark"; height?: number; className?: string }`，默认 `variant` 随主题、`height=22`）

- [ ] **Step 1: 替换 `web/public/logo.svg` 为彩色锁子**

将 `web/public/logos/canvan-logo.svg` 的完整内容复制覆盖到 `web/public/logo.svg`（保持文件名，使所有现有 `/logo.svg` 引用自动指向彩色锁子，零路由改动）。

Run: `cp web/public/logos/canvan-logo.svg web/public/logo.svg`

- [ ] **Step 2: 生成 mark 变体 `web/public/logo-mark.svg`**

从锁子左侧符号区裁切作独立 mark。方式 a：用锁子 viewBox（`0 0 1774 887`）左侧约前 460px 宽度的图形区域裁出一个方形 mark。创建 `web/public/logo-mark.svg`，内容为锁子的简化图标符号——优先用方式 b（纯 inline，无裁切误差）：一个 `#0A6CFE` 圆角方块 + 白色 `C`：

```svg
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="14" fill="#0A6CFE"/>
  <path d="M40 22.5C36.5 19.5 32 18 27.5 18.5C20 19.5 14 25.5 13.5 33C13 41.5 19.5 48.5 28 48.5C33 48.5 37.5 46.5 40.5 43" stroke="#FDFDFD" stroke-width="5" stroke-linecap="round" fill="none"/>
</svg>
```

（实现时若该 C 视觉不佳，可回退用锁子裁切——但以此 b 版本为默认交付。）

- [ ] **Step 3: 创建 `BrandLogo` 组件**

创建 `web/src/components/layout/brand-logo.tsx`：

```tsx
import { useThemeStore } from "@/stores/use-theme-store";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
    variant?: "full" | "mark";
    height?: number;
    className?: string;
};

export function BrandLogo({ variant, height = 22, className }: BrandLogoProps) {
    const dark = useThemeStore((state) => state.theme) === "dark";
    const resolved = variant ?? (dark ? "full" : "mark");
    const src = resolved === "full" ? "/logo.svg" : "/logo-mark.svg";
    const width = resolved === "full" ? height * 2 : height;

    return (
        <img
            src={src}
            alt="Canvan"
            height={height}
            width={width}
            className={cn("shrink-0 select-none", className)}
            style={{ height, width: "auto", objectFit: "contain" }}
            draggable={false}
        />
    );
}
```

- [ ] **Step 4: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。`BrandLogo` 引用的 `useThemeStore`/`cn` 均已存在。

- [ ] **Step 5: 预览验证**

dev server 下临时在首页顶部确认 `<BrandLogo />` 深色显彩色横锁子、浅色显 mark + 不报错（此步仅验证组件可渲染，正式接入在 Task 6/7）。

- [ ] **Step 6: Commit**

```bash
git add web/public/logo.svg web/public/logo-mark.svg web/src/components/layout/brand-logo.tsx
git commit -m "feat: 新增 Canvan 彩色锁子与 BrandLogo 组件"
```

---

### Task 5: `index.html` 品牌元数据

**Files:**
- Modify: `web/index.html`

**Interfaces:**
- Consumes: 无
- Produces: 浏览器标题/描述/favicon 指向彩色锁子。

- [ ] **Step 1: 改 title 与 meta description**

将 `web/index.html` 的：

```html
        <meta name="description" content="一个无限画布创作工具" />
        <link rel="icon" href="/logo.svg" />
        <title>无限画布 Infinite Canvas</title>
```

改为：

```html
        <meta name="description" content="Canvan — AI 无限画布创作平台" />
        <link rel="icon" href="/logo.svg" />
        <title>Canvan · AI 创作平台</title>
```

（favicon href 已是 `/logo.svg`，现指向彩色锁子，不动 href。内联主题初始化脚本不动。）

- [ ] **Step 2: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。

- [ ] **Step 3: 预览验证**

浏览器标签页标题为 `Canvan · AI 创作平台`，favicon 为彩色锁子（可能因缓存需强刷）。

- [ ] **Step 4: Commit**

```bash
git add web/index.html
git commit -m "style: index.html 品牌元数据改为 Canvan"
```

---

### Task 6: 顶部导航与移动端抽屉

**Files:**
- Modify: `web/src/components/layout/app-top-nav.tsx`
- Modify: `web/src/components/layout/mobile-nav-drawer.tsx`

**Interfaces:**
- Consumes: `BrandLogo`（Task 4）、shadcn 变量（Task 2）
- Produces: 海洋蓝顶部导航。

- [ ] **Step 1: 改 `app-top-nav.tsx` 品牌块与配色**

在 `web/src/components/layout/app-top-nav.tsx` 顶部 import 区追加：

```tsx
import { BrandLogo } from "@/components/layout/brand-logo";
```

将 header 的 className 由：

```tsx
                <header className="sticky top-0 z-20 h-16 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
```

改为：

```tsx
                <header className="sticky top-0 z-20 h-16 shrink-0 border-b border-border bg-background/90 backdrop-blur-xl">
```

将品牌 Link 块（含 mask span 与 `无限画布` 文字）：

```tsx
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <span
                                    className="size-5 shrink-0 bg-current"
                                    style={{
                                        mask: "url(/logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                    }}
                                />
                                <span className="text-base font-medium">无限画布</span>
                            </Link>
```

改为：

```tsx
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 transition" aria-label="Canvan 首页">
                                <BrandLogo height={22} />
                            </Link>
```

将移动端菜单按钮 className 的 `text-stone-600 ... dark:text-stone-300 dark:hover:text-white` 改为 `text-muted-foreground hover:text-primary`。

将导航 nav 项的激活/非激活 className 中所有 `stone-950`/`stone-100`/`stone-500`/`stone-400` 替换为语义色：激活 `font-medium text-primary after:bg-primary`，非激活 `text-muted-foreground after:bg-transparent hover:text-primary`。

- [ ] **Step 2: 改 `mobile-nav-drawer.tsx` 配色**

打开 `web/src/components/layout/mobile-nav-drawer.tsx`，将所有 `stone-` 色值类按映射替换：`stone-950/900`→`foreground`、`stone-800/700`→`muted-foreground`、`stone-200/100`→`border`、`stone-500/400`→`muted-foreground`；激活态 `text-stone-950`→`text-primary`、`bg-stone-100`→`bg-accent`。保留所有 `onClick`/`onClose`/`activeToolSlug` 逻辑与 Link `to` 不动。

- [ ] **Step 3: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。

- [ ] **Step 4: 预览验证**

dev server 下顶部导航深蓝边、彩色锁子、激活项蓝色下划线；移动端抽屉配色跟随。导航点击跳转正常（路径不变）。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/layout/app-top-nav.tsx web/src/components/layout/mobile-nav-drawer.tsx
git commit -m "style: 顶部导航换肤为 Canvan 海洋蓝 + 彩色锁子"
```

---

### Task 7: 首页重设计

**Files:**
- Modify: `web/src/pages/home/index.tsx`

**Interfaces:**
- Consumes: shadcn 变量（Task 2）、`ai-title-aurora`（Task 2）；后续 Task 9 接入 reactbits 装饰。
- Produces: 海洋蓝首页 hero + 提示词网格。

- [ ] **Step 1: 改 hero 背景与装饰**

将 `web/src/pages/home/index.tsx` 的 `<main ...>` className：

```tsx
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
```

改为：

```tsx
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#D7E5FF_1px,transparent_1px)] [background-size:16px_16px] text-foreground dark:bg-[radial-gradient(rgba(29,58,104,.25)_1px,transparent_1px)]">
```

将两个装饰圆圈 `border-stone-200 dark:border-stone-800` 改为 `border-primary/20`。

- [ ] **Step 2: 改 hero 标题与副文案**

将 `<h1 ...>无限画布</h1>` 文字改为 `Canvan`（保留 `ai-title-aurora` 类）。

将副文案 `<p>` className 的 `text-stone-500 dark:text-stone-400` 改为 `text-muted-foreground`。

将两处 `Highlighter` 的 color：`#FF9800`（橙，design.md 禁暖色）改为 `#01C7FD`；`#87CEFA` 改为 `#0CE0FC`。将 `Highlighter` 内层 span className `text-stone-800 dark:text-stone-200` 改为 `text-foreground`。

- [ ] **Step 3: 改提示词网格区配色**

将"沉淀每一次好结果"区 `<section>` 的 `border-stone-200 ... dark:border-stone-800` 改为 `border-border`；`<h2>` 的 `text-stone-950 dark:text-stone-100` 改为 `text-foreground`；描述 `<p>` 的 `text-stone-500 dark:text-stone-400` 改为 `text-muted-foreground`。

将网格 button 的 className `border-stone-200 bg-stone-100 ... dark:border-stone-800 dark:bg-stone-900` 改为 `border-border bg-card ... dark:border-border dark:bg-surface-elevated`。

- [ ] **Step 4: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。

- [ ] **Step 5: 预览验证**

首页 hero 标题 `Canvan` 蓝青流动渐变、蓝点背景、装饰圆 cyan 边、CTA 蓝按钮、提示词网格蓝灰卡片。`fetchPrompts` 数据加载与图片预览逻辑不变（点击仍开预览）。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/home/index.tsx
git commit -m "style: 首页重设计为 Canvan 海洋蓝"
```

---

### Task 8: 登录页与 404

**Files:**
- Modify: `web/src/pages/login/index.tsx`
- Modify: `web/src/pages/not-found/index.tsx`

**Interfaces:**
- Consumes: `BrandLogo`（Task 4）、shadcn 变量（Task 2）
- Produces: 海洋蓝登录页与 404。

- [ ] **Step 1: 改 `login/index.tsx` 背景与品牌块**

在 import 区追加 `import { BrandLogo } from "@/components/layout/brand-logo";`。

将 `<main ...>` className 的 `bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] ... dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]` 改为 `bg-[radial-gradient(#D7E5FF_1px,transparent_1px)] ... dark:bg-[radial-gradient(rgba(29,58,104,.22)_1px,transparent_1px)]`。

将品牌块（mask span + `aria-label="无限画布"`）：

```tsx
                    <span
                        className="mx-auto mb-4 block size-12 bg-stone-950 dark:bg-stone-100"
                        style={{
                            mask: "url(/logo.svg) center / contain no-repeat",
                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                        }}
                        aria-label="无限画布"
                    />
```

改为：

```tsx
                    <BrandLogo variant="full" height={40} className="mx-auto mb-4" />
```

将 `<h1>` 的 `text-stone-950 dark:text-stone-100` 改为 `text-foreground`；`<p>` 的 `text-stone-500 dark:text-stone-400` 改为 `text-muted-foreground`。

- [ ] **Step 2: 改 `login/index.tsx` Form label 配色**

将三处 Form.Item label 的 `text-stone-800 dark:text-stone-200` 改为 `text-foreground`。**不动** `onFinish={submit}`、`safeRedirect`、Linux.do `href`、`Segmented`/`Input`/`Button` 的逻辑属性。

- [ ] **Step 3: 改 `not-found/index.tsx` 配色**

将 `<main>` className 的 `bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] ... text-stone-900 ... dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)] dark:text-stone-100` 改为 `bg-[radial-gradient(#D7E5FF_1px,transparent_1px)] ... text-foreground ... dark:bg-[radial-gradient(rgba(29,58,104,.22)_1px,transparent_1px)]`。

将 404 方块 `border-stone-200 bg-white ... dark:border-stone-800 dark:bg-stone-900` 改为 `border-border bg-card ... dark:border-border dark:bg-surface-elevated`，文字色加 `text-primary`。

将描述 `<p>` 的 `text-stone-500 dark:text-stone-400` 改为 `text-muted-foreground`。

将"返回首页"Link 的 `bg-stone-950 ... text-white ... hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-stone-200` 改为 `bg-primary text-primary-foreground hover:bg-primary-active`。`<Link to="/">` 不动。

- [ ] **Step 4: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。

- [ ] **Step 5: 预览验证**

登录页彩色锁子、蓝点背景、表单蓝主色；登录/注册切换、提交、Linux.do 跳转行为与重设计前一致（实际登录需后端，UI 验证渲染即可）。404 蓝青配色。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/login/index.tsx web/src/pages/not-found/index.tsx
git commit -m "style: 登录页与 404 换肤为 Canvan 海洋蓝"
```

---

### Task 9: 接入 reactbits/magicui 装饰组件

**Files:**
- Create: `web/src/components/ui/border-beam.tsx`（shadcn 拉取）
- Create: `web/src/components/ui/aurora-text.tsx`（shadcn 拉取）
- Create: `web/src/components/ui/animated-gradient-text.tsx`（shadcn 拉取）
- Create: `web/src/components/ui/shimmer-button.tsx`（shadcn 拉取）
- Modify: `web/src/pages/home/index.tsx`（接入 BorderBeam + AuroraText）
- Modify: `web/src/pages/login/index.tsx`（接入 BorderBeam）
- Modify: `web/src/pages/canvas/components/canvas-node.tsx`（生成节点接入 `.canvan-gen-active`）

**Interfaces:**
- Consumes: shadcn CLI + `@magicui`/`@react-bits` registry（`components.json` 已配）
- Produces: 四个装饰组件文件；home/login/canvas-node 视觉装饰接入。

- [ ] **Step 1: 拉取装饰组件**

Run（在 `web/` 下）：

```bash
cd web && npx shadcn@latest add "@magicui/border-beam" "@magicui/shimmer-button" "@react-bits/aurora-text" "@react-bits/animated-gradient-text"
```

Expected: 四个文件落入 `web/src/components/ui/`。若某组件名在 registry 中不同，用 `npx shadcn@latest search` 确认确切名后调整（registry 内容以实时拉取为准）。

- [ ] **Step 2: 构建验证（拉取后先确认能编译）**

Run: `cd web && bun run build`
Expected: 通过。若某组件因依赖缺失报错，按报错提示处理（多数依赖 motion/tailwind，已安装）。

- [ ] **Step 3: 首页 hero 接入 AuroraText 与 BorderBeam**

在 `web/src/pages/home/index.tsx` import 区追加（路径以拉取结果为准）：

```tsx
import { AuroraText } from "@/components/ui/aurora-text";
import { BorderBeam } from "@/components/ui/border-beam";
```

将 hero `<h1 className="ai-title-aurora ...">Canvan</h1>` 改为用 `AuroraText` 包裹（保留外层 h1 排版类）：

```tsx
                    <h1 className="max-w-5xl text-balance text-5xl font-semibold tracking-normal sm:text-7xl lg:text-8xl">
                        <AuroraText>Canvan</AuroraText>
                    </h1>
```

在主 CTA 按钮容器外加 `relative` 并放一个 `BorderBeam`（克制，仅 hero 主 CTA）：

```tsx
                    <div className="relative">
                        <Button type="primary" size="large" href={`/${primaryTool.slug}`} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            开始使用
                        </Button>
                        <BorderBeam size={200} duration={6} colorFrom="#0A6CFE" colorTo="#0CE0FC" />
                    </div>
```

（`href` 不动。）

- [ ] **Step 4: 登录卡片接入 BorderBeam**

在 `web/src/pages/login/index.tsx` import `BorderBeam`，将 `<section className="w-full max-w-[420px]">` 改为 `relative` 并在其内末尾加 `<BorderBeam size={120} duration={8} colorFrom="#0A6CFE" colorTo="#01C7FD" />`。表单逻辑不动。

- [ ] **Step 5: 画布生成节点接入 `.canvan-gen-active`**

在 `web/src/pages/canvas/components/canvas-node.tsx`，定位节点外层容器（包裹 `LoadingContent` 的节点根 div）。在节点 `metadata?.status === "loading"` 时给该根 div 的 className 追加 `canvan-gen-active`。

具体：找到节点根容器的 className 表达式，追加条件类（用 `cn` 已在文件内）：

```tsx
            cn(
                <现有类>,
                props.node.metadata?.status === "loading" && "canvan-gen-active",
            )
```

（仅改 className，不改 `LoadingContent`/`status`/`onRetry` 等逻辑。`canvas-theme.ts` 已在 Task 3 换色。）

- [ ] **Step 6: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。

- [ ] **Step 7: 预览验证**

首页 hero `Canvan` 流动渐变文字 + 主 CTA 蓝青描边光束；登录卡片蓝青光束；画布生成中节点 cyan 脉冲发光边框（触发一次生成或用已有 loading 节点观察）。静态节点不发光。

- [ ] **Step 8: Commit**

```bash
git add web/src/components/ui/border-beam.tsx web/src/components/ui/aurora-text.tsx web/src/components/ui/animated-gradient-text.tsx web/src/components/ui/shimmer-button.tsx web/src/pages/home/index.tsx web/src/pages/login/index.tsx web/src/pages/canvas/components/canvas-node.tsx
git commit -m "feat: 接入 reactbits/magicui 装饰与 AI 生成状态动效"
```

---

### Task 10: 工作台页面 `stone-` 替换

**Files:**
- Modify: `web/src/pages/image/index.tsx`
- Modify: `web/src/pages/video/index.tsx`
- Modify: `web/src/pages/prompts/index.tsx`
- Modify: `web/src/pages/assets/index.tsx`
- Modify: `web/src/pages/asset-library/index.tsx`
- Modify: `web/src/pages/canvas/index.tsx`
- Modify: `web/src/pages/canvas/components/canvas-project-card.tsx`

**Interfaces:**
- Consumes: shadcn 变量（Task 2）、canvas-theme（Task 3）
- Produces: 工作台页面蓝灰配色，无残留 `stone-`。

- [ ] **Step 1: 批量替换映射**

在各文件中按映射替换 `stone-` 类（用编辑器查找替换，逐文件确认，避免误伤非色值 `stone`）：

- `stone-950` / `stone-900` → `foreground`
- `stone-800` / `stone-700` → `muted-foreground`
- `stone-200` / `stone-100` / `stone-50` → `border`（边）/ `bg-card`（表面，视语境）
- `stone-500` / `stone-400` / `stone-300` → `muted-foreground`
- 激活/选中态 `text-stone-950` → `text-primary`、`bg-stone-100/200` → `bg-accent`
- `dark:` 前缀的对应项同样映射到语义类（语义类已自带深浅适配，多数可删 `dark:` 变体）

**不动**：所有 antd 组件的 props、`onClick`/`onChange`/`href`、`canvasThemes[...]` 引用、数据绑定。

- [ ] **Step 2: `canvas-project-card.tsx` hover 蓝光**

将卡片 hover 的 shadow/边改为：hover `border-primary/30` + `shadow-[0_8px_30px_rgba(1,199,253,0.12)]`。`stone-` 同步替换。

- [ ] **Step 3: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。

- [ ] **Step 4: 残留 `stone-` 核对**

Run: `cd web && grep -rn "stone-" src/pages/image src/pages/video src/pages/prompts src/pages/assets src/pages/asset-library src/pages/canvas/index.tsx src/pages/canvas/components/canvas-project-card.tsx`
Expected: 无输出（或仅剩非色值语境，需人工确认）。

- [ ] **Step 5: 预览验证**

各工作台页面蓝灰配色，无暖灰残留；生图/生视频/提示词/素材/画布列表交互行为不变。

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/image/index.tsx web/src/pages/video/index.tsx web/src/pages/prompts/index.tsx web/src/pages/assets/index.tsx web/src/pages/asset-library/index.tsx web/src/pages/canvas/index.tsx web/src/pages/canvas/components/canvas-project-card.tsx
git commit -m "style: 工作台页面 stone 暖灰替换为 Canvan 海洋蓝语义色"
```

---

### Task 11: 画布工作区组件 `stone-` 替换

**Files:**
- Modify: `web/src/pages/canvas/components/` 下除 `canvas-node.tsx`（Task 9 已处理生成态）外的各组件文件中含 `stone-` 者（toolbar/zoom-controls/mini-map/context-menu/各 dialog/connections/composer 等）
- Modify: `web/src/styles/globals.css` 中 `canvas-*` 灰值（Task 2 已改主体，此步补 canvas 专属灰）

**Interfaces:**
- Consumes: shadcn 变量（Task 2）、canvas-theme（Task 3）
- Produces: 画布工作区蓝灰配色。

- [ ] **Step 1: 定位含 `stone-` 的画布组件**

Run: `cd web && grep -rln "stone-" src/pages/canvas/components/`
Expected: 列出需改的文件清单。

- [ ] **Step 2: 按 Task 10 映射替换各文件**

对清单中每个文件按 Task 10 Step 1 的映射替换 `stone-`。`canvas-connections.tsx` 的 `stroke` 色若用硬编码灰值，改为 `#1D3A68`（深）/`#D7E5FF`（浅），激活连线 `#01C7FD`。**不动**任何交互/坐标/数据逻辑。

- [ ] **Step 3: 补 `globals.css` 中 `canvas-*` 专属灰**

将 `globals.css` 内 `.canvas-control-select`/`.canvas-control-number`/`.canvas-composer-*`/`.canvas-image-settings-popover` 等规则中的 `rgba(120,113,108,...)`（stone 灰）替换为蓝灰：`rgba(29,58,104,...)`（深）/`rgba(176,196,230,...)`（浅），聚焦边 `#a8a29e`→`#01C7FD`、深色聚焦 `#78716c`→`#01C7FD`。

- [ ] **Step 4: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。

- [ ] **Step 5: 残留核对**

Run: `cd web && grep -rn "stone-" src/pages/canvas/components/`
Expected: 无色值残留。

- [ ] **Step 6: 预览验证**

画布工作区：工具栏/缩放/mini-map/右键菜单/各 dialog 蓝灰配色；composer 控件蓝主色；连线深蓝边、选中 cyan。画布交互（拖拽/连线/生成/裁切）行为不变。

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/canvas/components/ web/src/styles/globals.css
git commit -m "style: 画布工作区组件换肤为 Canvan 海洋蓝"
```

---

### Task 12: 后台 admin 换肤

**Files:**
- Modify: `web/src/layouts/admin-layout.tsx`
- Modify: `web/src/pages/admin/dashboard/index.tsx`
- Modify: `web/src/pages/admin/users/index.tsx`
- Modify: `web/src/pages/admin/credit-logs/index.tsx`
- Modify: `web/src/pages/admin/generation-tasks/index.tsx`
- Modify: `web/src/pages/admin/prompts/index.tsx`
- Modify: `web/src/pages/admin/assets/index.tsx`
- Modify: `web/src/pages/admin/settings/index.tsx`

**Interfaces:**
- Consumes: `BrandLogo`（Task 4）、antd token（Task 1）、shadcn 变量（Task 2）
- Produces: 海洋蓝后台。

- [ ] **Step 1: 改 `admin-layout.tsx` 品牌块**

在 import 区追加 `import { BrandLogo } from "@/components/layout/brand-logo";`。

将侧栏品牌块（mask span + `无限画布`）：

```tsx
                    <span aria-hidden style={{ display: "inline-block", width: 30, height: 30, background: antToken.colorText, WebkitMask: "url(/logo.svg) center / contain no-repeat", mask: "url(/logo.svg) center / contain no-repeat" }} />
                    <Typography.Text strong style={{ fontSize: 18, letterSpacing: 0 }}>
                        无限画布
                    </Typography.Text>
```

改为：

```tsx
                    <BrandLogo variant="mark" height={28} />
                    <Typography.Text strong style={{ fontSize: 18, letterSpacing: 0, color: antToken.colorText }}>
                        Canvan
                    </Typography.Text>
```

（`Layout`/`Menu`/`antToken` 背景色经 Task 1 token 自动跟随，不改 style 逻辑；`useUserStore` 鉴权逻辑不动。）

- [ ] **Step 2: admin 各页 `stone-` 替换 + chart 色**

对 `dashboard`/`users`/`credit-logs`/`generation-tasks`/`prompts`/`assets`/`settings` 按 Task 10 Step 1 映射替换 `stone-`。

`dashboard` 图表色：将任何硬编码灰梯度色值改为 oceanic 梯度 `["#0A6CFE","#0586FD","#01AEFD","#01C7FD","#0CE0FC"]`（已对应 `--chart-1..5`）。关键数字 stat 色改 `text-primary`。

`admin/prompts` 与 `admin/assets` 的 `Image ... fallback="/logo.svg"` **保持不动**（现指向彩色锁子，作占位可接受）。**不动**表格 `columns`/`dataSource`/`onChange`/分页逻辑。

- [ ] **Step 3: 构建验证**

Run: `cd web && bun run build`
Expected: 通过。

- [ ] **Step 4: 残留核对**

Run: `cd web && grep -rn "stone-" src/layouts/admin-layout.tsx src/pages/admin/`
Expected: 无色值残留。

- [ ] **Step 5: 预览验证**

admin 侧栏 mark logo + `Canvan`、菜单选中 cyan 左边条（经 token `menuBg`/`itemSelectedBg`）；表格/表单蓝主色；dashboard 图表蓝青梯度。admin 鉴权跳转、表格操作行为不变。

- [ ] **Step 6: Commit**

```bash
git add web/src/layouts/admin-layout.tsx web/src/pages/admin/
git commit -m "style: 后台 admin 换肤为 Canvan 海洋蓝 + chart 海洋梯度"
```

---

### Task 13: 全站收尾验收

**Files:**
- 无新增修改；本任务为全站核对与构建验收。

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 验收通过的重设计成果。

- [ ] **Step 1: 全站 `stone-` 残留终检**

Run: `cd web && grep -rn "stone-" src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"`
Expected: 仅剩非色值语境（如有），逐条人工确认无暖灰色值残留。

- [ ] **Step 2: 红线终检（确认未动 API/路由/proxy）**

Run:

```bash
cd /Users/eldenpdx/git-project/infinite-canvas && git diff main -- web/src/services/ web/src/router.tsx web/vite.config.ts | head
```

Expected: 无输出（这些文件零改动）。`src/stores/`、`src/hooks/`、`src/lib/`（除 `app-theme.ts`/`canvas-theme.ts`）同样应无逻辑改动——用 `git diff main --stat -- web/src/stores web/src/hooks` 核对（应无输出）。

- [ ] **Step 3: 构建终验**

Run: `cd web && bun run build`
Expected: 通过，无类型/编译错误。

- [ ] **Step 4: 关键路径预览**

dev server 下人工点一遍：首页（hero 渐变 + CTA 光束）、登录（锁子 + 卡片光束 + 提交渲染）、画布（生成节点 cyan 脉冲）、image/video（蓝灰工作台）、prompts/assets/asset-library、admin dashboard（蓝青图表）/users/credit-logs。切深浅两套主题。
Expected: 全站海洋蓝，无暖灰；功能行为与重设计前一致。

- [ ] **Step 5: 最终 commit（如有收尾改动）**

若 Step 1-2 发现残留并修复：

```bash
git add -A && git commit -m "style: Canvan 重设计收尾"
```

否则无需 commit。

---

## Self-Review

**1. Spec coverage:**
- 第 1 节调色板映射 → Task 1（antd）+ Task 2（shadcn）+ Task 3（canvas-theme，spec 第 4 节画布渲染色的根因源，spec 未单列但属"工作台精修"范畴，已纳入）
- 第 2 节 logo 与品牌 → Task 4 + Task 5 + Task 6（nav）+ Task 8（login）+ Task 12（admin）
- 第 3 节公开页 → Task 6 + Task 7 + Task 8
- 第 4 节工作台与后台 → Task 10 + Task 11 + Task 12
- 第 5 节 reactbits/magicui → Task 9
- 第 6 节边界与保护 → Global Constraints + Task 13 红线终检
- 全部 spec 章节有对应任务。

**2. Placeholder scan:** 无 TBD/TODO/"add appropriate"。reactbits/magicui 组件名以 registry 实时拉取为准，Task 9 Step 1 已说明若名不同用 `search` 确认——这是可执行指令而非占位。mark 变体 spec 给了方式 a/b，Task 4 Step 2 默认交付 b 版完整 SVG 代码。

**3. Type consistency:** `BrandLogo` props `{ variant?: "full" | "mark"; height?: number; className?: string }` 在 Task 4 定义，Task 6/8/12 消费一致。`getAntThemeConfig(dark)` 签名不变。`canvasThemes` 导出名/类型不变。`canvan-gen-active`/`canvan-progress-fill`/`ai-title-aurora` 类名在 Task 2 定义、Task 9/11 消费一致。

无遗留问题。
