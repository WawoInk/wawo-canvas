# Next.js → Vite Migration Design

**Date:** 2026-07-06
**Status:** Approved

## TL;DR

Replace the Next.js framework shell with Vite + React Router while preserving all business logic, components, services, stores, hooks, styles, and types. The app is already an SPA in all but name — every user-facing page is `"use client"`. The migration is a mechanical framework swap: file-based routing → React Router config, API route handlers → Vite/nginx proxy, `next/navigation` → `react-router-dom`, Next.js server layout → `index.html` + `main.tsx`.

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API proxy | Vite dev proxy + nginx prod proxy | Preserves same-origin `/api/*` paths, no frontend code changes to API calls |
| Router structure | Separate `<UserLayout>` and `<AdminLayout>` route groups | Matches current Next.js `(user)`/`(admin)` separation, isolates admin auth guard |
| Page file convention | `src/pages/<name>/index.tsx` | Follows vite reference convention, flat and conventional |
| Migration strategy | Replace in-place in `web/` | Preserves all existing business logic, components, services, stores |
| WebDAV proxy | Eliminate, direct browser-to-WebDAV | vite reference already works this way, one less moving part |

---

## 1. Framework Shell Changes

### 1.1 What gets replaced

| Next.js | Vite | Notes |
|---------|------|-------|
| `next.config.ts` | `vite.config.ts` | `@vitejs/plugin-react`, `@` alias, `define` for `__APP_VERSION__`/`__APP_RELEASES__` |
| `app/layout.tsx` (RSC root) | `index.html` + `src/main.tsx` | Root layout is already minimal — AntdRegistry + AppProviders |
| `app/(user)/layout.tsx` | `src/layouts/user-layout.tsx` | Wraps `<Outlet />` with AppTopNav |
| `app/(admin)/admin/layout.tsx` | `src/layouts/admin-layout.tsx` | Wraps `<Outlet />` with Ant Design Sider + Header, auth guard |
| File-based pages | `src/pages/<name>/index.tsx` | `src/router.tsx` ties them together with `createBrowserRouter` |
| `app/api/[...path]/route.ts` | Vite `server.proxy` (dev) / nginx (prod) | `/api/*` forwarded to Go backend at `API_BASE_URL` |
| `app/webdav-proxy/route.ts` | Eliminated | `webdav-sync.ts` calls WebDAV directly (vite reference already does this) |
| `next/script beforeInteractive` | Inline `<script>` in `index.html` head | Dark mode flash prevention |
| `next/navigation` hooks | `react-router-dom` equivalents | `useRouter` → `useNavigate`, `usePathname` → `useLocation().pathname`, etc. |
| `output: "standalone"` Docker | nginx + static `dist/` | Runtime image switches from Node.js to `nginx:alpine` |
| `NEXT_PUBLIC_*` env vars | `import.meta.env.VITE_*` + `define` globals | `NEXT_PUBLIC_DOC_URL` → `VITE_DOC_URL`, version/changelog via `define` |
| `next/link` | `react-router-dom` `Link` | Same API surface |

### 1.2 What stays unchanged

All files under `src/components/`, `src/services/`, `src/stores/`, `src/hooks/`, `src/lib/`, `src/types/`, `src/constant/`. Also unchanged: `postcss.config.mjs`, `components.json`, `tsconfig.json` (minor adjustments), `bun.lock`, all existing dependencies (add `vite`, `@vitejs/plugin-react`, `react-router-dom`; remove `next`).

### 1.3 Dependency changes

| Action | Package |
|--------|---------|
| Add | `vite@^7`, `@vitejs/plugin-react@^5`, `react-router-dom@^7` |
| Remove | `next` |
| Keep | react, antd, zustand, axios, tailwind v4, shadcn, tanstack/react-query, localforage, motion, lucide-react, dayjs, fflate, etc. |

### 1.4 Scripts

```json
{
  "dev": "vite --host 0.0.0.0 --port 3000",
  "build": "tsc --noEmit && vite build",
  "start": "vite preview --host 0.0.0.0 --port 3000"
}
```

---

## 2. Routing

### 2.1 Route map

| Current Next.js route | Vite page | React Router path |
|----------------------|-----------|-------------------|
| `(user)/page.tsx` | `pages/home/index.tsx` | `/` |
| `(user)/login/page.tsx` | `pages/login/index.tsx` | `/login` |
| `(user)/canvas/page.tsx` | `pages/canvas/index.tsx` | `/canvas` |
| `(user)/canvas/[id]/page.tsx` | `pages/canvas/project/index.tsx` | `/canvas/:id` |
| `(user)/image/page.tsx` | `pages/image/index.tsx` | `/image` |
| `(user)/video/page.tsx` | `pages/video/index.tsx` | `/video` |
| `(user)/prompts/page.tsx` | `pages/prompts/index.tsx` | `/prompts` |
| `(user)/assets/page.tsx` | `pages/assets/index.tsx` | `/assets` |
| `(user)/asset-library/page.tsx` | `pages/asset-library/index.tsx` | `/asset-library` |
| `(admin)/admin/page.tsx` | `pages/admin/dashboard/index.tsx` | `/admin` |
| `(admin)/admin/users/page.tsx` | `pages/admin/users/index.tsx` | `/admin/users` |
| `(admin)/admin/credit-logs/page.tsx` | `pages/admin/credit-logs/index.tsx` | `/admin/credit-logs` |
| `(admin)/admin/generation-tasks/page.tsx` | `pages/admin/generation-tasks/index.tsx` | `/admin/generation-tasks` |
| `(admin)/admin/prompts/page.tsx` | `pages/admin/prompts/index.tsx` | `/admin/prompts` |
| `(admin)/admin/assets/page.tsx` | `pages/admin/assets/index.tsx` | `/admin/assets` |
| `(admin)/admin/settings/page.tsx` | `pages/admin/settings/index.tsx` | `/admin/settings` |
| `not-found.tsx` | `pages/not-found/index.tsx` | `*` |

### 2.2 Router structure

```tsx
// src/router.tsx
import { createBrowserRouter } from "react-router-dom";
import UserLayout from "@/layouts/user-layout";
import AdminLayout from "@/layouts/admin-layout";
import HomePage from "@/pages/home";
// ... all page imports

export const router = createBrowserRouter([
  {
    element: <UserLayout><Outlet /></UserLayout>,
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
    element: <AdminLayout><Outlet /></AdminLayout>,
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

### 2.3 Main entry point

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AppProviders } from "@/components/layout/app-providers";
import { router } from "./router";
import "antd/dist/reset.css";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>
);
```

### 2.4 Hook migration table

| Next.js (`next/navigation`) | React Router (`react-router-dom`) |
|-----------------------------|-----------------------------------|
| `useParams()` | `useParams()` — identical |
| `useSearchParams()` | `useSearchParams()` — returns `URLSearchParams` on updates (minor difference) |
| `useRouter().push(url)` | `useNavigate()(url)` |
| `useRouter().replace(url)` | `useNavigate()(url, { replace: true })` |
| `usePathname()` | `useLocation().pathname` |
| `useRouter().back()` | `useNavigate()(-1)` |
| `import Link from "next/link"` | `import { Link } from "react-router-dom"` |
| `notFound()` | `navigate("/404")` or inline `<NotFound />` |

---

## 3. API Proxy

### 3.1 Standard API proxy (`/api/*`)

The frontend calls `/api/v1/...` — same origin, no CORS concerns. Zero changes to `services/api/request.ts` or any API callers.

**Dev (Vite):**
```ts
// vite.config.ts
server: {
  proxy: {
    "/api": {
      target: process.env.API_BASE_URL || "http://127.0.0.1:8088",
      changeOrigin: true,
    },
  },
}
```

**Production (nginx):**
```nginx
location /api/ {
    proxy_pass http://api:8088;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;  # matches Next.js maxDuration
}
```

### 3.2 WebDAV proxy

Eliminated. `webdav-sync.ts` (line 82) already supports direct browser-to-WebDAV calls — `proxyMode === "nextjs"` uses the proxy, otherwise direct. No code changes needed in `webdav-sync.ts`. Users who previously selected "nextjs proxy" mode simply switch to direct mode. The `app/webdav-proxy/route.ts` file is removed.

---

## 4. Page-Level Migration Pattern

### 4.1 Standard page migration

Every page follows this mechanical transformation:

1. Move from `app/(group)/<name>/page.tsx` to `src/pages/<name>/index.tsx`
2. Replace `next/navigation` imports with `react-router-dom`
3. Replace `next/link` with `react-router-dom` Link
4. Remove any server component wrapper patterns (no more `page.tsx` → `client-component.tsx` split)

### 4.2 Special case: Canvas project page

The current `canvas/[id]/page.tsx` is a server component that reads `params.id` and passes it to `canvas-client-page.tsx`. In Vite, `canvas-client-page.tsx` becomes `pages/canvas/project/index.tsx` and reads `useParams()` directly. The "server wrapper" disappears.

### 4.3 Special case: Admin layout auth guard

Current admin layout uses `useRouter().push()` for auth redirects. Becomes `useNavigate()`. The auth check logic (`useUserStore.getState().token`, fetch user, redirect if not admin) stays identical.

### 4.5 Special case: Root layout → index.html + main.tsx

The root layout (`app/layout.tsx`) dissolves:
- `<html>`, `<body>`, metadata, favicon, dark mode script → `index.html`
- `AntdRegistry` → removed (SSR-only, not needed in pure client app; vite reference doesn't use it)
- `import "antd/dist/reset.css"` → moves to `main.tsx`
- `AppProviders` wrapping → `main.tsx` wraps `<RouterProvider>` inside it

### 4.6 Files needing env-var rewrites

| File | Current | Replace With |
|------|---------|-------------|
| `src/constant/env.ts` | `process.env.NEXT_PUBLIC_APP_VERSION` | `__APP_VERSION__` |
| `src/constant/env.ts` | `process.env.NEXT_PUBLIC_DOC_URL` | `import.meta.env.VITE_DOC_URL` |
| `src/hooks/use-version-check.ts` | `process.env.NEXT_PUBLIC_APP_RELEASES` | `__APP_RELEASES__` |

---

## 5. HTML Entry Point & Dark Mode

### 5.1 `index.html`

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

The inline `<script>` in `<head>` replaces `next/script beforeInteractive`. It reads the zustand-persisted theme store from localStorage and sets `classList` + `colorScheme` before React mounts, preventing the dark mode flash.

### 5.2 CSS

`src/app/globals.css` moves to `src/styles/globals.css`. Content unchanged (Tailwind v4 imports, shadcn theme, custom scrollbar, canvas keyframes).

---

## 6. Environment Variables

| Current (`NEXT_PUBLIC_*`) | Migration | Mechanism |
|---------------------------|-----------|-----------|
| `NEXT_PUBLIC_APP_VERSION` | `__APP_VERSION__` | Vite `define` — reads `../VERSION` at build time |
| `NEXT_PUBLIC_APP_RELEASES` | `__APP_RELEASES__` | Vite `define` — parses `../CHANGELOG.md` at build time |
| `NEXT_PUBLIC_DOC_URL` | `import.meta.env.VITE_DOC_URL` | Vite env — defaults to `https://docs.canvas.best` |

```ts
// vite.config.ts
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

---

## 7. Docker & Deployment

### 7.1 Dockerfile

```dockerfile
# Build stage
FROM oven/bun:1 AS build
WORKDIR /app
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY VERSION CHANGELOG.md ../
COPY web/ .
RUN bun run build

# Runtime stage
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

### 7.2 nginx.conf

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

### 7.3 docker-compose.yml changes

Web service switches from the Node.js standalone image to the nginx-based image. The `API_BASE_URL` env var is no longer needed in the web container (nginx handles proxying via docker-compose service name `api`). All other services and `Dockerfile.api` are unchanged.

---

## 8. Files to Delete

- `next.config.ts`
- `next-env.d.ts`
- `src/app/` directory (all contents — replaced by `src/pages/`, `src/layouts/`, `index.html`)
- `src/app/favicon.ico`
- `.next/` directory (Next.js build cache)

---

## 9. New Files to Create

- `index.html`
- `vite.config.ts`
- `src/main.tsx`
- `src/router.tsx`
- `src/vite-env.d.ts`
- `src/styles/globals.css` (moved from `src/app/globals.css`)
- `src/layouts/user-layout.tsx` (from `src/app/(user)/layout.tsx`)
- `src/layouts/admin-layout.tsx` (from `src/app/(admin)/admin/layout.tsx`)
- `src/pages/home/index.tsx`
- `src/pages/login/index.tsx`
- `src/pages/canvas/index.tsx`
- `src/pages/canvas/project/index.tsx`
- `src/pages/image/index.tsx`
- `src/pages/video/index.tsx`
- `src/pages/prompts/index.tsx`
- `src/pages/assets/index.tsx`
- `src/pages/asset-library/index.tsx`
- `src/pages/admin/dashboard/index.tsx`
- `src/pages/admin/users/index.tsx`
- `src/pages/admin/credit-logs/index.tsx`
- `src/pages/admin/generation-tasks/index.tsx`
- `src/pages/admin/prompts/index.tsx`
- `src/pages/admin/assets/index.tsx`
- `src/pages/admin/settings/index.tsx`
- `src/pages/not-found/index.tsx`
- `nginx.conf`

---

## 10. Risk Areas

| Risk | Mitigation |
|------|-----------|
| **Canvas project page** (3291 lines, heavy `useSearchParams` usage) | React Router's `useSearchParams` returns mutable `URLSearchParams` vs Next.js's `ReadonlyURLSearchParams`. Audit all `.get()`/`.set()`/`.delete()` calls on that page. |
| **Auth redirect loop** | Admin layout and login redirect use `useNavigate()` — verify `replace: true` where needed to avoid back-button loops. |
| **S3 upload flow** | `upload-blob.ts` and `resolve-file-urls.ts` are `.ts` files that make fetch calls. Verify they work without the API proxy (they call `/api/v1/files/...` which the proxy handles transparently). |
| **AntdRegistry SSR** | The root layout currently wraps in `AntdRegistry` for SSR style extraction. In a pure client app, this is unnecessary — verify Ant Design v6 CSS-in-JS works without it. |
| **Production API routing** | nginx `location /api/` must NOT have trailing slash issues. The `proxy_pass http://api:8088;` (no trailing slash) preserves the full path including `/api/`. |

---

## 11. Verification Checklist

- [ ] Every route renders without errors
- [ ] API calls reach the Go backend via Vite/nginx proxy
- [ ] Auth flow: login → token stored → redirect → authenticated requests work
- [ ] Admin section: auth guard redirects non-admins, admin pages render
- [ ] Dark mode: no flash on load, toggle works
- [ ] Canvas: project list, create, open, edit, save
- [ ] Image generation: text-to-image, editing, with references
- [ ] Video generation: task creation, polling, result download
- [ ] Audio generation: TTS with model selection
- [ ] File upload: S3 presigned URL flow works
- [ ] Prompt library: browse, select, use
- [ ] Asset library: browse, save, manage
- [ ] Production Docker: `docker build` succeeds, `docker compose up` serves the app
