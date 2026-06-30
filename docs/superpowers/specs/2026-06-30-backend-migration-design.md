# 后端系统迁移设计文档：infinite-canvas-0.3.0 → infinite-canvas

- **日期**：2026-06-30
- **主题**：将 `infinite-canvas-0.3.0` 的整个 Go 后端系统逻辑迁移到 `infinite-canvas`（当前 main 分支），代码迁移、不做数据迁移，PostgreSQL，Docker 开发/生产多容器分开部署
- **状态**：已通过 brainstorming 全部 7 节设计评审，待用户复核后进入 writing-plans

---

## 1. 背景与目标

### 1.1 两个仓库的现状

**源仓库 `infinite-canvas-0.3.0`**：拥有完整的 Go 后端（Gin + GORM），分层为 `config / model / repository / service / handler / router / middleware / main.go`。支持 sqlite / mysql / postgres 三种驱动。5 张表：`users`、`credit_logs`、`prompts`、`assets`、`settings`。功能包括：

- 认证：用户名/密码 + Linux.do OAuth + HS256 JWT
- 算力点（credits）：模型调用预扣 / 失败返还 / 后台手动调整
- 后台管理：用户 / 算力点流水 / 系统设置 / 模型渠道 / 提示词 / 素材
- AI 代理：`/api/v1/images/generations`、`/images/edits`、`/chat/completions`、`/audio/speech`、`/videos`、`media/references` 上传
- 提示词定时同步：cron（robfig/cron/v3）定时拉取 GitHub 开源提示词库
- 统一响应 `{code, data, msg}`，业务失败也返回 HTTP 200
- Docker：生产单镜像（Go 8080 内部 + Next 3000 代理 `/api/*`）；开发 `Dockerfile.dev` + `docker-compose.local.yml`（api air 热重载@8088 + web bun HMR@3000 + postgres）

**目标仓库 `infinite-canvas`（当前 main）**：在 v0.4.0 **刻意移除了后端**（CHANGELOG："移除后端，项目定位为个人画布工具"），现为纯 Next.js 前端：

- AI 调用由浏览器前台直连用户配置的 OpenAI 兼容端点（`channelMode` 硬编码为 `"local"`）
- 唯一路由处理器：`web/src/app/api/prompts/route.ts`（内存提示词缓存）
- 比源仓库更新的功能：**Gemini API 格式渠道**（`apiFormat: "openai" | "gemini"`）、**Codex App 插件**（`plugins/infinite-canvas/`）、**canvas-agent**、**Web Agent Loop 模式**、Vercel 一键部署
- `.env` 已配置 `STORAGE_DRIVER=postgres` + `DATABASE_DSN=postgresql://...@127.0.0.1:5432/...` + `PORT=8088`；`render.yaml` + `docker-compose*.yml` 是从 0.3.0 复制过来的残留，引用了一个尚不存在的 Go 后端

### 1.2 核心矛盾与范围决策

需求中存在两个看似冲突的表述：

- "迁移*整个* 0.3.0 后端" → 引入认证 / 算力点 / 后台 / Linux.do OAuth / AI 代理
- "对齐 infinite-canvas *当前*所有系统功能" → 目标已刻意移除这些，且新增了 Gemini/Codex/Web Agent Loop 等后端没有的功能

**用户决策（brainstorming Q&A）**：选择 **"完整后端 + 对齐新功能"** —— 迁移 0.3.0 全部后端逻辑（含认证 / 算力点 / 后台 / Linux.do OAuth），并适配目标比 0.3.0 多出的功能（Gemini 渠道、Web Agent Loop、Codex 插件、canvas-agent）与当前前端。目标回归多用户服务形态（撤销 v0.4.0 "移除后端" 的定位）。前后端都动。

### 1.3 迁移方式决策

**用户决策**：选择 **方案 B —— 迁移 + 即时重构**。迁移 0.3.0 后端，并在同一轮里重构（postgres-only、拆分 settings、清理包/边界）。不是机械的 1:1 拷贝。本设计明确界定"重构什么 / 保留什么"，以控制范围。

### 1.4 其他决策汇总

| # | 决策点 | 选择 |
|---|---|---|
| 2 | Gemini 协议 | 后端 AI 代理也支持 Gemini 协议，对齐目标 `apiFormat` |
| 3 | 前端适配范围 | 完整拉回前端缺失部分（认证/后台/remote/代理），保留更新的组件 |
| 4 | 数据库表 | 以 0.3.0 的 5 张表为基线，按需增删字段/表对齐新功能 |
| 5 | Docker 部署 | 生产也多容器（api + web + postgres），开发多服务热重载 |
| 6 | 算力点计费 | 新功能（Web Agent Loop / canvas-agent）也走算力点预扣/返还 |
| 7 | render.yaml | 本轮留待定，Docker compose 为主部署路径 |
| 8 | Vercel | 放弃 Vercel 一键部署（无法运行 Go/postgres），移除相关说明 |

---

## 2. 架构与目标布局

### 2.1 高层架构

迁移后目标仓库恢复为 **Next.js 前端 + Go（Gin/GORM）后端 + PostgreSQL**，Docker 多容器部署。Next.js 前端通过 catch-all 代理（`web/src/app/api/[...path]/route.ts`，从 0.3.0 拉回）将所有 `/api/*` 请求代理到 Go 服务。Go 服务处理认证 / 算力点 / 后台 / AI 代理 / 提示词同步，并把 AI 请求按渠道协议代理到真实的 OpenAI 兼容或 Gemini 格式上游。

### 2.2 目标仓库布局（后端 Go 源树置于根目录，沿用 0.3.0 包结构，重构点见第 4 节）

```
infinite-canvas/
├── main.go                      # 入口：config.Load → EnsureDefaultAdmin → StartPromptSyncScheduler → router.Run
├── go.mod / go.sum              # postgres-only 依赖（移除 sqlite/mysql 驱动）
├── config/                      # 沿用 0.3.0；移除 SQLite DSN 规范化辅助
├── model/                       # 沿用 5 个模型；ModelChannel.Protocol 支持 gemini
├── repository/                  # 沿用；db.go 改为 postgres-only
├── service/                     # 重构：settings.go 拆分（见第 4 节）
├── handler/                     # 沿用 0.3.0 handler；ai.go 协议感知
├── router/                      # 沿用
├── middleware/                  # 沿用
├── .air.toml                    # 新增（从 0.3.0 复制，开发热重载）
├── Dockerfile                   # 生产 web：bun 构建 → node standalone 运行
├── Dockerfile.api               # 新增 生产 api：go 构建 → 运行二进制
├── Dockerfile.dev               # 新增（从 0.3.0 复制）：api-dev + web-dev 双 target
├── docker-compose.yml           # 生产：api + web + postgres（3 服务，构建镜像，不挂源码）
├── docker-compose.local.yml     # 开发：api(air) + web(bun) + postgres（热重载，挂源码）
├── .env / .env.example          # 对齐：移除 STORAGE_DRIVER，仅 DATABASE_DSN；PORT、API_BASE_URL
├── render.yaml                  # 本轮不动（留待定，README 入口可能暂时失效）
└── web/                         # 前端：拉回缺失部分（见第 5 节），保留更新组件
```

### 2.3 重构范围（方案 B）—— 明确"重构 / 保留"边界

**重构**：
1. 数据层 → postgres-only（移除 sqlite/mysql dialect、`ensureMySQLDatabase`、mysql 驱动导入；保留 `ensurePostgresDatabase` 作为本地开发兜底）
2. `service/settings.go`（约 400 行）拆分为 `settings.go` + `channel.go` + `channel_admin.go`（拆分后再加 Gemini 分支，避免单文件膨胀）
3. 从 `handler/ai.go` 抽出 `service/ai_proxy.go`（协议分发 + 上游请求构造），让 `handler/ai.go` 只剩 HTTP 粘合

**保持 1:1 移植（不做结构重构）**：`model/`、`repository/`（除 db.go 改 postgres-only）、`middleware/`、`router/`、`handler/response.go`、auth 全流程、提示词同步调度器、提示词抓取、media reference handler、Linux.do OAuth。

---

## 3. 数据模型（PostgreSQL，基线 + 对齐调整）

基线 = 0.3.0 的 5 张表（GORM `AutoMigrate` 迁移，PostgreSQL 类型）。代码迁移、空库起步、无数据迁移。

| 表 | 关键列 | 迁移说明 |
|---|---|---|
| `users` | id PK, username unique, password(bcrypt), role, credits, aff_code unique, linux_do_id idx, status, extra jsonb | 1:1 移植 |
| `credit_logs` | id PK, user_id idx, type, amount, balance, related_id, extra jsonb | 1:1 移植 |
| `prompts` | id PK, category idx, tags jsonb, preview text | 1:1 移植；`github_url` 仍为读时计算（非列） |
| `assets` | id PK, type, tags jsonb, content text, url | 1:1 移植 |
| `settings` | key PK（`public`/`private`）, value jsonb | 1:1 移植；容纳渠道协议扩展 |

### 3.1 对齐调整（增删字段/表）

1. **`settings.private.value` JSON — 扩展 `channels[]` schema**。0.3.0 的 `ModelChannel` 有 `{protocol, name, baseUrl, apiKey, models, weight, enabled, remark}`，`protocol` 仅 `"openai"`。**新增 `protocol: "openai" | "gemini"` 作为实际值**（不只是默认），对齐目标前端的 `apiFormat`。无需新表 —— 仅扩展 JSON schema 与 `normalizePrivateSetting` 规范化。`settings.public.value.modelChannel` 不变（不暴露 apiKey）。

2. **不新增 `settings` 行/表**。0.3.0 用两行 JSON 存所有可变配置，`AutoMigrate` 自动维护。

3. **Web Agent Loop / canvas-agent 会话持久化 —— 本轮不新增表**。目标的 Web Agent Loop 把会话/消息存浏览器状态（`useCanvasAgentStore`，截断 120 条）与 `localStorage`，非服务端；0.3.0 后端也无 agent 会话表。按 YAGNI 与"对齐"，**不新增** agent 会话表 —— agent 的 AI 调用走既有 `/api/v1/chat/completions`（计费走既有 credits），线程留在客户端。如需服务端持久化，后续再补表（易回退）。

4. **移除 SQLite/MySQL 专有 tag 过滤分支**。`repository/prompt.go` 与 `asset.go` 的 `JSON_CONTAINS`（MySQL）/ `jsonb_exists`（Postgres）/ `json_each`（SQLite）分支 → postgres-only 重构后**仅保留 `jsonb_exists` 分支**，删另两个。行为中立的简化。

5. **`credit_logs` 类型不新增枚举**。沿用 0.3.0 三类 `ai_consume` / `ai_refund` / `admin_adjust`。Web Agent Loop / canvas-agent 调用计费时，用 `remark` 区分（如 "agent chat" vs "image generation"），不改枚举、不改 schema。

### 3.2 建库策略

多容器 Docker 下 `postgres:16-alpine` 服务用 `POSTGRES_DB=infinite-canvas` 建库，运行时账号无需 CREATEDB。`ensurePostgresDatabase` 作为本地开发兜底保留（账号有 CREATEDB 时自动建库）。`AutoMigrate` 创建全部 5 张表。

---

## 4. 后端重构（方案 B 范围）

### 4.1 `service/settings.go` 三拆

| 新文件 | 从 `settings.go` 移出的函数 | 职责 |
|---|---|---|
| `service/settings.go`（瘦身） | `PublicSettings`、`AdminSettings`、`SaveSettings`、`normalizeSettings`、`normalizePublicSetting*`、`normalizePrivateSetting`、`hidePrivateAPIKeys`、`keepPrivateAPIKeys`、`keepPrivateAuthSecrets`、`findSavedChannel`、`ModelCost` | 设置 CRUD + 规范化 + 密钥脱敏 |
| `service/channel.go`（新） | `SelectModelChannel`、`BuildModelChannelURL`、`normalizeModelChannelBaseURL`、`modelChannelsForModel`、`enabledChannelModels`、`uniqueModelNames`、`repairDefaultModel`、`is*ModelName`、`normalizeModelChannel` | 渠道选择 + URL 构造 + 模型分类 |
| `service/channel_admin.go`（新） | `AdminChannelModels`、`AdminTestChannelModel`、`resolveAdminChannel`、`fetchAdminChannelModels`、`testAdminChannelModel`、`testArkSeedanceChannelModel`、`readAdminChannelError`、`isArkAgentPlanChannel`、`isSeedanceModelName`、`adminModelHTTPClient`、`safeMessageError` | 后台渠道测试/列模型 + 上游错误规范化 |

拆分为纯机械移动（搬函数、改 import），不改行为。Gemini 分支可干净地落到 `channel.go`（URL 构造）与 `channel_admin.go`（测试）。

### 4.2 从 `handler/ai.go` 抽出 `service/ai_proxy.go`

把协议分发 + 上游请求构造（`buildGeminiUpstream`、`buildOpenAIUpstream`、路径重写表、扩展后的 `resolveAIProxyPath`）移到 service 层；`handler/ai.go` 只剩 HTTP 粘合（读请求 → 调 `service.ProxyAIRequest(...)` → 写响应）。`copyAIResponse`、`readAIRequest`、`readAIRequestCount`、错误格式化辅助留在 `handler/ai.go`。

### 4.3 postgres-only 重构

- `repository/db.go`：删 `dialector()` 分支、`ensureMySQLDatabase`、`isMySQLError`、`quoteMySQLIdentifier`、mysql/sqlite 导入、`isPostgresDriver`。保留 `ensurePostgresDatabase`。`DB()` 直接 `postgres.Open(dsn)`。`AutoMigrate` 保留 5 个模型。
- `config/config.go`：删 `normalizeDockerSQLiteDSN`。**移除 `StorageDriver` 配置字段**（恒为 postgres）；`DatabaseDSN` 为唯一数据库配置。`.env` 移除 `STORAGE_DRIVER`，仅留 `DATABASE_DSN`。
- `repository/prompt.go` + `asset.go`：`promptJSONTagsContains` / `assetJSONTagsContains` 折叠为仅 `jsonb_exists` 分支。
- `go.mod`：移除 `github.com/glebarez/sqlite`、`gorm.io/driver/mysql`、`github.com/go-sql-driver/mysql` 及其间接依赖。保留 `gorm.io/driver/postgres`、`github.com/jackc/pgx/v5`、`github.com/jackc/pgconn`。

### 4.4 刻意不重构（保持 1:1 移植）

- `model/*.go` —— 结构体不变（仅 `ModelChannel.Protocol` 语义扩展为接受 `"gemini"`）
- `repository/user.go`、`setting.go` —— 不变
- `service/auth.go`（JWT/bcrypt/OAuth/credits）—— 不变，安全关键代码 1:1 移植避免回归
- `service/prompt_fetch.go`、`prompt_sync_scheduler.go`、`prompts.go`、`assets.go`、`context.go` —— 不变
- `middleware/admin.go` —— 不变
- `handler/auth.go`、`admin.go`、`settings.go`、`media_reference.go`、`assets.go`、`prompts.go`、`response.go` —— 不变
- `router/router.go` —— 路由表不变（前端对齐见第 5 节，后端路由不变）

### 4.5 测试

0.3.0 有 5 个 Go 测试：`handler/ai_test.go`、`handler/media_reference_test.go`、`service/auth_redirect_test.go`、`service/settings_test.go`、`config/config_test.go`。全部移植并适配 postgres-only。重构必须保持测试通过（行为不变）。不引入新测试框架（沿用标准库 `testing` + httptest）。

---

## 5. 后端 AI 代理（Gemini 协议支持 + 新功能计费）

0.3.0 的 AI 代理是**透明透传管道**：读请求体、提取 `model`、按模型选渠道、扣算力点、把原始请求体 + Bearer 鉴权转发给上游、原始响应流回。不做请求格式转换。目标前端在 local 模式已为 Gemini 渠道构造好 Gemini 格式请求体。因此后端 Gemini 支持 = **让透传管道协议感知**，而非在后端做 OpenAI→Gemini 转换。

### 5.1 协议分发（`service/ai_proxy.go`）

```go
// selectChannel → resolveUpstreamRequest(channel, modelName, clientPath) → forward
func resolveUpstreamRequest(channel ModelChannel, modelName, path string, body []byte, contentType string) upstreamRequest {
    switch channel.Protocol {
    case "gemini":
        return buildGeminiUpstream(channel, modelName, path, body)   // :generateContent, ?key=, 无 Bearer
    default: // "openai"
        return buildOpenAIUpstream(channel, modelName, path, body, contentType)  // /v1/<path>, Bearer
    }
}
```

### 5.2 各协议行为（后端按选中渠道的 `Protocol` 适配）

| 关注点 | openai（0.3.0 既有，保留） | gemini（新增） |
|---|---|---|
| URL 构造 | `BuildModelChannelURL(channel, path)` → `baseUrl/v1/<path>` | `baseUrl/models/{model}:<action>?key={apiKey}`（无 `/v1`；action 由 path 映射） |
| 鉴权 | `Authorization: Bearer {apiKey}` 头 | `?key={apiKey}` 查询参数，无 Bearer |
| 请求体 | 原样透传（前端已构造 OpenAI 格式） | 原样透传（前端已构造 Gemini 格式 `contents`/`parts`） |
| 响应 | 原样流回 | 原样流回 |
| 流式 | SSE 透传 | SSE 透传（`?alt=sse`） |
| model 提取 | JSON/multipart 的 `model` 字段 | 同 —— JSON 体的 `model` 字段 |

### 5.3 关键兼容性决策

- **前端 remote 模式仍 POST 到相同的 `/api/v1/*` 路径**（`/api/v1/chat/completions`、`/api/v1/images/generations` 等），与渠道协议无关。**后端从选中渠道的 `Protocol` 发现协议**并重写为上游对应形式。前端保持单一 URL 形态，协议适配留在后端（与渠道选择同处）。
- **路径重写表**（扩展 0.3.0 已有的 `resolveAIProxyPath`，按 protocol × path 索引）：
  - `openai`：既有行为 + Seedance 特例（`/videos` → `/contents/generations/tasks`）
  - `gemini`：`/chat/completions` → `:streamGenerateContent?alt=sse`（流式）或 `:generateContent`（非流式）；`/images/generations` 与 `/images/edits` → `:generateContent`；`/audio/speech` → Gemini 不支持（报错）；`/videos` → Gemini 不支持（报错）
- **流式检测**：按请求体 JSON 的 `stream` 字段（最简、契合前端现状）。
- **multipart（`/images/edits`）**：Gemini 的 edit 走 JSON（`inlineData` base64），前端在 Gemini 模式已构造 JSON（非 multipart），故后端 multipart 读取路径不会在 Gemini edit 触发；`readAIRequest` 已同时处理 JSON 与 multipart。✓

### 5.4 新功能算力点计费（Web Agent Loop / canvas-agent）

两者已调用 `@/services/api/image.ts` 的 `requestToolResponse` / `requestStreamingResponse`，这些函数在 `channelMode === "remote"` 时 POST 到 `/api/v1/chat/completions`。一旦重新启用 remote 模式，这些调用**自动**经后端代理 → `ConsumeUserCredits` / `RefundUserCredits`。**后端无需新增计费代码** —— 同一 `proxyAIRequest` 路径、同一 `ModelCost` 查询。agent 文本模型的成本由后台 `modelCosts[]` 配置决定。`SelectModelChannel` 按模型名筛选渠道（Gemini 渠道只在 `Models[]` 列 Gemini 模型），加权随机不变。`ModelCost` 查询对 Gemini 模型名（如 `gemini-2.5-flash-image`）同样匹配，机制不变。

---

## 6. 前端拉回（从 0.3.0 完整恢复，保留更新组件）

### 6.1 从 0.3.0 拉回的文件

| 区域 | 拉回内容 | 目标现状 |
|---|---|---|
| Catch-all 代理 | `web/src/app/api/[...path]/route.ts`（`/api/*` 代理到 `API_BASE_URL`，默认 `http://127.0.0.1:8088`） | 不存在（仅有 `api/prompts/route.ts`） |
| 认证 UI | `web/src/app/(user)/login/`（登录/注册/Linux.do 按钮） | 不存在 |
| 后台页面 | `web/src/app/(admin)/`（用户/算力点流水/设置/渠道/提示词/素材） | 不存在 |
| 素材库 | `web/src/app/(user)/asset-library/` | 不存在 |
| API 客户端 | `web/src/services/api/auth.ts`、`admin.ts`、`assets.ts` | 不存在 |
| 用户 store | `web/src/stores/use-user-store.ts`（完整版：token、AuthUser、persist、hydrate/login/register） | 目标为简化 `LocalUser`（无 token/auth） |

### 6.2 刻意保留的目标更新组件（不从 0.3.0 覆盖）

- `web/src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx`
- `web/src/app/(user)/canvas/components/canvas-local-agent-panel.tsx`
- `canvas-assistant-panel.tsx`（Web Agent Loop）
- `plugins/infinite-canvas/`（Codex App 插件）
- 目标的 Gemini 处理逻辑（`image.ts`、`use-config-store.ts` 的 `apiFormat`、`geminiApiUrl` 等）
- 目标的 `credits.tsx` `requestCreditCost`（已 remote-aware）

### 6.3 协调冲突

1. **`use-user-store.ts` 合并而非替换**。0.3.0 的 store 含 `{token, user: AuthUser, isReady, isLoading, setSession, clearSession, hydrateUser, login, register}`；目标更新组件读取 `useUserStore.getState().token`（0.3.0 store 已有 `token` → 兼容）。恢复 0.3.0 完整 store；`canvas-agent-chat-ui.tsx` 的 `LocalUser` 引用改为 `AuthUser`（超集：含 id/username/displayName/avatarUrl + credits/role）。

2. **`channelMode` 重新启用 `"remote"`，保留 `"local"`**。移除 `useEffectiveConfig` 与 normalize 路径中硬编码的 `"local"` 强制；恢复 0.3.0 的 `channelMode` 用户可切换。`requestCreditCost` 已仅在 `=== "remote"` 时返回成本 → 自然工作。

3. **`image.ts` remote 模式补齐**。目标 `image.ts` 的 `aiApiUrl` 直接用 `config.baseUrl`，**无** `channelMode === "remote"` 分支（与 `video.ts`/`audio.ts` 不一致）。恢复 `image.ts` 的 remote→`/api/v1/*` 分支，与 video/audio 一致，使图像生成在 remote 模式也走后端代理（并计费）。

4. **提示词路由处理器**。移除目标的内存提示词路由 `web/src/app/api/prompts/route.ts`，统一用后端 `/api/prompts`（迁移后始终有后端，双来源会不一致）。

5. **配置弹窗 / 设置 UI**。保留目标的更新配置 UI（Gemini 渠道、channelMode），重新加入 0.3.0 的 channelMode 开关与后台入口；把 0.3.0 后台设置页（渠道/modelCosts/LinuxDo/提示词同步）作为 admin section 接入。

6. **`use-config-store.ts`**。保留目标的 `apiFormat` + 渠道结构，加入 0.3.0 的 remote 路径。后台页写**后端** `settings.private.channels`（服务端，remote 模式用）；用户配置弹窗写**浏览器 localforage**（local 模式用）。两套配置面通过 `channelMode` 共存 —— 这正是 0.3.0 既有架构。

---

## 7. Docker 与部署（开发/生产多容器）

### 7.1 开发 `docker-compose.local.yml`（沿用 0.3.0 模式）

```yaml
services:
  postgres:   # postgres:16-alpine, POSTGRES_DB=infinite-canvas, healthcheck, pgdata volume
  api:        # build Dockerfile.dev target=api-dev, air 热重载@8088, 依赖 postgres healthy
              # 挂载 .:/app + ./data:/app/data; PORT=8088; DATABASE_DSN=postgresql://...
  web:        # build Dockerfile.dev target=web-dev, bun HMR@3000, 依赖 api started
              # 挂载 ./web:/app/web; API_BASE_URL=http://api:8088
volumes:
  pgdata:
```

- `Dockerfile.dev`（从 0.3.0 复制）：双 stage —— `api-dev`（golang:1.25-alpine + `air` + go mod download，EXPOSE 8088）与 `web-dev`（oven/bun:1.3.13 + bun install，EXPOSE 3000）。热重载靠挂源码卷。
- `.air.toml`（从 0.3.0 复制）：监听 `.go`，重建 `/app/server`。
- 开发 `.env`：`DATABASE_DSN=postgresql://eldenpdx@postgres:5432/infinite-canvas?sslmode=disable`、`PORT=8088`、`API_BASE_URL=http://api:8088`。
- **端口对齐**：目标 `web/package.json` dev 脚本现为 `-p 3001`（工作区唯一改动）。将 dev 脚本改回 `-p 3000`，与 compose 及 0.3.0 一致（3001 为临时本地改动）。

### 7.2 生产 `docker-compose.yml`（多容器，新设计 —— 非 0.3.0 单镜像）

```yaml
services:
  postgres:   # postgres:16-alpine, POSTGRES_DB/USER/PASSWORD（secret）, healthcheck, pgdata volume, 不暴露端口（仅内部）
  api:        # build Dockerfile.api（生产 stage）, 依赖 postgres healthy
              # env_file .env; PORT=8088（内部）; DATABASE_DSN=postgresql://...; 不暴露端口; ./data:/app/data; restart unless-stopped
  web:        # build Dockerfile（生产 stage）, 依赖 api started
              # env_file .env; API_BASE_URL=http://api:8088; ports "3000:3000"; restart unless-stopped
volumes:
  pgdata:
```

- **两个生产 Dockerfile**：`Dockerfile`（web：bun 构建 → node standalone 运行）与 `Dockerfile.api`（api：go 构建 → alpine/distroless 运行二进制）。各由对应 compose 服务构建。开发保持单个 `Dockerfile.dev`（双 target，开发靠 target 共享）。
- 生产 `postgres` 用真实 `POSTGRES_PASSWORD`（来自 `.env`，非 trust）；`DATABASE_DSN` 含密码。
- **与 0.3.0 单镜像的区别**：0.3.0 在一个容器内同时跑 Go + Next（`CMD sh -c "PORT=8080 /app/server & node server.js"`）；多容器改为两个独立服务。

### 7.3 `render.yaml`（留待定）

本轮迁移不动 `render.yaml`。Docker compose 为主要部署路径。README 中 Render 入口可能暂时失效 —— 本设计将其列为已知缺口，后续单独处理多服务 Render 配置（web service + pserv api + 托管 postgres）。

### 7.4 Vercel（放弃）

移除 Vercel 一键部署支持。目标无 `vercel.json` 文件，Vercel 相关引用仅在 README/docs —— 移除这些文档引用。部署统一走 Docker，与"完整后端"定位一致。

---

## 8. 错误处理、测试与验证

### 8.1 错误处理（沿用 0.3.0 约定）

- 所有业务接口统一 `{code, data, msg}`；`code:0` 成功，`code:1` 失败，业务失败也返回 **HTTP 200**（`handler/response.go`）。前端按 `code` 判断。
- `safeMessageError` 是唯一向客户端暴露消息的错误类型；其他错误返回通用 `"操作失败"` / `"AI 接口请求失败"`，避免泄漏上游细节。Gemini 路径同样走 `readAdminChannelError` / `aiUpstreamErrorDetail`。
- AI 代理失败：上游 4xx/5xx → `onFailure()` → `RefundUserCredits` → `Fail(w, aiUpstreamStatusMessage(...))`。Gemini 协议下不变（同一 `copyAIResponse`，仅上游 URL/鉴权不同）。
- 安全防护 1:1 保留：`safeRedirectPath`（防开放重定向）、bcrypt 默认成本、JWT 非 HMAC 拒绝、media-reference 路径穿越防护（`filepath.Base` + `..` 拒绝）。
- **迁移引入的新风险与处置**：
  - `RequestOrigin` 信任 `X-Forwarded-Host`/`X-Forwarded-Proto` 构造 OAuth 重定向 URI —— 多容器代理后，由 web 容器的 catch-all 设置（0.3.0 代理已设 `x-forwarded-host/proto`）。需验证。
  - Gemini `?key=` 把 API key 放 URL 查询参数 —— 日志/缓存可能泄漏。上游错误日志中对 Gemini URL **脱敏**（移除 `key=` 参数再记录）。

### 8.2 测试

| 文件 | 移植适配 |
|---|---|
| `handler/ai_test.go` | 增加 Gemini 协议用例（`Protocol:"gemini"` 渠道 → 期望 `:generateContent?key=` URL、无 Bearer 头） |
| `handler/media_reference_test.go` | 1:1 移植 |
| `config/config_test.go` | 删 SQLite DSN 规范化测试；仅留 postgres DSN 解析测试 |
| `service/auth_redirect_test.go` | 1:1 移植 |
| `service/settings_test.go` | 适配三拆后的 import 路径；增加 Gemini `protocol` 规范化测试 |

重构必须保持既有测试通过（行为不变）。不引入新测试框架（标准库 `testing` + httptest）。

### 8.3 前端验证（手动，项目无 JS 测试框架）

目标无 jest/vitest，验证靠手动跑开发 compose 走流程。

### 8.4 验收清单（用于实现计划）

1. `docker compose -f docker-compose.local.yml up` 起开发 compose
2. `AutoMigrate` 创建 5 张表
3. 默认管理员自动创建
4. 登录 / 注册 / JWT 流程
5. Linux.do OAuth 流程（若已配置）
6. 后台：用户 / 算力点 / 设置 / 渠道 / 提示词 / 素材 CRUD
7. remote 模式 + openai 渠道 AI 生成 —— 算力点预扣、失败返还
8. remote 模式 + gemini 渠道 AI 生成 —— 正确 `:generateContent?key=` URL、算力点预扣/返还
9. remote 模式 Web Agent Loop —— 算力点预扣
10. 提示词同步调度器运行（检查 cron 日志）
11. local 模式仍工作（浏览器直连、不计费）
12. 生产 compose 起来（api + web + postgres）
13. `go test ./...` 通过
14. `bun run build` 通过

### 8.5 "迁移完成"的定义

- 后端 `go build` + `go test ./...` 通过
- 前端 `bun run build` 通过
- 开发 compose 启动并跑通验收清单全部流程
- 生产 compose 启动
- Gemini 协议路径工作
- 新功能（Web Agent Loop、canvas-agent、Codex 插件）在 remote 模式工作
- Vercel 引用移除
- `render.yaml` 标注为待定

---

## 9. 路由清单（后端，不变 —— 供前端对齐参考）

来自 0.3.0 `router/router.go`，迁移后保持不变：

**公开（无鉴权，除注明）：**
- `GET /api/health` → inline `ok`
- `POST /api/auth/register` → `handler.Register`
- `POST /api/auth/login` → `handler.Login`
- `GET /api/auth/linux-do/authorize` → `handler.LinuxDoAuthorize`
- `GET /api/auth/linux-do/callback` → `handler.LinuxDoCallback`
- `GET /api/auth/me` → `handler.CurrentUser`（OptionalAuth）
- `GET /api/settings` → `handler.Settings`
- `GET /api/media/references/:id`（+HEAD）→ `handler.ReferenceMedia`
- `GET /api/prompts` → `handler.Prompts`（OptionalAuth）
- `GET /api/assets` → `handler.Assets`（OptionalAuth）
- `POST /api/admin/login` → `handler.AdminLogin`

**`/api/v1`（UserAuth 必需）：**
- `POST /api/v1/images/generations` → `handler.AIImagesGenerations`
- `POST /api/v1/images/edits` → `handler.AIImagesEdits`
- `POST /api/v1/chat/completions` → `handler.AIChatCompletions`
- `POST /api/v1/audio/speech` → `handler.AIAudioSpeech`
- `POST /api/v1/videos` → `handler.AIVideos`
- `POST /api/v1/media/references` → `handler.UploadReferenceMedia`
- `GET /api/v1/videos/:id` → `handler.AIVideo`
- `GET /api/v1/videos/:id/content` → `handler.AIVideoContent`

**`/api/admin`（AdminAuth 必需）：**
- `GET/POST /api/admin/users`、`POST /api/admin/users/:id/credits`、`DELETE /api/admin/users/:id`
- `GET/POST /api/admin/credit-logs`、`DELETE /api/admin/credit-logs/:id`
- `GET/POST /api/admin/settings`、`POST /api/admin/settings/channel-models`、`POST /api/admin/settings/channel-test`
- `GET /api/admin/prompt-categories`、`POST /api/admin/prompt-categories/sync`
- `GET/POST /api/admin/prompts`、`POST /api/admin/prompts/batch-delete`、`DELETE /api/admin/prompts/:id`
- `GET/POST /api/admin/assets`、`DELETE /api/admin/assets/:id`

`router.NoRoute` → `middleware.NotFoundJSON`（`{code:1, msg:"接口不存在"}`）。

---

## 10. 已知缺口与后续

- **`render.yaml`**：本轮不动，多服务 Render 配置后续单独处理。README Render 入口可能暂时失效。
- **Vercel**：移除支持，相关文档引用清除。
- **Web Agent Loop / canvas-agent 服务端会话持久化**：本轮不新增表，线程留客户端。如需服务端持久化或历史记录，后续补表。
- **端口**：`web/package.json` dev 脚本从 3001 改回 3000（本设计已含此改动）。
