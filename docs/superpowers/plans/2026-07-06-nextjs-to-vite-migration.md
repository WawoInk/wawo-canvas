# Next.js → Vite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Next.js framework shell with Vite + React Router while preserving all business logic, components, services, stores, hooks, styles, and types.

**Architecture:** In-place replacement in `web/` — swap Next.js config/routing/proxy for Vite equivalents. All business code under `src/components/`, `src/services/`, `src/stores/`, `src/hooks/`, `src/lib/`, `src/types/`, `src/constant/` stays intact. Reference implementation at `../others/infinite-canvas-vite/web/` for structural patterns.

**Tech Stack:** Vite 7, React 19, React Router v7, Ant Design v6, Zustand v5, TanStack React Query v5, Tailwind CSS v4, TypeScript 5, Bun.

## Global Constraints

- All existing functionality must be preserved (auth, canvas, image/video/audio generation, admin, file upload, prompts, assets)
- Package manager: Bun (keep existing `bun.lock`)
- Dev server: port 3000
- Path alias: `@/*` → `./src/*`
- Tailwind v4 CSS-first config (no `tailwind.config.js`)
- Production: nginx + static dist (replaces `output: "standalone"`)
- API proxy: Vite dev proxy + nginx prod proxy to Go backend at `API_BASE_URL` (default `http://127.0.0.1:8088`)
- Dark mode flash prevention: inline `<script>` in `index.html` head
- TS target: ES2018+ (bump from ES2017), `moduleResolution: "bundler"`, `jsx: "react-jsx"`

---

### Task 1: Scaffold Vite — config, entry point, index.html

**Files:**
- Create: `web/index.html`
- Create: `web/vite.config.ts`
- Create: `web/src/vite-env.d.ts`
- Modify: `web/package.json`
- Modify: `web/tsconfig.json`
- Create: `web/src/main.tsx`
- Create: `web/src/styles/` (directory)

**Produces:** `package.json` with Vite deps, `vite.config.ts` with proxy + aliases + defines, `index.html` entry, `main.tsx` client entry, `vite-env.d.ts` type declarations.

- [ ] **Step 1: Update `package.json`**

Replace `package.json`:

```json
{
    "name": "infinite-canvas",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
        "dev": "vite --host 0.0.0.0 --port 3000",
        "build": "tsc --noEmit && vite build",
        "start": "vite preview --host 0.0.0.0 --port 3000",
        "format": "prettier --write .",
        "format:check": "prettier --check ."
    },
    "dependencies": {
        "@ant-design/icons": "^6.1.1",
        "@ant-design/pro-components": "3.0.0-beta.3",
        "@codemirror/lang-json": "^6.0.2",
        "@tanstack/react-query": "^5.100.9",
        "@uiw/react-codemirror": "^4.25.9",
        "antd": "^6.4.2",
        "axios": "^1.16.0",
        "class-variance-authority": "^0.7.1",
        "clsx": "^2.1.1",
        "copy-to-clipboard": "^4.0.2",
        "dayjs": "^1.11.20",
        "fflate": "^0.8.3",
        "file-saver": "^2.0.5",
        "localforage": "^1.10.0",
        "lucide-react": "^1.16.0",
        "motion": "^12.38.0",
        "nanoid": "^5.1.11",
        "radix-ui": "^1.4.3",
        "react": "19.2.5",
        "react-dom": "19.2.5",
        "react-router-dom": "^7.12.0",
        "shadcn": "^4.7.0",
        "tailwind-merge": "^3.6.0",
        "tailwindcss": "^4",
        "tw-animate-css": "^1.4.0",
        "zustand": "^5.0.12"
    },
    "devDependencies": {
        "@tailwindcss/postcss": "^4",
        "@types/file-saver": "^2.0.7",
        "@types/node": "^20",
        "@types/react": "19.1.12",
        "@types/react-dom": "19.1.9",
        "@vitejs/plugin-react": "^5.2.0",
        "prettier": "^3.8.3",
        "typescript": "^5",
        "vite": "^7.3.0"
    }
}
```

- [ ] **Step 2: Clean install dependencies**

```bash
cd web && rm -rf node_modules && bun install
```

Expected: `bun.lock` updated, `node_modules` populated with `vite`, `react-router-dom`, `@vitejs/plugin-react`. `next` and `@ant-design/nextjs-registry` no longer present.

- [ ] **Step 3: Update `tsconfig.json`**

Replace `web/tsconfig.json`:

```json
{
    "compilerOptions": {
        "target": "ES2018",
        "lib": ["dom", "dom.iterable", "esnext"],
        "allowJs": true,
        "skipLibCheck": true,
        "strict": true,
        "noEmit": true,
        "esModuleInterop": true,
        "module": "esnext",
        "moduleResolution": "bundler",
        "resolveJsonModule": true,
        "isolatedModules": true,
        "jsx": "react-jsx",
        "paths": {
            "@/*": ["./src/*"]
        }
    },
    "include": ["vite.config.ts", "src/**/*.ts", "src/**/*.tsx"],
    "exclude": ["node_modules"]
}
```

Changes: target `ES2017` → `ES2018`; removed `next` plugin and `next-env.d.ts`/`.next/types` from include; removed `incremental`.

- [ ] **Step 4: Create `web/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_RELEASES__: import("@/lib/release").ReleaseInfo[];
```

- [ ] **Step 5: Create `web/vite.config.ts`**

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const VERSION = readFileSync(resolve(webDir, "../VERSION"), "utf-8").trim() || "dev";
const CHANGELOG = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf-8");

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(webDir, "src") } },
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
    __APP_RELEASES__: JSON.stringify(parseChangelog(CHANGELOG)),
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: process.env.API_BASE_URL || "http://127.0.0.1:8088",
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 6: Create `web/index.html`**

```html
<!doctype html>
<html lang="zh-CN" class="font-sans">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="一个无限画布创作工具" />
    <link rel="icon" href="/logo.svg" />
    <title>无限画布 Infinite Canvas</title>
    <script>
      try {
        var s = JSON.parse(localStorage.getItem("infinite-canvas:theme_store") || "{}");
        var t = s.state && s.state.theme === "light" ? "light" : "dark";
        document.documentElement.classList.toggle("dark", t === "dark");
        document.documentElement.style.colorScheme = t;
      } catch (e) {}
    </script>
  </head>
  <body class="bg-background text-foreground antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Move CSS and create `web/src/main.tsx`**

First move the CSS file:

```bash
mkdir -p web/src/styles
cp web/src/app/globals.css web/src/styles/globals.css
```

Then create `web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppProviders } from "@/components/layout/app-providers";
import { router } from "@/router";
import "antd/dist/reset.css";
import "./styles/globals.css";

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>
);
```

- [ ] **Step 8: Verify scaffold — run dev server**

```bash
cd web && bun run dev
```

Expected: Vite starts on port 3000. The page shows a blank root div (router not yet defined). No import errors in terminal. Stop dev server with Ctrl+C.

- [ ] **Step 9: Commit**

```bash
cd web && git add index.html vite.config.ts src/vite-env.d.ts src/main.tsx src/styles/globals.css package.json bun.lock tsconfig.json
git commit -m "feat: scaffold Vite — config, entry point, index.html"
```

---

### Task 2: Create router.tsx (no pages yet, just placeholder imports)

**Files:**
- Create: `web/src/router.tsx`

**Interfaces:**
- Produces: `export const router: Router` (React Router browser router with route tree)

- [ ] **Step 1: Create `web/src/router.tsx`**

```tsx
import { createBrowserRouter, Outlet } from "react-router-dom";

import UserLayout from "@/layouts/user-layout";
import AdminLayout from "@/layouts/admin-layout";
import HomePage from "@/pages/home";
import LoginPage from "@/pages/login";
import CanvasListPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ImagePage from "@/pages/image";
import VideoPage from "@/pages/video";
import PromptsPage from "@/pages/prompts";
import AssetsPage from "@/pages/assets";
import AssetLibraryPage from "@/pages/asset-library";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminUsers from "@/pages/admin/users";
import AdminCreditLogs from "@/pages/admin/credit-logs";
import AdminGenerationTasks from "@/pages/admin/generation-tasks";
import AdminPrompts from "@/pages/admin/prompts";
import AdminAssets from "@/pages/admin/assets";
import AdminSettings from "@/pages/admin/settings";
import NotFound from "@/pages/not-found";

export const router = createBrowserRouter([
  {
    element: (
      <UserLayout>
        <Outlet />
      </UserLayout>
    ),
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/canvas", element: <CanvasListPage /> },
      { path: "/canvas/:id", element: <CanvasProjectPage /> },
      { path: "/image", element: <ImagePage /> },
      { path: "/video", element: <VideoPage /> },
      { path: "/prompts", element: <PromptsPage /> },
      { path: "/assets", element: <AssetsPage /> },
      { path: "/asset-library", element: <AssetLibraryPage /> },
    ],
  },
  {
    element: (
      <AdminLayout>
        <Outlet />
      </AdminLayout>
    ),
    children: [
      { path: "/admin", element: <AdminDashboard /> },
      { path: "/admin/users", element: <AdminUsers /> },
      { path: "/admin/credit-logs", element: <AdminCreditLogs /> },
      { path: "/admin/generation-tasks", element: <AdminGenerationTasks /> },
      { path: "/admin/prompts", element: <AdminPrompts /> },
      { path: "/admin/assets", element: <AdminAssets /> },
      { path: "/admin/settings", element: <AdminSettings /> },
    ],
  },
  { path: "*", element: <NotFound /> },
]);
```

- [ ] **Step 2: Create placeholder page files**

All 18 page files need to exist as minimal placeholder exports so `router.tsx` compiles. Create each directory and a stub `index.tsx`:

```bash
mkdir -p web/src/pages/{home,login,canvas/project,image,video,prompts,assets,asset-library,admin/{dashboard,users,credit-logs,generation-tasks,prompts,assets,settings},not-found}
```

For each page, create `index.tsx` with a placeholder:

```tsx
export default function PageName() {
  return <div>PageName</div>;
}
```

List of all placeholder files to create:

**`web/src/pages/home/index.tsx`:**
```tsx
export default function HomePage() {
  return <div>Home</div>;
}
```

**`web/src/pages/login/index.tsx`:**
```tsx
export default function LoginPage() {
  return <div>Login</div>;
}
```

**`web/src/pages/canvas/index.tsx`:**
```tsx
export default function CanvasListPage() {
  return <div>Canvas List</div>;
}
```

**`web/src/pages/canvas/project/index.tsx`:**
```tsx
export default function CanvasProjectPage() {
  return <div>Canvas Project</div>;
}
```

**`web/src/pages/image/index.tsx`:**
```tsx
export default function ImagePage() {
  return <div>Image</div>;
}
```

**`web/src/pages/video/index.tsx`:**
```tsx
export default function VideoPage() {
  return <div>Video</div>;
}
```

**`web/src/pages/prompts/index.tsx`:**
```tsx
export default function PromptsPage() {
  return <div>Prompts</div>;
}
```

**`web/src/pages/assets/index.tsx`:**
```tsx
export default function AssetsPage() {
  return <div>Assets</div>;
}
```

**`web/src/pages/asset-library/index.tsx`:**
```tsx
export default function AssetLibraryPage() {
  return <div>Asset Library</div>;
}
```

**`web/src/pages/admin/dashboard/index.tsx`:**
```tsx
export default function AdminDashboard() {
  return <div>Admin Dashboard</div>;
}
```

**`web/src/pages/admin/users/index.tsx`:**
```tsx
export default function AdminUsers() {
  return <div>Admin Users</div>;
}
```

**`web/src/pages/admin/credit-logs/index.tsx`:**
```tsx
export default function AdminCreditLogs() {
  return <div>Admin Credit Logs</div>;
}
```

**`web/src/pages/admin/generation-tasks/index.tsx`:**
```tsx
export default function AdminGenerationTasks() {
  return <div>Admin Generation Tasks</div>;
}
```

**`web/src/pages/admin/prompts/index.tsx`:**
```tsx
export default function AdminPrompts() {
  return <div>Admin Prompts</div>;
}
```

**`web/src/pages/admin/assets/index.tsx`:**
```tsx
export default function AdminAssets() {
  return <div>Admin Assets</div>;
}
```

**`web/src/pages/admin/settings/index.tsx`:**
```tsx
export default function AdminSettings() {
  return <div>Admin Settings</div>;
}
```

**`web/src/pages/not-found/index.tsx`:**
```tsx
export default function NotFound() {
  return <div>404</div>;
}
```

Create all at once:

```bash
# Run from web/ directory
for dir in home login canvas/project image video prompts assets asset-library admin/dashboard admin/users admin/credit-logs admin/generation-tasks admin/prompts admin/assets admin/settings not-found; do
  mkdir -p "src/pages/$dir"
done
```

Then write each file.

- [ ] **Step 3: Create placeholder layout files**

**`web/src/layouts/user-layout.tsx`:**
```tsx
import type { ReactNode } from "react";

export default function UserLayout({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
```

**`web/src/layouts/admin-layout.tsx`:**
```tsx
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
```

- [ ] **Step 4: Verify `bun run dev` starts and all routes resolve**

```bash
cd web && bun run dev
```

Visit `http://localhost:3000/` → "Home", `/canvas` → "Canvas List", `/canvas/abc` → "Canvas Project", `/admin` → "Admin Dashboard", `/admin/users` → "Admin Users", `/nonexistent` → "404".

Expected: All routes render their placeholder text. No compilation errors. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add web/src/router.tsx web/src/pages/ web/src/layouts/
git commit -m "feat: create router with placeholder pages and layouts"
```

---

### Task 3: Migrate layouts — UserLayout and AdminLayout

**Files:**
- Modify: `web/src/layouts/user-layout.tsx` (replace placeholder)
- Modify: `web/src/layouts/admin-layout.tsx` (replace placeholder)

**Interfaces:**
- Consumes: No prior task dependencies beyond the router
- Produces: `UserLayout` wrapping `<Outlet />` with `AppTopNav`; `AdminLayout` wrapping `<Outlet />` with Ant Design Sider + Header + auth guard

- [ ] **Step 1: Migrate UserLayout**

Replace `web/src/layouts/user-layout.tsx` with migrated content. Source: `web/src/app/(user)/layout.tsx`. The only change is removing `"use client"` (React Router layouts don't need it since the wrapping `AppProviders` is already a client component), and wrapping `{children}` (which is `<Outlet />`):

```tsx
import type { ReactNode } from "react";

import { AppTopNav } from "@/components/layout/app-top-nav";

export default function UserLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <AppTopNav />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Migrate AdminLayout**

Replace `web/src/layouts/admin-layout.tsx` with migrated content from `web/src/app/(admin)/admin/layout.tsx`. Changes:
- `import Link from "next/link"` → `import { Link } from "react-router-dom"`
- `import { usePathname, useRouter } from "next/navigation"` → `import { useLocation, useNavigate } from "react-router-dom"`
- `const pathname = usePathname()` → `const { pathname } = useLocation()`
- `const router = useRouter()` → `const navigate = useNavigate()`
- `router.replace(url)` → `navigate(url, { replace: true })`
- `<Link href={item.key}>` stays (React Router Link supports `href` via `to` — actually React Router Link uses `to`, not `href`). For Ant Design Menu items wrapping `<Link>`, use `to` prop:

```tsx
import { ExperimentOutlined, FileTextOutlined, HomeOutlined, LogoutOutlined, PictureOutlined, SettingOutlined, TransactionOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Flex, Layout, Menu, Typography, theme } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { adminLayoutStyle } from "@/lib/app-theme";
import { useUserStore } from "@/stores/use-user-store";

const adminMenus = [
  { key: "/admin/users", icon: <UserOutlined />, label: "用户管理" },
  { key: "/admin/credit-logs", icon: <TransactionOutlined />, label: "算力点日志" },
  { key: "/admin/generation-tasks", icon: <ExperimentOutlined />, label: "使用日志" },
  { key: "/admin/prompts", icon: <FileTextOutlined />, label: "提示词管理" },
  { key: "/admin/assets", icon: <PictureOutlined />, label: "素材库" },
  { key: "/admin/settings", icon: <SettingOutlined />, label: "系统设置" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { token: antToken } = theme.useToken();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const token = useUserStore((state) => state.token);
  const user = useUserStore((state) => state.user);
  const isReady = useUserStore((state) => state.isReady);
  const logout = useUserStore((state) => state.clearSession);
  const activeKey = pathname.startsWith("/admin/settings")
    ? "/admin/settings"
    : pathname.startsWith("/admin/assets")
      ? "/admin/assets"
      : pathname.startsWith("/admin/generation-tasks")
        ? "/admin/generation-tasks"
        : pathname.startsWith("/admin/prompts")
          ? "/admin/prompts"
          : pathname.startsWith("/admin/credit-logs")
            ? "/admin/credit-logs"
            : pathname.startsWith("/admin/users")
              ? "/admin/users"
              : "";
  const pageTitle = pathname.startsWith("/admin/settings") ? "系统设置" : pathname.startsWith("/admin/assets") ? "素材库管理" : pathname.startsWith("/admin/generation-tasks") ? "使用日志" : pathname.startsWith("/admin/prompts") ? "提示词管理" : pathname.startsWith("/admin/credit-logs") ? "算力点日志" : "用户管理";

  useEffect(() => {
    if (!isReady) return;
    if (!token) {
      navigate("/login?redirect=/admin", { replace: true });
      return;
    }
    if (user?.role !== "admin") {
      navigate("/", { replace: true });
    }
  }, [isReady, token, user?.role, navigate]);

  if (!isReady || !token || user?.role !== "admin") {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: antToken.colorBgLayout }}>
        <span />
      </div>
    );
  }

  return (
    <Layout hasSider style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgLayout }}>
      <Layout.Sider width={adminLayoutStyle.siderWidth} style={{ height: "100vh", overflow: "hidden", background: antToken.colorBgContainer, borderRight: `1px solid ${antToken.colorBorder}` }}>
        <Flex align="center" gap={12} style={{ height: adminLayoutStyle.brandHeight, padding: "0 20px", borderBottom: `1px solid ${antToken.colorBorderSecondary}` }}>
          <span aria-hidden style={{ display: "inline-block", width: 30, height: 30, background: antToken.colorText, WebkitMask: "url(/logo.svg) center / contain no-repeat", mask: "url(/logo.svg) center / contain no-repeat" }} />
          <Typography.Text strong style={{ fontSize: 18, letterSpacing: 0 }}>
            无限画布
          </Typography.Text>
        </Flex>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          style={adminLayoutStyle.menu}
          items={adminMenus.map((item) => ({
            ...item,
            label: (
              <Link to={item.key} style={{ color: "inherit" }}>
                {item.label}
              </Link>
            ),
            style: adminLayoutStyle.menuItem,
          }))}
        />
        <Flex vertical gap={8} style={{ position: "absolute", bottom: 0, insetInline: 0, padding: 12, borderTop: `1px solid ${antToken.colorBorder}`, background: antToken.colorBgContainer }}>
          <Button block icon={<HomeOutlined />} href="/canvas" target="_blank" rel="noreferrer">
            前往画布
          </Button>
          <Button block icon={<LogoutOutlined />} onClick={logout}>
            退出登录
          </Button>
        </Flex>
      </Layout.Sider>
      <Layout style={{ background: antToken.colorBgLayout }}>
        <Layout.Header
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: adminLayoutStyle.headerHeight, padding: "0 24px", background: antToken.colorBgContainer, borderBottom: `1px solid ${antToken.colorBorder}` }}
        >
          <Typography.Title level={5} style={{ margin: 0 }}>
            {pageTitle}
          </Typography.Title>
          <Flex align="center" gap={4}>
            <UserStatusActions showConfig={false} />
          </Flex>
        </Layout.Header>
        <Layout.Content style={{ minHeight: 0, overflow: "auto" }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}
```

- [ ] **Step 3: Verify admin and user layouts render**

```bash
cd web && bun run dev
```

Visit `/canvas` — should see full top nav (since `AppTopNav` is in UserLayout). Check `/admin` — redirects to `/login?redirect=/admin` (expected, no auth token yet). Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add web/src/layouts/
git commit -m "feat: migrate UserLayout and AdminLayout from Next.js to React Router"
```

---

### Task 4: Rewire shared components — remove next/link, next/navigation

**Files:**
- Modify: `web/src/components/layout/app-top-nav.tsx`
- Modify: `web/src/components/layout/mobile-nav-drawer.tsx`
- Modify: `web/src/components/layout/user-status-actions.tsx`
- Modify: `web/src/components/layout/client-root-init.tsx`
- Modify: `web/src/constant/env.ts`
- Modify: `web/src/hooks/use-version-check.ts`
- Delete: `web/src/app/layout.tsx`

**Interfaces:**
- Consumes: `router.tsx` from Task 2, layouts from Task 3
- Produces: All shared components import from `react-router-dom` instead of `next/*`; env vars use Vite globals

- [ ] **Step 1: Rewire `app-top-nav.tsx`**

Replace lines 4-5:

```tsx
import Link from "next/link";
import { usePathname } from "next/navigation";
```

With:

```tsx
import { Link, useLocation } from "react-router-dom";
```

Replace line 15:

```tsx
const pathname = usePathname();
```

With:

```tsx
const { pathname } = useLocation();
```

`Link` elements with `href` need `to` instead. Replace all `<Link href={`/${tool.slug}`}>` and `<Link href="/">` — but actually React Router v7 `Link` uses `to`, not `href`. So:

Line 27: `<Link href="/"` → `<Link to="/"`
Line 55: `href={`/${tool.slug}`}` → `to={`/${tool.slug}`}`

- [ ] **Step 2: Rewire `mobile-nav-drawer.tsx`**

Replace line 4:

```tsx
import Link from "next/link";
```

With:

```tsx
import { Link } from "react-router-dom";
```

Replace `href={`/${tool.slug}`}` with `to={`/${tool.slug}`}` on the `<Link>` element.

- [ ] **Step 3: Rewire `user-status-actions.tsx`**

Replace line 7:

```tsx
import Link from "next/link";
```

With:

```tsx
import { Link } from "react-router-dom";
```

Replace `<Link href="/admin">` → `<Link to="/admin">` (line 49). Replace `<Link href="/login">` → `<Link to="/login">` (line 82).

- [ ] **Step 4: Rewire `client-root-init.tsx`**

Replace line 5:

```tsx
import { usePathname } from "next/navigation";
```

With:

```tsx
import { useLocation } from "react-router-dom";
```

Replace line 14:

```tsx
const pathname = usePathname();
```

With:

```tsx
const { pathname } = useLocation();
```

- [ ] **Step 5: Rewire `env.ts`**

Replace `web/src/constant/env.ts`:

```ts
export const APP_VERSION = __APP_VERSION__ || "dev";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";
```

- [ ] **Step 6: Rewire `use-version-check.ts`**

Replace line 11 in `web/src/hooks/use-version-check.ts`:

```ts
return JSON.parse(process.env.NEXT_PUBLIC_APP_RELEASES || "[]");
```

With:

```ts
return __APP_RELEASES__ || [];
```

- [ ] **Step 7: Delete `web/src/app/layout.tsx`**

The root layout is fully replaced by `index.html` + `main.tsx`:

```bash
rm web/src/app/layout.tsx
```

- [ ] **Step 8: Verify `bun run dev` still starts, top nav renders with links**

```bash
cd web && bun run dev
```

Visit `/` — check the top nav renders with navigation tools and links work. Click "画布" → navigates to `/canvas`. Stop dev server.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/layout/ web/src/constant/ web/src/hooks/ web/src/app/layout.tsx
git commit -m "feat: rewire shared components — next/link → react-router-dom, env vars → Vite globals"
```

---

### Task 5: Migrate pages — user-facing

Migrate each user-facing page from `app/(user)/<name>/page.tsx` to `pages/<name>/index.tsx`. Each follows the same pattern: copy content, replace `next/navigation` and `next/link` imports.

**Files:**
- Modify: `web/src/pages/home/index.tsx` (from `app/(user)/page.tsx`)
- Modify: `web/src/pages/login/index.tsx` (from `app/(user)/login/page.tsx`)
- Modify: `web/src/pages/canvas/index.tsx` (from `app/(user)/canvas/page.tsx`)
- Modify: `web/src/pages/canvas/project/index.tsx` (from `app/(user)/canvas/[id]/canvas-client-page.tsx`)
- Modify: `web/src/pages/image/index.tsx` (from `app/(user)/image/page.tsx`)
- Modify: `web/src/pages/video/index.tsx` (from `app/(user)/video/page.tsx`)
- Modify: `web/src/pages/prompts/index.tsx` (from `app/(user)/prompts/page.tsx`)
- Modify: `web/src/pages/assets/index.tsx` (from `app/(user)/assets/page.tsx`)
- Modify: `web/src/pages/asset-library/index.tsx` (from `app/(user)/asset-library/page.tsx`)

**Pattern for each page:**

1. Copy the entire content from the source `page.tsx`
2. Replace `import { useParams, useRouter, useSearchParams } from "next/navigation"` with `import { useParams, useNavigate, useSearchParams } from "react-router-dom"`
3. Replace `import Link from "next/link"` with `import { Link } from "react-router-dom"`
4. Replace `const router = useRouter()` with `const navigate = useNavigate()`
5. Replace `router.push(url)` with `navigate(url)`
6. Replace `router.replace(url)` with `navigate(url, { replace: true })`
7. Replace `useSearchParams()` — same signature, but returns mutable `URLSearchParams`. If `.toString()` behavior is critical, check usage.
8. Any page-local imports (e.g., `from "../utils/..."` or `from "../components/..."`) need path adjustment since the file moves from nested `app/` to flat `pages/`. Specifically:
   - `canvas/page.tsx` → `pages/canvas/index.tsx`: relative imports to sibling files in `app/(user)/canvas/` become absolute `@/` imports
   - `canvas/[id]/canvas-client-page.tsx` → `pages/canvas/project/index.tsx`: same — convert relative `../` imports

- [ ] **Step 1: Migrate home page**

Copy content from `web/src/app/(user)/page.tsx` to `web/src/pages/home/index.tsx`. No Next.js-specific imports — this page is clean. Only change: the page uses `<Button href=...>` (Ant Design Button with `href` prop), which works fine without Next.js — Ant Design handles `href` natively with `<a>` tags. Replace the placeholder content.

Actually, `<Button href={`/${primaryTool.slug}`}>` is an Ant Design pattern — it renders a native `<a>`. This is fine, no Next.js dependency there. Just copy the content directly.

- [ ] **Step 2: Migrate login page**

Source: `web/src/app/(user)/login/page.tsx`

Replace `import { useRouter, useSearchParams } from "next/navigation"` → `import { useNavigate, useSearchParams } from "react-router-dom"`. Replace `const router = useRouter()` → `const navigate = useNavigate()`. Replace all `router.push(` → `navigate(`, `router.replace(` → `navigate(..., { replace: true })`.

- [ ] **Step 3: Migrate canvas list page and canvas shared files**

Source: `web/src/app/(user)/canvas/page.tsx`

First, bulk-move all shared canvas files (components, utils, stores, constants, types) from `app/(user)/canvas/` to `pages/canvas/`:

```bash
cp -r web/src/app/\(user\)/canvas/components web/src/pages/canvas/
cp -r web/src/app/\(user\)/canvas/utils web/src/pages/canvas/
cp -r web/src/app/\(user\)/canvas/stores web/src/pages/canvas/
cp web/src/app/\(user\)/canvas/constants.ts web/src/pages/canvas/
cp web/src/app/\(user\)/canvas/types.ts web/src/pages/canvas/
cp web/src/app/\(user\)/canvas/export-types.ts web/src/pages/canvas/
```

Then copy the list page content from `web/src/app/(user)/canvas/page.tsx` to `web/src/pages/canvas/index.tsx`.

In the page file, imports from `./components/canvas-project-card` and `./components/canvas-local-agent-panel` are still valid relative paths since components are now co-located at `pages/canvas/components/`.

Now fix `next/navigation` imports in the moved canvas components:
- `web/src/pages/canvas/components/canvas-project-card.tsx`: replace `import { useRouter, useSearchParams } from "next/navigation"` → `import { useNavigate, useSearchParams } from "react-router-dom"`, replace `const router = useRouter()` → `const navigate = useNavigate()`, replace `router.push(` → `navigate(`
- `web/src/pages/canvas/components/canvas-local-agent-panel.tsx`: replace `import { useSearchParams } from "next/navigation"` → `import { useSearchParams } from "react-router-dom"`

All other canvas components and stores have no `next/` imports — verified via grep.

- [ ] **Step 4: Migrate canvas project page (the big one)**

Source: `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx` (3291 lines)

The current wrapper `page.tsx` is a server component that just re-exports — delete it (the whole `[id]/` directory will be cleaned up later in Task 8).

Move `canvas-client-page.tsx` → `web/src/pages/canvas/project/index.tsx`:

```bash
cp web/src/app/\(user\)/canvas/\[id\]/canvas-client-page.tsx web/src/pages/canvas/project/index.tsx
```

Then edit the file:
1. Replace `import { useParams, useRouter, useSearchParams } from "next/navigation"` → `import { useParams, useNavigate, useSearchParams } from "react-router-dom"`
2. Replace all `const router = useRouter()` → `const navigate = useNavigate()`
3. Replace all `router.push(` → `navigate(`
4. Replace all `router.replace(` → `navigate(..., { replace: true })`
5. Relative imports (`from "../utils/..."`, `from "../constants"`, `from "../components/..."`) are still valid — the file moved from `[id]/canvas-client-page.tsx` to `project/index.tsx`, so `../` still resolves to the `pages/canvas/` directory where all shared files were moved in Step 3. No path changes needed.

- [ ] **Step 5: Migrate image page**

Source: `web/src/app/(user)/image/page.tsx`

```bash
cp web/src/app/\(user\)/image/page.tsx web/src/pages/image/index.tsx
```

Edit `web/src/pages/image/index.tsx`. Search for Next.js imports:

```bash
grep -n "next/navigation\|next/link\|next/" web/src/pages/image/index.tsx
```

This page uses `useSearchParams` for URL state management of generation settings. Replace `import { useSearchParams } from "next/navigation"` → `import { useSearchParams } from "react-router-dom"`. The API surface is identical — `get()`, `toString()` etc. work the same.

- [ ] **Step 6: Migrate video page**

Source: `web/src/app/(user)/video/page.tsx`

```bash
cp web/src/app/\(user\)/video/page.tsx web/src/pages/video/index.tsx
```

```bash
grep -n "next/navigation\|next/link\|next/" web/src/pages/video/index.tsx
```

Same as image page — `useSearchParams` for video generation settings. Replace `from "next/navigation"` → `from "react-router-dom"`.

- [ ] **Step 7: Migrate prompts page**

Source: `web/src/app/(user)/prompts/page.tsx`

```bash
cp web/src/app/\(user\)/prompts/page.tsx web/src/pages/prompts/index.tsx
```

```bash
grep -n "next/navigation\|next/link\|next/" web/src/pages/prompts/index.tsx
```

No Next.js-specific imports expected. Uses `@tanstack/react-query` and Ant Design — framework-agnostic.

- [ ] **Step 8: Migrate assets page**

Source: `web/src/app/(user)/assets/page.tsx`

Copy page and its co-located utility:

```bash
cp web/src/app/\(user\)/assets/page.tsx web/src/pages/assets/index.tsx
cp web/src/app/\(user\)/assets/asset-transfer.ts web/src/pages/assets/
```

Check for Next.js imports in both:

```bash
grep -n "next/navigation\|next/link\|next/" web/src/pages/assets/index.tsx web/src/pages/assets/asset-transfer.ts
```

`asset-transfer.ts` is a zip utility — no Next.js deps. The page is clean. If any `useSearchParams` found, replace with React Router equivalent.

- [ ] **Step 9: Migrate asset-library page**

Source: `web/src/app/(user)/asset-library/page.tsx`

```bash
cp web/src/app/\(user\)/asset-library/page.tsx web/src/pages/asset-library/index.tsx
```

```bash
grep -n "next/navigation\|next/link\|next/" web/src/pages/asset-library/index.tsx
```

No Next.js-specific imports expected. Uses `axios` and `@tanstack/react-query` — framework-agnostic.

- [ ] **Step 10: Verify all user pages render**

```bash
cd web && bun run dev
```

Visit each route: `/`, `/login`, `/canvas`, `/canvas/test-id`, `/image`, `/video`, `/prompts`, `/assets`, `/asset-library`.

Expected: All pages render without JavaScript errors. Console clean. Top nav visible on all except canvas project page. Stop dev server.

- [ ] **Step 11: Commit**

```bash
git add web/src/pages/ web/src/app/\(user\)/
git commit -m "feat: migrate user-facing pages from Next.js to React Router"
```

---

### Task 6: Migrate pages — admin section

**Files:**
- Modify: `web/src/pages/admin/dashboard/index.tsx` (from `app/(admin)/admin/page.tsx`)
- Modify: `web/src/pages/admin/users/index.tsx` (from `app/(admin)/admin/users/page.tsx`)
- Create: `web/src/pages/admin/users/use-admin-users.ts` (from `app/(admin)/admin/users/use-admin-users.ts`)
- Modify: `web/src/pages/admin/credit-logs/index.tsx` (from `app/(admin)/admin/credit-logs/page.tsx`)
- Create: `web/src/pages/admin/credit-logs/use-admin-credit-logs.ts` (from `app/(admin)/admin/credit-logs/use-admin-credit-logs.ts`)
- Modify: `web/src/pages/admin/generation-tasks/index.tsx` (from `app/(admin)/admin/generation-tasks/page.tsx`)
- Create: `web/src/pages/admin/generation-tasks/use-admin-generation-tasks.ts` (from `app/(admin)/admin/generation-tasks/use-admin-generation-tasks.ts`)
- Modify: `web/src/pages/admin/prompts/index.tsx` (from `app/(admin)/admin/prompts/page.tsx`)
- Create: `web/src/pages/admin/prompts/use-admin-prompts.ts` (from `app/(admin)/admin/prompts/use-admin-prompts.ts`)
- Modify: `web/src/pages/admin/assets/index.tsx` (from `app/(admin)/admin/assets/page.tsx`)
- Create: `web/src/pages/admin/assets/use-admin-assets.ts` (from `app/(admin)/admin/assets/use-admin-assets.ts`)
- Modify: `web/src/pages/admin/settings/index.tsx` (from `app/(admin)/admin/settings/page.tsx`)

Each admin page imports from a co-located `./use-admin-*.ts` hook. Move these hooks alongside the pages:

- [ ] **Step 1: Migrate admin dashboard and move all admin co-located hooks**

First, move all admin co-located hooks alongside the placeholder page files:

```bash
cp web/src/app/\(admin\)/admin/users/use-admin-users.ts web/src/pages/admin/users/
cp web/src/app/\(admin\)/admin/credit-logs/use-admin-credit-logs.ts web/src/pages/admin/credit-logs/
cp web/src/app/\(admin\)/admin/generation-tasks/use-admin-generation-tasks.ts web/src/pages/admin/generation-tasks/
cp web/src/app/\(admin\)/admin/prompts/use-admin-prompts.ts web/src/pages/admin/prompts/
cp web/src/app/\(admin\)/admin/assets/use-admin-assets.ts web/src/pages/admin/assets/
```

Then replace the admin dashboard placeholder.

Source: `web/src/app/(admin)/admin/page.tsx` — currently just `redirect("/admin/users")`.

Replace with:

```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function AdminDashboard() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/admin/users", { replace: true });
  }, [navigate]);
  return null;
}
```

- [ ] **Step 2: Migrate admin users page**

Source: `web/src/app/(admin)/admin/users/page.tsx`

```bash
cp web/src/app/\(admin\)/admin/users/page.tsx web/src/pages/admin/users/index.tsx
```

```bash
grep -n "next/navigation\|next/link\|next/" web/src/pages/admin/users/index.tsx
```

No Next.js-specific imports expected — the page uses Ant Design `Table`, `useAdminUsers()` hook (co-located), and `services/api/admin.ts`. All framework-agnostic.

- [ ] **Step 3: Migrate admin credit-logs page**

```bash
cp web/src/app/\(admin\)/admin/credit-logs/page.tsx web/src/pages/admin/credit-logs/index.tsx
grep -n "next/navigation\|next/link\|next/" web/src/pages/admin/credit-logs/index.tsx
```

Clean — uses Ant Design `Table` + `useAdminCreditLogs()` hook.

- [ ] **Step 4: Migrate admin generation-tasks page**

```bash
cp web/src/app/\(admin\)/admin/generation-tasks/page.tsx web/src/pages/admin/generation-tasks/index.tsx
grep -n "next/navigation\|next/link\|next/" web/src/pages/admin/generation-tasks/index.tsx
```

Clean — uses `@tanstack/react-query` + Ant Design markup with image/video previews.

- [ ] **Step 5: Migrate admin prompts page**

```bash
cp web/src/app/\(admin\)/admin/prompts/page.tsx web/src/pages/admin/prompts/index.tsx
grep -n "next/navigation\|next/link\|next/" web/src/pages/admin/prompts/index.tsx
```

Clean — uses `useAdminPrompts()` hook + Ant Design `Table`.

- [ ] **Step 6: Migrate admin assets page**

```bash
cp web/src/app/\(admin\)/admin/assets/page.tsx web/src/pages/admin/assets/index.tsx
grep -n "next/navigation\|next/link\|next/" web/src/pages/admin/assets/index.tsx
```

Clean — uses `useAdminAssets()` hook + Ant Design `Table` with image previews.

- [ ] **Step 7: Migrate admin settings page**

Source: `web/src/app/(admin)/admin/settings/page.tsx`

This page uses `import dynamic from "next/dynamic"` for CodeMirror (line 6, 13). Replace with standard React lazy loading:

```tsx
// Replace:
import dynamic from "next/dynamic";
const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });

// With:
import { lazy, Suspense } from "react";
const CodeMirror = lazy(() => import("@uiw/react-codemirror"));
```

Then wrap `<CodeMirror>` usage in `<Suspense fallback={null}>`:

```tsx
<Suspense fallback={null}>
  <CodeMirror ... />
</Suspense>
```

Actually, a simpler approach — since there's no SSR in Vite, `dynamic(() => import(...), { ssr: false })` is equivalent to a regular dynamic import. The `lazy` + `Suspense` pattern is the React way. Let's use that.

Find all `<CodeMirror>` usages in the file and wrap them. Easiest: wrap the entire content area that renders CodeMirror in `<Suspense fallback={<Spin />}>`.

- [ ] **Step 8: Verify admin pages render (with auth)**

To test admin pages, you need a valid auth token. The pages will redirect to `/login?redirect=/admin` if no token. This is expected behavior.

For a quick smoke test, start dev server and visit `/admin/users`. Expected: redirects to login. The auth guard (AdminLayout) is working.

Alternatively, test by temporarily setting a dummy token in localStorage via browser console:

```js
localStorage.setItem("infinite-canvas-auth-token-v1", JSON.stringify({state:{token:"test",user:{role:"admin"},isReady:true}}))
```

Then visit `/admin/users` — page should render (API calls will fail with 401 but the page markup should be visible).

- [ ] **Step 9: Commit**

```bash
git add web/src/pages/admin/ web/src/app/\(admin\)/
git commit -m "feat: migrate admin pages from Next.js to React Router"
```

---

### Task 7: Migrate 404 page

**Files:**
- Modify: `web/src/pages/not-found/index.tsx` (replace placeholder)
- Delete: `web/src/app/not-found.tsx`

- [ ] **Step 1: Migrate content**

Copy content from `web/src/app/not-found.tsx`. Replace `import Link from "next/link"` → `import { Link } from "react-router-dom"`. Replace `<Link href="/">` → `<Link to="/">`.

- [ ] **Step 2: Delete `app/not-found.tsx`**

```bash
rm web/src/app/not-found.tsx
```

- [ ] **Step 3: Verify 404**

```bash
cd web && bun run dev
```

Visit `/nonexistent-path` → renders 404 page with "返回首页" link. Click the link → navigates to `/`.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/not-found/index.tsx web/src/app/not-found.tsx
git commit -m "feat: migrate 404 page from Next.js to React Router"
```

---

### Task 8: Clean up — delete remaining Next.js artifacts

**Files:**
- Delete: `web/next.config.ts`
- Delete: `web/next-env.d.ts`
- Delete: `web/src/app/` directory (any remaining files)
- Delete: `web/.next/` directory (Next.js build cache)
- Modify: `web/Dockerfile` (replace with nginx-based build)
- Create: `web/nginx.conf`
- Modify: `docker-compose.yml` (update web service)

- [ ] **Step 1: List remaining files in `app/`**

```bash
find web/src/app -type f | grep -v ".next"
```

Expected output: `api/[...path]/route.ts`, `webdav-proxy/route.ts`, `favicon.ico`. The layouts and pages have already been deleted.

- [ ] **Step 2: Delete all Next.js artifacts**

```bash
rm -rf web/src/app
rm web/next.config.ts
rm web/next-env.d.ts
rm -rf web/.next
```

- [ ] **Step 3: Create `web/nginx.conf`**

```nginx
server {
    listen 3000;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://api:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 4: Replace `web/Dockerfile`**

Current Dockerfile uses Next.js standalone output. Replace with nginx-based:

```dockerfile
# Build Vite frontend
FROM oven/bun:1 AS build
WORKDIR /app
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY VERSION CHANGELOG.md ../
COPY web/ .
RUN bun run build

# Runtime: nginx serving static files, proxying /api to Go backend
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 5: Update `docker-compose.yml`**

Remove `API_BASE_URL` from `web` service environment (nginx handles proxying via service name `api`). The web service block becomes:

```yaml
  web:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - api
```

No env vars needed.

- [ ] **Step 6: Build and verify**

```bash
cd web && bun run build
```

Expected: `tsc --noEmit` passes, `vite build` produces `dist/` directory with `index.html` and hashed JS/CSS assets.

Then test Docker build:

```bash
cd /Users/eldenpdx/git-project/infinite-canvas && docker build -t infinite-canvas-web .
```

Expected: builds successfully. (Ignore if Docker not available — just verify `bun run build` passes.)

- [ ] **Step 7: Commit**

```bash
git add web/Dockerfile web/nginx.conf docker-compose.yml web/next.config.ts web/next-env.d.ts web/src/app web/.next
git commit -m "feat: replace Next.js artifacts — nginx Dockerfile, cleanup app/ dir"
```

---

### Task 9: Verify full build and fix any TypeScript errors

**Files:** Various — fix any remaining compilation issues.

- [ ] **Step 1: Run full TypeScript check**

```bash
cd web && bun run build
```

Expected: `tsc --noEmit` passes with zero errors. If there are errors, fix them.

Common issues to watch for:
- Import paths that still reference `next/` — search and replace
- `process.env.NEXT_PUBLIC_*` references still in code — replace with Vite equivalents
- Unused imports from deleted files

- [ ] **Step 2: Fix any remaining `next/` references**

```bash
grep -rn "from ['\"]next/" web/src/ --include="*.tsx" --include="*.ts" | grep -v node_modules
```

Expected: no output. If any found, fix them.

- [ ] **Step 3: Fix any `process.env.NEXT_PUBLIC_` references**

```bash
grep -rn "NEXT_PUBLIC" web/src/ --include="*.tsx" --include="*.ts" | grep -v node_modules
```

Expected: no output. If any found, replace with Vite equivalents.

- [ ] **Step 4: Verify Vite build output**

```bash
cd web && bun run build
```

Expected: success. `dist/` directory contains:
- `index.html`
- `assets/` with hashed JS/CSS bundles
- Logo and icon files from `public/`

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve remaining TypeScript and import errors from migration"
```

---

### Task 10: Smoke test — dev server with Go backend

**Files:** None (verification only)

- [ ] **Step 1: Start Go backend**

```bash
cd /Users/eldenpdx/git-project/infinite-canvas && go run main.go &
```

Wait for Go backend to start on port 8088.

- [ ] **Step 2: Start Vite dev server**

```bash
cd web && bun run dev
```

- [ ] **Step 3: Verify API proxy works**

Open browser, navigate to `http://localhost:3000`. Open browser console. Run:

```js
fetch("/api/health").then(r => r.json()).then(console.log)
```

Expected: `{ code: 0, data: { ... } }` — health check response from Go backend.

- [ ] **Step 4: Verify auth flow**

Visit `/login`. Enter credentials (or register a test account). Submit. Expected: redirects to home page, top nav shows user avatar/name. Check localStorage for `infinite-canvas-auth-token-v1`.

- [ ] **Step 5: Verify protected API calls**

After login, run in console:

```js
fetch("/api/auth/me", { headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem("infinite-canvas-auth-token-v1")).state.token}` } }).then(r => r.json()).then(console.log)
```

Expected: user object returned.

- [ ] **Step 6: Clean up**

```bash
kill %1  # stop Go backend
# stop Vite with Ctrl+C
```

---

### Task 11: Final commit — remove `@ant-design/nextjs-registry` residual

- [ ] **Step 1: Check for any remaining references**

```bash
grep -rn "@ant-design/nextjs-registry\|AntdRegistry" web/ --include="*.tsx" --include="*.ts" --include="*.json" | grep -v node_modules
```

Expected: no output. If found in `package.json` or code, it was removed in Task 1.

- [ ] **Step 2: Final dev server check**

```bash
cd web && bun run dev
```

Visit all key routes and verify no console errors:
- `/` — home page with prompt showcase
- `/canvas` — canvas project list
- `/image` — image generation workbench
- `/admin/users` — redirects to login if unauthenticated

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: final cleanup — verify no Next.js residuals"
```
