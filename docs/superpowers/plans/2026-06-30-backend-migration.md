# 后端系统迁移实现计划：infinite-canvas-0.3.0 → infinite-canvas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `infinite-canvas-0.3.0` 的整个 Go 后端迁移到 `infinite-canvas`（当前 main，纯前端），PostgreSQL，重构为 postgres-only + Gemini 协议支持，前端拉回认证/后台/remote 路径并保留更新组件，Docker 多容器开发/生产部署。

**Architecture:** 目标仓库恢复为 Next.js 前端 + Go(Gin/GORM) 后端 + PostgreSQL 多容器部署。前端 catch-all 代理 `/api/*` → Go。Go 处理认证/算力点/后台/AI 代理/提示词同步，AI 请求按渠道 `Protocol`（openai|gemini）代理到上游。方案 B：迁移 + 即时重构。

**Tech Stack:** Go 1.25 + Gin + GORM + gorm.io/driver/postgres + jackc/pgx + robfig/cron/v3 + golang-jwt/v5；Next.js 16 + React 19 + TypeScript + Zustand + axios；PostgreSQL 16；Docker + docker-compose；air（Go 热重载）；bun（前端）。

## Global Constraints

- **数据库**：仅 PostgreSQL。移除 `STORAGE_DRIVER` 配置字段与 sqlite/mysql 驱动；`DATABASE_DSN` 为唯一数据库配置。代码迁移、空库起步、不做任何数据迁移。
- **Go 模块路径**：`github.com/basketikun/infinite-canvas`（沿用 0.3.0，与目标仓库根目录一致）。
- **统一响应**：所有业务接口返回 `{code, data, msg}`，`code:0` 成功，业务失败也返回 HTTP 200。前端按 `code` 判断。
- **端口**：Go 后端内部 8088；Next.js 3000。`web/package.json` dev 脚本从 `-p 3001` 改回 `-p 3000`。
- **协议**：渠道 `protocol` 取 `"openai"`（默认）或 `"gemini"`，对齐前端 `apiFormat`。后端透明透传，不做 OpenAI↔Gemini 请求体转换。
- **计费**：`channelMode === "remote"` 才计费（前端 `requestCreditCost` 已如此）。仅 online/Web Agent Loop 路径经后端计费；local canvas-agent（127.0.0.1:17371）不经后端、不计费。
- **部署**：放弃 Vercel（移除 README/docs 引用）；`render.yaml` 本轮不动（留待定）。
- **安全**：1:1 保留 0.3.0 的 `safeRedirectPath`、bcrypt 默认成本、JWT 非 HMAC 拒绝、media-reference 路径穿越防护。Gemini 上游错误日志对 URL `key=` 参数脱敏。
- **源仓库路径**：`/Users/eldenpdx/git-project/infinite-canvas-0.3.0`（下文记作 `$SRC`）。目标仓库：`/Users/eldenpdx/git-project/infinite-canvas`（下文记作 `$TGT`）。所有命令默认在 `$TGT` 执行。
- **测试**：沿用标准库 `testing` + httptest，不引入新框架。重构保持既有测试通过。
- **提交**：每个任务结束提交一次，提交信息用 `feat`/`refactor`/`test`/`chore`/`docs` 前缀，中文描述可。

## 阶段总览

- **阶段 1（任务 1-3）**：后端源树移植 + postgres-only 重构 + 构建可跑
- **阶段 2（任务 4-5）**：`settings.go` 三拆 + `ai_proxy.go` 抽出（机械重构）
- **阶段 3（任务 6）**：Gemini 协议支持（AI 代理 + channel）
- **阶段 4（任务 7）**：测试移植与适配
- **阶段 5（任务 8-11）**：前端拉回（代理/认证/后台/asset/API 客户端/store/channelMode）
- **阶段 6（任务 12-14）**：Docker 多容器（开发/生产）+ .env 对齐
- **阶段 7（任务 15）**：收尾（Vercel 移除、CHANGELOG、最终验收）

---

## Task 1: 移植后端 Go 源树到目标仓库

**目标**：把 `$SRC` 的整个 Go 后端源树复制到 `$TGT` 根目录，建立 Go 模块，使 `go build` 先在 sqlite 驱动下跑通（postgres-only 重构在后续任务）。这一步是 1:1 拷贝，不改逻辑。

**Files:**
- Create: `$TGT/main.go`、`$TGT/go.mod`、`$TGT/go.sum`
- Create: `$TGT/config/`（config.go、config_test.go）
- Create: `$TGT/model/`（asset.go、prompt.go、query.go、setting.go、user.go）
- Create: `$TGT/repository/`（asset.go、db.go、prompt.go、setting.go、user.go）
- Create: `$TGT/service/`（assets.go、auth.go、auth_redirect_test.go、context.go、prompt_fetch.go、prompt_sync_scheduler.go、prompts.go、settings.go、settings_test.go）
- Create: `$TGT/handler/`（admin.go、ai.go、ai_test.go、assets.go、auth.go、media_reference.go、media_reference_test.go、prompts.go、response.go、settings.go）
- Create: `$TGT/middleware/`（admin.go）
- Create: `$TGT/router/`（router.go）

**Interfaces:**
- Consumes: 无（起始任务）
- Produces: 完整的 Go 后端源树，`main.go` 入口 `config.Load → service.EnsureDefaultAdmin → service.StartPromptSyncScheduler → router.New().Run(":" + config.Cfg.Port)`；包路径 `github.com/basketikun/infinite-canvas/{config,model,repository,service,handler,router,middleware}`

- [ ] **Step 1: 拷贝后端源树**

从 `$SRC` 拷贝所有 Go 后端目录与文件到 `$TGT` 根目录（不拷贝 `web/`、`docs/`、`docs2/`、`data/`、`server` 二进制、`.air.toml`、Dockerfile 等非 Go 源）：

```bash
cd /Users/eldenpdx/git-project/infinite-canvas
cp -R /Users/eldenpdx/git-project/infinite-canvas-0.3.0/config .
cp -R /Users/eldenpdx/git-project/infinite-canvas-0.3.0/model .
cp -R /Users/eldenpdx/git-project/infinite-canvas-0.3.0/repository .
cp -R /Users/eldenpdx/git-project/infinite-canvas-0.3.0/service .
cp -R /Users/eldenpdx/git-project/infinite-canvas-0.3.0/handler .
cp -R /Users/eldenpdx/git-project/infinite-canvas-0.3.0/middleware .
cp -R /Users/eldenpdx/git-project/infinite-canvas-0.3.0/router .
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/main.go .
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/go.mod .
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/go.sum .
```

- [ ] **Step 2: 验证 Go 源树就位**

```bash
ls -1 main.go go.mod go.sum config model repository service handler middleware router
```
Expected: 列出全部 11 项（main.go、go.mod、go.sum 与 8 个目录）。

- [ ] **Step 3: 下载依赖并构建**

```bash
go mod download
go build ./...
```
Expected: 无报错，构建通过（此时仍是 0.3.0 的多驱动代码，sqlite 默认）。

- [ ] **Step 4: 提交**

```bash
git add main.go go.mod go.sum config model repository service handler middleware router
git commit -m "feat(backend): port Go backend source tree from infinite-canvas-0.3.0"
```

---

## Task 2: postgres-only 重构 — config 与 repository/db.go

**目标**：移除 `StorageDriver` 配置字段与 sqlite/mysql 驱动支持，`repository/db.go` 直接用 postgres。`config.Load()` 不再规范化 SQLite DSN。

**Files:**
- Modify: `$TGT/config/config.go`（移除 `StorageDriver` 字段、`normalizeDockerSQLiteDSN` 及其调用）
- Modify: `$TGT/repository/db.go`（移除 `dialector`、`ensureMySQLDatabase`、`isMySQLError`、`quoteMySQLIdentifier`、`isPostgresDriver`、sqlite/mysql 导入；`DB()` 直接 `postgres.Open`）
- Modify: `$TGT/go.mod` / `$TGT/go.sum`（移除 sqlite/mysql 驱动依赖）

**Interfaces:**
- Consumes: Task 1 的源树
- Produces: `config.Cfg` 不再有 `StorageDriver`，只有 `DatabaseDSN`（postgres URL）；`repository.DB()` 用 `gorm.io/driver/postgres`。后续任务依赖 `config.Cfg.DatabaseDSN` 为 postgres URL。

- [ ] **Step 1: 重写 `config/config.go`**

把 `$TGT/config/config.go` 整体替换为（移除 `StorageDriver` 字段与 `normalizeDockerSQLiteDSN`，保留 JWT secret 自动生成与 env 加载）：

```go
package config

import (
	"crypto/rand"
	"encoding/base64"
	"strings"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Port                string `env:"PORT" envDefault:"8080"`
	AdminUsername       string `env:"ADMIN_USERNAME" envDefault:"admin"`
	AdminPassword       string `env:"ADMIN_PASSWORD" envDefault:"infinite-canvas"`
	JWTSecret           string `env:"JWT_SECRET" envDefault:"infinite-canvas"`
	JWTExpireHours      int    `env:"JWT_EXPIRE_HOURS" envDefault:"168"`
	DatabaseDSN         string `env:"DATABASE_DSN" envDefault:"postgres://localhost:5432/infinite-canvas?sslmode=disable"`
	PublicBaseURL       string `env:"PUBLIC_BASE_URL"`
	LinuxDoAuthorizeURL string `env:"LINUX_DO_AUTHORIZE_URL" envDefault:"https://connect.linux.do/oauth2/authorize"`
	LinuxDoTokenURL     string `env:"LINUX_DO_TOKEN_URL" envDefault:"https://connect.linux.do/oauth2/token"`
	LinuxDoUserInfoURL  string `env:"LINUX_DO_USERINFO_URL" envDefault:"https://connect.linux.do/api/user"`
}

var Cfg Config

func Load() error {
	_ = godotenv.Load()
	if err := env.Parse(&Cfg); err != nil {
		return err
	}
	if strings.TrimSpace(Cfg.JWTSecret) == "" || Cfg.JWTSecret == "infinite-canvas" {
		secret, err := randomSecret()
		if err != nil {
			return err
		}
		Cfg.JWTSecret = secret
	}
	return nil
}

func randomSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
```

- [ ] **Step 2: 重写 `repository/db.go` 的 DB/驱动部分**

整体替换 `$TGT/repository/db.go` 为（保留 `promptCategories` 内置列表与 `AutoMigrate`，仅保留 postgres 路径与 `ensurePostgresDatabase` 兜底）：

```go
package repository

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var promptCategories = []model.PromptCategory{
	{Category: "system", Name: "系统", Description: "系统提示词分类"},
	{Category: "gpt-image-2-prompts", Name: "GPT Image 2 Prompts", Description: "EvoLinkAI 的 GPT Image 2 案例提示词分类", GithubURL: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts", Remote: true},
	{Category: "awesome-gpt-image", Name: "Awesome GPT Image", Description: "ZeroLu 的中文 GPT Image 提示词分类", GithubURL: "https://github.com/ZeroLu/awesome-gpt-image", Remote: true},
	{Category: "awesome-gpt4o-image-prompts", Name: "Awesome GPT4o Image Prompts", Description: "ImgEdify 的 GPT-4o 图像提示词分类", GithubURL: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts", Remote: true},
	{Category: "youmind-gpt-image-2", Name: "YouMind GPT Image 2", Description: "YouMind OpenLab 的 GPT Image 2 中文提示词分类", GithubURL: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2", Remote: true},
	{Category: "youmind-nano-banana-pro", Name: "YouMind Nano Banana Pro", Description: "YouMind OpenLab 的 Nano Banana Pro 中文提示词分类", GithubURL: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts", Remote: true},
	{Category: "davidwu-gpt-image2-prompts", Name: "awesome-gpt-image2-prompts", Description: "davidwuw0811-boop 整理的 GPT Image 2 提示词分类", GithubURL: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts", Remote: true},
}

var (
	db     *gorm.DB
	dbOnce sync.Once
	dbErr  error
)

// DB 初始化并返回全局数据库连接（仅 PostgreSQL）。
func DB() (*gorm.DB, error) {
	dbOnce.Do(func() {
		dsn := config.Cfg.DatabaseDSN
		dbErr = ensurePostgresDatabase(dsn)
		if dbErr != nil {
			return
		}
		db, dbErr = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if dbErr != nil {
			return
		}
		dbErr = db.AutoMigrate(
			&model.User{},
			&model.CreditLog{},
			&model.Prompt{},
			&model.Asset{},
			&model.Setting{},
		)
	})
	return db, dbErr
}

func ensurePostgresDatabase(dsn string) error {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return err
	}
	target := strings.TrimSpace(cfg.Database)
	if target == "" {
		return nil
	}
	ctx := context.Background()
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err == nil {
		_ = conn.Close(ctx)
		return nil
	}
	if !isPostgresError(err, "3D000") {
		return err
	}

	maintenance := cfg.Copy()
	maintenance.Database = "postgres"
	if strings.EqualFold(target, "postgres") {
		maintenance.Database = "template1"
	}
	conn, err = pgx.ConnectConfig(ctx, maintenance)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{target}.Sanitize(), pgx.QueryExecModeExec)
	if isPostgresError(err, "42P04") {
		return nil
	}
	return err
}

func isPostgresError(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}
```

注意：上面用到了 `strings`，需补 import。最终 import 块应为：

```go
import (
	"context"
	"errors"
	"strings"
	"sync"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)
```
（`os`、`path/filepath` 不再需要 —— 确认无其他引用后移除；若编辑器报 `os`/`filepath` 未使用，从 import 删除。`os.MkdirAll` 原只在 sqlite 路径用，现已移除。）

- [ ] **Step 3: 移除 sqlite/mysql 依赖**

```bash
go mod tidy
```
Expected: `go.mod` 中 `github.com/glebarez/sqlite`、`gorm.io/driver/mysql`、`github.com/go-sql-driver/mysql` 及 modernc sqlite 间接依赖被移除；保留 `gorm.io/driver/postgres`、`github.com/jackc/pgx/v5`、`github.com/jackc/pgconn`。

验证：

```bash
grep -E "glebarez/sqlite|gorm.io/driver/mysql|go-sql-driver/mysql" go.mod
```
Expected: 无输出（依赖已移除）。

```bash
grep -E "gorm.io/driver/postgres|jackc/pgx/v5|jackc/pgconn" go.mod
```
Expected: 三行命中（依赖保留）。

- [ ] **Step 4: 构建验证**

```bash
go build ./...
```
Expected: 无报错。若报 `os`/`filepath` 未使用，回到 Step 2 调整 import 块。

- [ ] **Step 5: 提交**

```bash
git add config/config.go repository/db.go go.mod go.sum
git commit -m "refactor(backend): postgres-only — drop StorageDriver field and sqlite/mysql drivers"
```

---

## Task 3: postgres-only 重构 — media_reference 数据目录与 tag 过滤

**目标**：`handler/media_reference.go` 的 `referenceDataDir()` 不再依赖 `StorageDriver`（postgres DSN 是 URL，不能当文件路径）；`repository/prompt.go` 与 `asset.go` 的 tag 过滤只保留 `jsonb_exists` 分支。

**Files:**
- Modify: `$TGT/handler/media_reference.go:119-139`（`referenceDataDir` 简化为 `/app/data` → `data` 兜底）
- Modify: `$TGT/repository/prompt.go`（`promptJSONTagsContains` 只留 postgres 分支）
- Modify: `$TGT/repository/asset.go`（`assetJSONTagsContains` 只留 postgres 分支）

**Interfaces:**
- Consumes: Task 2 的 `config.Cfg`（无 `StorageDriver`）
- Produces: `referenceDataDir()` 返回 `/app/data`（Docker）或 `data`（本地）；tag 过滤仅用 `jsonb_exists`

- [ ] **Step 1: 重写 `referenceDataDir`**

把 `$TGT/handler/media_reference.go` 中的 `referenceDataDir` 函数（约 123-139 行）替换为：

```go
func referenceDataDir() string {
	if _, err := os.Stat("/app/data"); err == nil {
		return "/app/data"
	}
	return "data"
}
```

确认 `os` 仍在 `handler/media_reference.go` 的 import 中（`os.Stat` 用到）。`strings` 若仅被 `referenceDataDir` 旧逻辑使用，需检查文件其他地方是否仍引用 `strings`（`UploadReferenceMedia`/`ReferenceMedia` 中 `strings.TrimSpace` 仍在用），保留 `strings` import。

- [ ] **Step 2: 简化 `repository/prompt.go` 的 tag 过滤**

打开 `$TGT/repository/prompt.go`，找到 `promptJSONTagsContains`（约 181 行）。原函数对 mysql/postgres/sqlite 三分支，签名 `func promptJSONTagsContains(tx *gorm.DB) string`，调用处为 `condition.Or(promptJSONTagsContains(tx), tag)`（每个 tag 一次，`?` 占位符由 GORM 绑定 `tag`）。替换为仅返回 postgres 条件（**保持签名与 `?` 占位符不变**，调用处无需改动）：

```go
// promptJSONTagsContains 返回提示词 tags 的 JSON 包含条件（PostgreSQL）。
func promptJSONTagsContains(tx *gorm.DB) string {
	return "jsonb_exists(tags::jsonb, ?)"
}
```

`tx` 参数现为未使用但保留（避免改动调用处 `promptJSONTagsContains(tx)`）。Go 编译器对未使用的函数参数不报错（仅未使用的局部变量与 import 报错），故无需特殊处理。

- [ ] **Step 3: 简化 `repository/asset.go` 的 tag 过滤**

对 `$TGT/repository/asset.go` 的 `assetJSONTagsContains`（约 118 行）做同样处理（签名 `func assetJSONTagsContains(tx *gorm.DB) string`，调用处 `condition.Or(assetJSONTagsContains(tx), tag)`）：

```go
// assetJSONTagsContains 返回素材 tags 的 JSON 包含条件（PostgreSQL）。
func assetJSONTagsContains(tx *gorm.DB) string {
	return "jsonb_exists(tags::jsonb, ?)"
}
```

- [ ] **Step 4: 构建验证**

```bash
go build ./...
```
Expected: 无报错。

- [ ] **Step 5: 提交**

```bash
git add handler/media_reference.go repository/prompt.go repository/asset.go
git commit -m "refactor(backend): postgres-only tag filters and reference data dir"
```

---

## Task 4: settings.go 三拆（机械重构，不改行为）

**目标**：把 `service/settings.go`（约 400 行）拆为 `settings.go` + `channel.go` + `channel_admin.go`，仅移动函数、改 import，不改行为。为 Task 6 的 Gemini 分支铺垫。

**Files:**
- Modify: `$TGT/service/settings.go`（瘦身，仅留设置 CRUD + 规范化 + 密钥脱敏）
- Create: `$TGT/service/channel.go`（渠道选择 + URL 构造 + 模型分类）
- Create: `$TGT/service/channel_admin.go`（后台渠道测试/列模型 + 上游错误规范化）

**Interfaces:**
- Consumes: Task 1-3 的 `service/settings.go`
- Produces: 三个文件，导出符号不变（`PublicSettings`、`AdminSettings`、`SaveSettings`、`ModelCost`、`SelectModelChannel`、`BuildModelChannelURL`、`AdminChannelModels`、`AdminTestChannelModel` 等）。`handler/*.go` 与 `router/*.go` 不受影响（包名仍是 `service`）。

- [ ] **Step 1: 创建 `service/channel.go`**

从 `$SRC/service/settings.go` 复制以下函数到新文件 `$TGT/service/channel.go`，加 `package service` 头与必要 import：`SelectModelChannel`、`BuildModelChannelURL`、`normalizeModelChannelBaseURL`、`modelChannelsForModel`、`enabledChannelModels`、`uniqueModelNames`、`repairDefaultModel`、`isVideoModelName`、`isImageModelName`、`isTextModelName`、`normalizeModelChannel`。

`$TGT/service/channel.go` 骨架（函数体从 `$SRC/service/settings.go` 原样复制）：

```go
package service

import (
	"errors"
	"math/rand"
	"net/url"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// SelectModelChannel 按模型名筛选启用渠道，按 weight 加权随机选择。
func SelectModelChannel(modelName string) (model.ModelChannel, error) {
	// 从 $SRC/service/settings.go 原样复制函数体
}

// BuildModelChannelURL 构造渠道上游 URL（openai 协议）。
func BuildModelChannelURL(channel model.ModelChannel, path string) string {
	// 原样复制
}

// normalizeModelChannelBaseURL、modelChannelsForModel、enabledChannelModels、
// uniqueModelNames、repairDefaultModel、isVideoModelName、isImageModelName、
// isTextModelName、normalizeModelChannel —— 全部原样复制
```

复制完后，确认 import 仅含实际用到的（`errors`、`math/rand`、`net/url`、`strings`、`model`、`repository`）。`SelectModelChannel` 用 `repository.GetSettings` + `rand.Intn` + `errors.New`；`BuildModelChannelURL` 用 `url.Parse` + `strings`。

- [ ] **Step 2: 创建 `service/channel_admin.go`**

从 `$SRC/service/settings.go` 复制以下函数到新文件 `$TGT/service/channel_admin.go`：`AdminChannelModels`、`AdminTestChannelModel`、`resolveAdminChannel`、`fetchAdminChannelModels`、`testAdminChannelModel`、`testArkSeedanceChannelModel`、`readAdminChannelError`、`isArkAgentPlanChannel`、`isSeedanceModelName`、`adminModelHTTPClient`、`safeMessageError`（含其方法 `Error()`、`SafeMessage()`）。

`$TGT/service/channel_admin.go` 骨架：

```go
package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

var adminModelHTTPClient = &http.Client{Timeout: 30 * time.Second}

// AdminChannelModels、AdminTestChannelModel、resolveAdminChannel、
// fetchAdminChannelModels、testAdminChannelModel、testArkSeedanceChannelModel、
// readAdminChannelError、isArkAgentPlanChannel、isSeedanceModelName —— 原样复制

type safeMessageError struct {
	message string
}

func (err safeMessageError) Error() string     { return err.message }
func (err safeMessageError) SafeMessage() string { return err.message }
```

确认 import：`encoding/json`、`errors`、`fmt`、`io`、`net/http`、`sort`、`strings`、`time`、`model`、`repository`。`fetchAdminChannelModels` 用 `json.Unmarshal` + `sort.Strings`；`testAdminChannelModel` 用 `json.Marshal`；`readAdminChannelError` 用 `fmt.Sprintf`。

- [ ] **Step 3: 瘦身 `service/settings.go`**

从 `$TGT/service/settings.go` **删除**已在 Step 1/2 移到 `channel.go`/`channel_admin.go` 的所有函数，只保留：`PublicSettings`、`AdminSettings`、`SaveSettings`、`normalizeSettings`、`normalizePublicSetting`、`normalizePublicSettingWithChannels`、`normalizePrivateSetting`、`normalizePromptSyncSetting`（若存在）、`hidePrivateAPIKeys`、`keepPrivateAPIKeys`、`keepPrivateAuthSecrets`、`findSavedChannel`、`ModelCost`。

`$TGT/service/settings.go` 头部 import 应精简为实际用到（通常 `encoding/json`、`errors`、`strings`、`model`、`repository`）。`SaveSettings` 调用 `RefreshPromptSyncScheduler`（来自 `prompt_sync_scheduler.go`，同包，无需 import）。

- [ ] **Step 4: 构建验证**

```bash
go build ./...
```
Expected: 无报错。若有 "function redeclared" → 某函数在两处都留了，删除多余的那处。若有 "undefined" → 某函数漏复制，从 `$SRC/service/settings.go` 补到对应新文件。

- [ ] **Step 5: 提交**

```bash
git add service/settings.go service/channel.go service/channel_admin.go
git commit -m "refactor(backend): split settings.go into settings + channel + channel_admin"
```

---

## Task 5: 抽出 service/ai_proxy.go（机械重构，不改行为）

**目标**：从 `handler/ai.go` 抽出协议分发与上游请求构造到 `service/ai_proxy.go`。本任务**先做 openai-only 的机械抽取**（保持行为不变），Gemini 分支在 Task 6 加。`handler/ai.go` 只剩 HTTP 粘合。

**Files:**
- Create: `$TGT/service/ai_proxy.go`（`ProxyAIRequest`、`ProxyAIGetRequest`、`resolveUpstreamRequest`（openai-only）、`buildOpenAIUpstream`、`resolveAIProxyPath`、`isArkSeedanceVideo`，以及从 handler 移过来的 `proxyCopyAIResponse`、`readAIRequest`、`readMultipartModel`、`readAIRequestCount`、`proxyAIUpstreamStatusMessage`、`aiStatusMessage`、`proxyAIUpstreamErrorDetail`、`friendlyUpstreamError`、`safeUpstreamText`、`aiError`、`errMissingModel`、`proxyAILogf`、`proxyFail`、`proxyFailError`）
- Modify: `$TGT/handler/ai.go`（整体替换为薄包装，仅保留 `AIImagesGenerations`/`AIImagesEdits`/`AIChatCompletions`/`AIAudioSpeech`/`AIVideos`/`AIVideo`/`AIVideoContent` 七个 handler 函数，调用 `service.ProxyAIRequest`/`service.ProxyAIGetRequest`）

**Interfaces:**
- Consumes: Task 4 的 `service/channel.go`（`SelectModelChannel`、`BuildModelChannelURL`）、`service/settings.go`（`ModelCost`）、`service/auth.go`（`UserFromContext`、`ConsumeUserCredits`、`RefundUserCredits`）
- Produces: `service.ProxyAIRequest(w http.ResponseWriter, r *http.Request, path string)` 与 `service.ProxyAIGetRequest(w http.ResponseWriter, r *http.Request, path string)` —— `handler/ai.go` 的 `proxyAIRequest`/`proxyAIGetRequest` 改为调用这两个。

- [ ] **Step 1: 创建 `service/ai_proxy.go`（openai-only，机械抽取）**

`$TGT/service/ai_proxy.go`：

```go
package service

import (
	"bytes"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
)

// ProxyAIRequest 处理 POST 类 AI 代理请求：选渠道、扣算力点、转发上游、失败返还。
func ProxyAIRequest(w http.ResponseWriter, r *http.Request, path string) {
	body, contentType, modelName, err := readAIRequest(r)
	if err != nil {
		proxyAILogf("AI proxy request read failed: %v", err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	user, ok := UserFromContext(r.Context())
	if !ok {
		proxyFail(w, "未登录或权限不足")
		return
	}
	credits, err := ModelCost(modelName)
	if err != nil {
		proxyAILogf("AI proxy read model cost failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	credits *= readAIRequestCount(body, contentType)
	channel, err := SelectModelChannel(modelName)
	if err != nil {
		proxyAILogf("AI proxy select channel failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	resolved := resolveUpstreamRequest(channel, modelName, path, body, contentType)
	request, err := http.NewRequest(http.MethodPost, resolved.URL, bytes.NewReader(body))
	if err != nil {
		proxyAILogf("AI proxy build request failed: url=%s err=%v", resolved.URL, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	for key, values := range resolved.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	if err := ConsumeUserCredits(user.ID, modelName, credits, path); err != nil {
		proxyFailError(w, err)
		return
	}
	proxyCopyAIResponse(w, request, func() {
		if err := RefundUserCredits(user.ID, modelName, credits, path); err != nil {
			proxyAILogf("AI proxy refund credits failed: user=%s model=%s credits=%d err=%v", user.ID, modelName, credits, err)
		}
	})
}

// ProxyAIGetRequest 处理 GET 类 AI 代理请求（视频查询/内容）。
func ProxyAIGetRequest(w http.ResponseWriter, r *http.Request, path string) {
	modelName := r.URL.Query().Get("model")
	if strings.TrimSpace(modelName) == "" {
		modelName = "grok-imagine-video"
	}
	channel, err := SelectModelChannel(modelName)
	if err != nil {
		proxyAILogf("AI proxy select channel failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	resolved := resolveUpstreamRequest(channel, modelName, path, nil, "")
	request, err := http.NewRequest(http.MethodGet, resolved.URL, nil)
	if err != nil {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	for key, values := range resolved.Headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	proxyCopyAIResponse(w, request, nil)
}

type upstreamRequest struct {
	URL     string
	Headers http.Header
	Body    []byte
}

// resolveUpstreamRequest 按渠道协议构造上游请求（本任务仅 openai）。
func resolveUpstreamRequest(channel model.ModelChannel, modelName, path string, body []byte, contentType string) upstreamRequest {
	return buildOpenAIUpstream(channel, modelName, path, body, contentType)
}

func buildOpenAIUpstream(channel model.ModelChannel, modelName, path string, body []byte, contentType string) upstreamRequest {
	path = resolveAIProxyPath(channel.BaseURL, modelName, path)
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+channel.APIKey)
	if contentType != "" {
		headers.Set("Content-Type", contentType)
	}
	return upstreamRequest{
		URL:     BuildModelChannelURL(channel, path),
		Headers: headers,
		Body:    body,
	}
}

// resolveAIProxyPath、isArkSeedanceVideo —— 从 $SRC/handler/ai.go 原样复制
```

补 import：`bytes`、`log`、`net/http`、`strings`、`model`。`proxyAILogf`、`proxyFail`、`proxyFailError`、`proxyCopyAIResponse`、`readAIRequest`、`readAIRequestCount` 是从 `handler/ai.go` 移过来的辅助（见 Step 2）。

`resolveAIProxyPath` 与 `isArkSeedanceVideo` 从 `$SRC/handler/ai.go` 原样复制到 `service/ai_proxy.go`。

- [ ] **Step 2: 把 HTTP 粘合辅助移到 service 层**

`copyAIResponse`、`readAIRequest`、`readMultipartModel`、`readAIRequestCount`、`aiUpstreamStatusMessage`、`aiStatusMessage`、`aiUpstreamErrorDetail`、`friendlyUpstreamError`、`safeUpstreamText`、`aiError`、`errMissingModel` 从 `$TGT/handler/ai.go` 移到 `$TGT/service/ai_proxy.go`，并**改名加 `proxy` 前缀**以避免与 handler 包同名冲突且语义清晰：

- `copyAIResponse` → `proxyCopyAIResponse`
- `readAIRequest` → 保持 `readAIRequest`（仅 service 包内用，无需前缀）
- `readMultipartModel` → 保持
- `readAIRequestCount` → 保持
- `aiUpstreamStatusMessage` → `proxyAIUpstreamStatusMessage`
- `aiStatusMessage` → 保持（包内）
- `aiUpstreamErrorDetail` → `proxyAIUpstreamErrorDetail`
- `friendlyUpstreamError` → 保持
- `safeUpstreamText` → 保持
- `aiError` → 保持
- `errMissingModel` → 保持

新增辅助：

```go
func proxyAILogf(format string, args ...any) {
	log.Printf(format, args...)
}

func proxyFail(w http.ResponseWriter, msg string) {
	// 复用 handler.Fail 的逻辑，但 service 包不能 import handler（会循环）。
	// 直接写 {code:1, data:nil, msg} JSON，HTTP 200。
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "data": nil, "msg": msg})
}

func proxyFailError(w http.ResponseWriter, err error) {
	msg := "操作失败"
	if se, ok := err.(interface{ SafeMessage() string }); ok && se.SafeMessage() != "" {
		msg = se.SafeMessage()
	}
	log.Printf("AI proxy error: %v", err)
	proxyFail(w, msg)
}
```

`proxyCopyAIResponse` = 原 `copyAIResponse` 函数体（把 `Fail(w, ...)` 调用改为 `proxyFail(w, ...)`，把 `aiUpstreamStatusMessage` 改为 `proxyAIUpstreamStatusMessage`）。函数体其余不变（读上游、流回、失败调 `onFailure`）。

补 import：`encoding/json`、`io`、`log`、`mime`、`mime/multipart`、`net/http`、`strings`、`fmt`、`bytes`、`model`。

- [ ] **Step 3: 改写 `handler/ai.go` 为薄包装**

`$TGT/handler/ai.go` 整体替换为：

```go
package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

func AIImagesGenerations(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/images/generations")
}

func AIImagesEdits(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/images/edits")
}

func AIChatCompletions(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/chat/completions")
}

func AIAudioSpeech(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/audio/speech")
}

func AIVideos(w http.ResponseWriter, r *http.Request) {
	service.ProxyAIRequest(w, r, "/videos")
}

func AIVideo(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyAIGetRequest(w, r, "/videos/"+id)
}

func AIVideoContent(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyAIGetRequest(w, r, "/videos/"+id+"/content")
}
```

`router/router.go` 已用 `gin.WrapF(handler.AIImagesGenerations)` 等 —— 这些 handler 函数签名不变，router 无需改动。

- [ ] **Step 4: 构建验证**

```bash
go build ./...
```
Expected: 无报错。若有 "undefined: copyAIResponse" 等 → 该辅助没移到 service 或 handler 仍引用旧名，按 Step 2 改名映射修正。

- [ ] **Step 5: 提交**

```bash
git add service/ai_proxy.go handler/ai.go
git commit -m "refactor(backend): extract ai_proxy.go from handler/ai.go (openai-only, behavior unchanged)"
```

---

## Task 6: Gemini 协议支持（AI 代理 + channel）

**目标**：扩展 `service/ai_proxy.go` 与 `service/channel.go` 支持 `protocol: "gemini"`。后端按渠道 `Protocol` 构造 Gemini 上游 URL（`:generateContent?key=`，无 Bearer），请求体原样透传。`ModelChannel.Protocol` 语义扩展为接受 `"gemini"`。

**Files:**
- Modify: `$TGT/service/ai_proxy.go`（`resolveUpstreamRequest` 加 gemini 分支；新增 `buildGeminiUpstream`、`geminiActionFor`、`isGeminiStream`）
- Modify: `$TGT/service/channel.go`（`normalizeModelChannel` 的 `Protocol` 默认仍 `"openai"`，但接受 `"gemini"`；无需大改，仅确认规范化不覆盖合法 gemini 值）
- Modify: `$TGT/service/settings.go`（`normalizePrivateSetting` 中 `Protocol` 规范化同上）
- Modify: `$TGT/model/setting.go`（给 `ModelChannel` 的 `Protocol` 字段加注释说明取值，可选）

**Interfaces:**
- Consumes: Task 5 的 `resolveUpstreamRequest`、`buildOpenAIUpstream`；`model.ModelChannel.Protocol`
- Produces: `resolveUpstreamRequest` 按 `channel.Protocol` 分发；gemini 渠道走 `buildGeminiUpstream`。前端 remote 模式仍 POST 到 `/api/v1/*`，后端按选中渠道协议重写。

**关于算力点 `remark`（规格 3.1 第 5 点）**：0.3.0 的 `service.ConsumeUserCredits`（Task 1 移植，1:1 不改）已写 `Remark: "调用模型 " + modelName`，`RefundUserCredits` 写 `"模型调用失败返还 " + modelName`。Web Agent Loop（online canvas-agent）与普通图像调用经同一 `ProxyAIRequest` → `ConsumeUserCredits`，remark 按 modelName 自然区分（agent 用文本模型名，图像用图像模型名）。**无需新增 remark 逻辑** —— 本任务不动 `service/auth.go` 的 credits 函数。

- [ ] **Step 1: 写 Gemini 上游构造的失败测试**

在 `$TGT/service/ai_proxy.go` 同目录新建 `$TGT/service/ai_proxy_test.go`：

```go
package service

import (
	"net/http"
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestBuildGeminiUpstreamURLAndAuth(t *testing.T) {
	channel := model.ModelChannel{Protocol: "gemini", BaseURL: "https://generativelanguage.googleapis.com", APIKey: "secret-key", Models: []string{"gemini-2.5-flash"}}
	body := []byte(`{"model":"gemini-2.5-flash","stream":true,"contents":[{"parts":[{"text":"hi"}]}]}`)
	got := resolveUpstreamRequest(channel, "gemini-2.5-flash", "/chat/completions", body, "application/json")
	if !strings.HasPrefix(got.URL, "https://generativelanguage.googleapis.com/models/gemini-2.5-flash:streamGenerateContent?alt=sse") {
		t.Fatalf("gemini stream URL = %q", got.URL)
	}
	if !strings.Contains(got.URL, "key=secret-key") {
		t.Fatalf("gemini URL missing key= param: %q", got.URL)
	}
	if got.Headers.Get("Authorization") != "" {
		t.Fatalf("gemini must not set Bearer, got %q", got.Headers.Get("Authorization"))
	}
}

func TestBuildGeminiUpstreamNonStreamImage(t *testing.T) {
	channel := model.ModelChannel{Protocol: "gemini", BaseURL: "https://generativelanguage.googleapis.com", APIKey: "k", Models: []string{"gemini-2.5-flash-image"}}
	body := []byte(`{"model":"gemini-2.5-flash-image","contents":[{"parts":[{"text":"a cat"}]}]}`)
	got := resolveUpstreamRequest(channel, "gemini-2.5-flash-image", "/images/generations", body, "application/json")
	if !strings.Contains(got.URL, ":generateContent") || strings.Contains(got.URL, "streamGenerateContent") {
		t.Fatalf("gemini image URL = %q", got.URL)
	}
}

func TestBuildOpenAIUpstreamStillBearer(t *testing.T) {
	channel := model.ModelChannel{Protocol: "openai", BaseURL: "https://api.openai.com", APIKey: "sk-x", Models: []string{"gpt-5.5"}}
	got := resolveUpstreamRequest(channel, "gpt-5.5", "/chat/completions", []byte(`{}`), "application/json")
	if !strings.HasPrefix(got.URL, "https://api.openai.com/v1/chat/completions") {
		t.Fatalf("openai URL = %q", got.URL)
	}
	if got.Headers.Get("Authorization") != "Bearer sk-x" {
		t.Fatalf("openai Bearer = %q", got.Headers.Get("Authorization"))
	}
}

func TestGeminiUnsupportedPathsError(t *testing.T) {
	channel := model.ModelChannel{Protocol: "gemini", BaseURL: "https://x", APIKey: "k", Models: []string{"m"}}
	_, err := geminiActionFor("/audio/speech")
	if err == nil {
		t.Fatal("expected error for gemini /audio/speech")
	}
	_, err = geminiActionFor("/videos")
	if err == nil {
		t.Fatal("expected error for gemini /videos")
	}
	_ = http.Header{} // keep import used if not elsewhere
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
go test ./service/ -run TestBuildGeminiUpstreamURLAndAuth -v
```
Expected: FAIL（`resolveUpstreamRequest` 当前只走 openai，URL 不含 `:streamGenerateContent`）。

- [ ] **Step 3: 实现 Gemini 分支**

在 `$TGT/service/ai_proxy.go` 替换 `resolveUpstreamRequest` 并新增 `buildGeminiUpstream`、`geminiActionFor`、`isGeminiStream`：

```go
func resolveUpstreamRequest(channel model.ModelChannel, modelName, path string, body []byte, contentType string) upstreamRequest {
	if channel.Protocol == "gemini" {
		return buildGeminiUpstream(channel, modelName, path, body)
	}
	return buildOpenAIUpstream(channel, modelName, path, body, contentType)
}

func buildGeminiUpstream(channel model.ModelChannel, modelName, path string, body []byte) upstreamRequest {
	action, err := geminiActionFor(path)
	if err != nil {
		// 不支持的路径：构造一个必定失败的上游 URL，让 proxyCopyAIResponse 走错误路径。
		// 这里用空 URL + 标记，由调用前的校验抛 proxyFail。简化：直接 panic 不合适，
		// 改为返回带 error 的形式 —— 见下方说明。
	}
	stream := isGeminiStream(path, body)
	if stream {
		action = "streamGenerateContent"
	}
	baseURL := strings.TrimRight(strings.TrimSpace(channel.BaseURL), "/")
	url := fmt.Sprintf("%s/models/%s:%s?key=%s", baseURL, modelName, action, url.QueryEscape(channel.APIKey))
	if stream {
		url += "&alt=sse"
	}
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")
	return upstreamRequest{URL: url, Headers: headers, Body: body}
}

// geminiActionFor 把 /api/v1/* 路径映射到 Gemini action。不支持返回 error。
func geminiActionFor(path string) (string, error) {
	switch path {
	case "/chat/completions", "/images/generations", "/images/edits":
		return "generateContent", nil
	case "/audio/speech", "/videos":
		return "", fmt.Errorf("Gemini 协议不支持 %s", path)
	default:
		if strings.HasPrefix(path, "/videos/") {
			return "", fmt.Errorf("Gemini 协议不支持 %s", path)
		}
		return "generateContent", nil
	}
}

// isGeminiStream 仅对 /chat/completions 检测请求体 stream 字段。
func isGeminiStream(path string, body []byte) bool {
	if path != "/chat/completions" {
		return false
	}
	var payload struct {
		Stream bool `json:"stream"`
	}
	_ = json.Unmarshal(body, &payload)
	return payload.Stream
}
```

**处理 `geminiActionFor` 返回 error 的情况**：`buildGeminiUpstream` 内若 `geminiActionFor` 报错，应让请求失败而非发往上游。改 `buildGeminiUpstream` 在 err 时返回一个 `upstreamRequest`，其 `URL` 为空字符串，并在 `ProxyAIRequest`/`ProxyAIGetRequest` 中校验：若 `resolved.URL == ""` → `proxyFail(w, "AI 接口请求失败")` 并 return（在扣算力点之前）。

更新 `ProxyAIRequest`：在 `resolved := resolveUpstreamRequest(...)` 之后、`http.NewRequest` 之前加：

```go
if resolved.URL == "" {
	proxyFail(w, "AI 接口请求失败")
	return
}
```

更新 `ProxyAIGetRequest` 同样加该校验。

补 import：`fmt`、`net/url`、`encoding/json`（若尚未在 ai_proxy.go）。

- [ ] **Step 4: 确认 `Protocol` 规范化接受 gemini**

打开 `$TGT/service/channel.go` 的 `normalizeModelChannel`，确认：

```go
if channel.Protocol == "" {
	channel.Protocol = "openai"
}
```
**保持不变**（空才默认 openai，非空的 `"gemini"` 不会被覆盖）。同理 `$TGT/service/settings.go` 的 `normalizePrivateSetting` 中：

```go
if setting.Channels[i].Protocol == "" {
	setting.Channels[i].Protocol = "openai"
}
```
**保持不变**。这两处已是正确行为，无需修改 —— 本步骤仅"确认"。

- [ ] **Step 5: 给 `model.ModelChannel.Protocol` 加取值注释**

`$TGT/model/setting.go`，在 `ModelChannel` 的 `Protocol` 字段加注释：

```go
// ModelChannel 模型渠道配置。
type ModelChannel struct {
	// Protocol 渠道协议：openai（默认）或 gemini。决定后端 AI 代理构造上游 URL 与鉴权方式。
	Protocol string   `json:"protocol"`
	Name     string   `json:"name"`
	// ... 其余字段不变
```

- [ ] **Step 6: Gemini 上游 URL 日志脱敏**

规格 §8.1 要求：Gemini 上游 URL 含 `?key={apiKey}`，错误日志不得泄漏 key。`service/ai_proxy.go` 的 `proxyCopyAIResponse` 在请求失败时会 `log.Printf("AI proxy request failed: url=%s ...", request.URL.String(), ...)` 与 `log.Printf("AI upstream error: url=%s ...", ...)` —— 这两条对 Gemini 会打印 `key=`。

新增脱敏辅助 `redactUpstreamURL`，并在两条日志中改用脱敏后的 URL：

在 `$TGT/service/ai_proxy.go` 加：

```go
// redactUpstreamURL 移除 URL 中的 key= 等敏感查询参数，用于日志。
func redactUpstreamURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	q := parsed.Query()
	q.Del("key")
	parsed.RawQuery = q.Encode()
	return parsed.String()
}
```

把 `proxyCopyAIResponse` 中的两处 `request.URL.String()` 日志改为 `redactUpstreamURL(request.URL.String())`：

```go
log.Printf("AI proxy request failed: url=%s err=%v", redactUpstreamURL(request.URL.String()), err)
// ...
log.Printf("AI upstream error: url=%s status=%d", redactUpstreamURL(request.URL.String()), response.StatusCode)
```

补 import：`net/url`（若 Step 3 已加则无需重复）。

在 `$TGT/service/ai_proxy_test.go` 追加脱敏测试：

```go
func TestRedactUpstreamURLStripsKey(t *testing.T) {
	got := redactUpstreamURL("https://x/models/gemini-2.5-flash:generateContent?key=secret&alt=sse")
	if strings.Contains(got, "secret") {
		t.Fatalf("key not redacted: %q", got)
	}
	if !strings.Contains(got, "alt=sse") {
		t.Fatalf("non-key param lost: %q", got)
	}
}
```

- [ ] **Step 7: 运行测试确认通过**

```bash
go test ./service/ -run "TestBuildGeminiUpstreamURLAndAuth|TestBuildGeminiUpstreamNonStreamImage|TestBuildOpenAIUpstreamStillBearer|TestGeminiUnsupportedPathsError|TestRedactUpstreamURLStripsKey" -v
```
Expected: 全部 PASS。

- [ ] **Step 8: 全量构建与测试**

```bash
go build ./...
go test ./service/ -run "TestBuildGemini|TestBuildOpenAIUpstreamStillBearer|TestGeminiUnsupported|TestRedactUpstream" -v
```
Expected: 构建通过；新测试通过。（`config_test.go`、`media_reference_test.go`、`settings_test.go` 仍在 0.3.0 形态，部分会因 postgres-only 重构失败 —— Task 7 集中修复，本步骤不跑它们。）

- [ ] **Step 9: 提交**

```bash
git add service/ai_proxy.go service/ai_proxy_test.go model/setting.go
git commit -m "feat(backend): support gemini protocol in AI proxy (URL + ?key= auth, pass-through body, redact key in logs)"
```

---

## Task 7: 移植并适配 5 个 Go 测试到 postgres-only

**目标**：0.3.0 的 5 个测试文件已在 Task 1 拷贝过来，但部分因 postgres-only 重构失效。本任务修复它们：删 sqlite 专属测试、适配三拆后的 import、加 Gemini 用例。

**Files:**
- Modify: `$TGT/config/config_test.go`（删两个 `TestNormalizeDockerSQLiteDSN*`，加 postgres DSN 解析测试）
- Modify: `$TGT/handler/media_reference_test.go`（删 `TestReferenceMediaDirUsesAbsoluteSQLiteDataDir`，加 `TestReferenceMediaDirFallsBackToData`）
- Modify: `$TGT/service/settings_test.go`（适配三拆 import；加 Gemini `protocol` 规范化测试）
- Keep: `$TGT/handler/ai_test.go`（1:1，但 `aiUpstreamErrorDetail` 已改名 `proxyAIUpstreamErrorDetail` —— 改测试调用）
- Keep: `$TGT/service/auth_redirect_test.go`（1:1，无需改动）

**Interfaces:**
- Consumes: Task 2-6 的重构结果
- Produces: `go test ./...` 全绿

- [ ] **Step 1: 修复 `config/config_test.go`**

整体替换 `$TGT/config/config_test.go`（删 sqlite 测试，加 postgres DSN 测试）：

```go
package config

import "testing"

func TestLoadDefaultsDatabaseDSN(t *testing.T) {
	Cfg = Config{}
	if err := Load(); err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if Cfg.DatabaseDSN == "" {
		t.Fatal("DatabaseDSN should default to a postgres URL")
	}
	// 默认值应为 postgres URL（不含 StorageDriver）
	if Cfg.DatabaseDSN != "postgres://localhost:5432/infinite-canvas?sslmode=disable" {
		// 若 .env 存在覆盖了默认值，仅校验非空即可
		t.Logf("DatabaseDSN = %q (可能被 .env 覆盖)", Cfg.DatabaseDSN)
	}
}

func TestLoadAutoGeneratesJWTSecret(t *testing.T) {
	Cfg = Config{JWTSecret: "infinite-canvas"}
	_ = Load()
	if Cfg.JWTSecret == "" || Cfg.JWTSecret == "infinite-canvas" {
		t.Fatalf("JWTSecret should be auto-generated, got %q", Cfg.JWTSecret)
	}
}
```

注意：`TestLoadDefaultsDatabaseDSN` 在有 `.env` 的仓库里会被 `.env` 的 `DATABASE_DSN` 覆盖 —— 测试用 `t.Logf` 容忍，仅强校验非空。`Load()` 会读 `.env`，测试中 `Cfg = Config{}` 重置后 `Load` 仍会读 `.env`。这是可接受的（测试不依赖具体值）。

- [ ] **Step 2: 修复 `handler/media_reference_test.go`**

整体替换 `$TGT/handler/media_reference_test.go`（删 sqlite 测试，加 data 兜底测试；保留音频/大小测试）：

```go
package handler

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeReferenceMediaTypeSupportsAudio(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		ext         string
		wantMime    string
		wantExt     string
	}{
		{name: "mp3 mime", contentType: "audio/mpeg", ext: ".bin", wantMime: "audio/mpeg", wantExt: ".mp3"},
		{name: "wav ext fallback", contentType: "application/octet-stream", ext: ".wav", wantMime: "audio/wav", wantExt: ".wav"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mimeType, ext, ok := normalizeReferenceMediaType(tt.contentType, tt.ext)
			if !ok {
				t.Fatal("expected media type to be accepted")
			}
			if mimeType != tt.wantMime || ext != tt.wantExt {
				t.Fatalf("got (%q, %q), want (%q, %q)", mimeType, ext, tt.wantMime, tt.wantExt)
			}
		})
	}
}

func TestReferenceMediaTypeMaxBytes(t *testing.T) {
	if got := referenceMediaTypeMaxBytes("audio/mpeg"); got != referenceAudioMaxBytes {
		t.Fatalf("audio max bytes = %d, want %d", got, referenceAudioMaxBytes)
	}
	if got := referenceMediaTypeMaxBytes("video/mp4"); got != referenceVideoMaxBytes {
		t.Fatalf("video max bytes = %d, want %d", got, referenceVideoMaxBytes)
	}
	if got := referenceMediaTypeMaxBytes("image/png"); got != referenceImageMaxBytes {
		t.Fatalf("image max bytes = %d, want %d", got, referenceImageMaxBytes)
	}
}

func TestReferenceMediaDirFallsBackToData(t *testing.T) {
	// postgres-only：referenceDataDir 不再依赖 DSN，只看 /app/data 是否存在，否则 "data"。
	// 测试环境无 /app/data → 期望 "data"。
	if _, err := os.Stat("/app/data"); err == nil {
		t.Skip("/app/data exists in this environment; fallback test not applicable")
	}
	if got := referenceMediaDir(); got != filepath.Join("data", "reference-media") {
		t.Fatalf("referenceMediaDir = %q, want %q", got, filepath.Join("data", "reference-media"))
	}
}
```

注意：`referenceMediaTypeMaxBytes`、`referenceAudioMaxBytes` 等是 `media_reference.go` 内的函数/常量，0.3.0 已有，Task 1 拷贝时已带。`os` import 重新需要。

- [ ] **Step 3: 修复 `handler/ai_test.go`（改名调用）**

`aiUpstreamErrorDetail` 已在 Task 5 改名为 `proxyAIUpstreamErrorDetail` 并移到 `service` 包。但 `handler/ai_test.go` 在 `handler` 包，无法直接调 `service.proxyAIUpstreamErrorDetail`（小写未导出）。

**解决方案**：把 `handler/ai_test.go` 的 3 个测试移到 `service/ai_proxy_test.go`（Task 6 已建此文件），调用 `proxyAIUpstreamErrorDetail` 与 `safeUpstreamText`。删除 `$TGT/handler/ai_test.go`。

在 `$TGT/service/ai_proxy_test.go` 末尾追加：

```go
func TestAIUpstreamErrorDetail(t *testing.T) {
	got := proxyAIUpstreamErrorDetail([]byte(`{"error":{"code":"InvalidParameter","message":"reference video fps is invalid"}}`))
	if got != "InvalidParameter reference video fps is invalid" {
		t.Fatalf("detail = %q", got)
	}
}

func TestAIUpstreamErrorDetailExplainsSensitiveVideo(t *testing.T) {
	got := proxyAIUpstreamErrorDetail([]byte(`{"error":{"code":"InputVideoSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input video may contain real person."}}`))
	if !strings.Contains(got, "参考视频疑似包含真人") || !strings.Contains(got, "asset://") {
		t.Fatalf("detail = %q", got)
	}
}

func TestSafeUpstreamTextTruncates(t *testing.T) {
	got := safeUpstreamText(strings.Repeat("错", 320))
	if len([]rune(got)) != 303 {
		t.Fatalf("truncated rune length = %d", len([]rune(got)))
	}
}
```

确保 `$TGT/service/ai_proxy_test.go` 顶部 import 含 `strings`、`testing`（Task 6 已有）。

删除 `$TGT/handler/ai_test.go`：

```bash
rm handler/ai_test.go
```

- [ ] **Step 4: 适配 `service/settings_test.go`（三拆 import + Gemini 规范化）**

`settings_test.go` 调用的 `fetchAdminChannelModels`、`BuildModelChannelURL`、`normalizeSettings` 现分别在 `channel_admin.go`、`channel.go`、`settings.go`，但**同包**（`service`），测试 import 不变（仍 `package service`，无需 import 子文件）。原测试应直接通过。

在 `$TGT/service/settings_test.go` 末尾追加 Gemini 规范化测试：

```go
func TestNormalizePrivateSettingAcceptsGeminiProtocol(t *testing.T) {
	got := normalizePrivateSetting(model.PrivateSetting{
		Channels: []model.ModelChannel{
			{Protocol: "gemini", Name: "g", BaseURL: "https://x", APIKey: "k", Models: []string{"gemini-2.5-flash"}},
			{Protocol: "", Name: "o", BaseURL: "https://y", APIKey: "k", Models: []string{"gpt-5.5"}},
		},
	})
	if got.Channels[0].Protocol != "gemini" {
		t.Fatalf("gemini protocol should be preserved, got %q", got.Channels[0].Protocol)
	}
	if got.Channels[1].Protocol != "openai" {
		t.Fatalf("empty protocol should default to openai, got %q", got.Channels[1].Protocol)
	}
}
```

确认 `settings_test.go` 顶部 import 已含 `model`（原测试已 import）。

- [ ] **Step 5: `auth_redirect_test.go` 确认无需改动**

```bash
grep -c "safeRedirectPath\|decodeState" service/auth_redirect_test.go
```
Expected: ≥2（测试仍在，调用未改名的 `service` 包内函数）。无需修改。

- [ ] **Step 6: 运行全部 Go 测试**

```bash
go test ./... -v 2>&1 | tail -40
```
Expected: 全部 PASS（`config`、`handler`、`service` 三个测试包；`repository`/`model`/`router`/`middleware` 无测试文件则 "no test files"）。

若有失败：
- `undefined: proxyAIUpstreamErrorDetail` → Step 3 漏移或改名不一致，核对 Task 5 Step 2 的改名映射。
- `StorageDriver` 相关 → Task 2 漏改某处引用，`grep -rn "StorageDriver" .` 排查。

- [ ] **Step 7: 提交**

```bash
git add config/config_test.go handler/media_reference_test.go service/ai_proxy_test.go service/settings_test.go
git rm handler/ai_test.go
git commit -m "test(backend): adapt ported tests to postgres-only and gemini protocol"
```

---

## Task 8: 前端 — 拉回 catch-all 代理与 request.ts 封装客户端

**目标**：从 0.3.0 拉回 catch-all 代理路由与完整的 `request.ts`（`apiGet`/`apiPost`/`apiDelete`/`apiRequest` 封装 `{code,data,msg}`）。目标现有 `request.ts` 是瘦版（仅 `compactApiParams`/`serializeApiParams`），恢复完整版不破坏现有 `image.ts`/`video.ts`/`audio.ts`/`prompts.ts`（它们不 import `apiGet`）。

**Files:**
- Create: `$TGT/web/src/app/api/[...path]/route.ts`（从 `$SRC` 复制）
- Modify: `$TGT/web/src/services/api/request.ts`（补回 `apiGet`/`apiPost`/`apiDelete`/`apiRequest`/`ApiResponse`，保留现有 `compactApiParams`/`serializeApiParams`）
- Modify: `$TGT/web/package.json`（dev 脚本 `-p 3001` → `-p 3000`）

**Interfaces:**
- Consumes: 无（前端起始任务）
- Produces: `/api/*` 代理到 `API_BASE_URL`（默认 `http://127.0.0.1:8088`）；`apiGet<T>(url, params?, token?)`、`apiPost<T>(url, body?, token?)`、`apiDelete<T>(url, token?)` 供 Task 9-10 的 auth/admin/assets 客户端使用。

- [ ] **Step 1: 拉回 catch-all 代理路由**

```bash
mkdir -p "web/src/app/api/[...path]"
cp "/Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/app/api/[...path]/route.ts" "web/src/app/api/[...path]/route.ts"
```

验证内容（应与 0.3.0 一致，`API_BASE_URL` 默认 `http://127.0.0.1:8088`，代理 GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS）：

```bash
grep "API_BASE_URL\|127.0.0.1:8088" "web/src/app/api/[...path]/route.ts"
```
Expected: 命中 `process.env.API_BASE_URL || "http://127.0.0.1:8088"`。

- [ ] **Step 2: 移除目标的内存提示词路由**

```bash
rm -rf web/src/app/api/prompts
```
（迁移后提示词统一走后端 `/api/prompts`，避免双来源不一致 —— 见规格 6.3 第 4 点）

- [ ] **Step 3: 补全 `request.ts` 封装客户端**

把 `$TGT/web/src/services/api/request.ts` 整体替换为（保留现有两个函数，补回封装客户端）：

```ts
import axios from "axios";

export type ApiParams = Record<string, string | string[] | number | number[] | undefined>;

type ApiResponse<T> = {
    code: number;
    data: T;
    msg: string;
};

export function compactApiParams(params: ApiParams) {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value !== undefined && (!Array.isArray(value) || value.length > 0))) as ApiParams;
}

export function serializeApiParams(params?: ApiParams) {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((item) => queryParams.append(key, String(item)));
        else queryParams.set(key, String(value));
    }
    return queryParams;
}

export async function apiGet<T>(url: string, params?: ApiParams, token?: string) {
    return apiRequest<T>({
        url,
        method: "GET",
        params: params || undefined,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
}

export async function apiPost<T>(url: string, body?: unknown, token?: string) {
    return apiRequest<T>({
        url,
        method: "POST",
        data: body ?? {},
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
}

export async function apiDelete<T>(url: string, token?: string) {
    return apiRequest<T>({
        url,
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
}

async function apiRequest<T>(config: { url: string; method: "GET" | "POST" | "DELETE"; params?: ApiParams; data?: unknown; headers?: Record<string, string> }) {
    let response;
    try {
        response = await axios.request<ApiResponse<T>>({
            url: config.url,
            method: config.method,
            params: config.params,
            paramsSerializer: { serialize: (params) => serializeApiParams(params as ApiParams).toString() },
            data: config.data,
            headers: config.headers,
            validateStatus: () => true,
        });
    } catch {
        throw new Error("接口连接失败，请确认后端服务已启动");
    }

    const result = response.data;
    if (!result || typeof result !== "object") {
        throw new Error(response.status === 404 ? "接口不存在，请确认后端服务已启动" : "接口返回异常，请稍后重试");
    }

    const payload = result as ApiResponse<T>;
    if (response.status < 200 || response.status >= 300 || payload.code !== 0) {
        throw new Error(payload.msg || "请求失败");
    }

    return payload.data;
}
```

- [ ] **Step 4: dev 脚本端口改回 3000**

编辑 `$TGT/web/package.json`，把 `"dev": "next dev --webpack -H 0.0.0.0 -p 3001"` 改为 `"next dev --webpack -H 0.0.0.0 -p 3000"`。

```bash
grep '"dev"' web/package.json
```
Expected: `"dev": "next dev --webpack -H 0.0.0.0 -p 3000",`

- [ ] **Step 5: 前端类型检查/构建验证**

```bash
cd web && bun run build 2>&1 | tail -20
```
Expected: 构建通过（`next.config.ts` 有 `typescript.ignoreBuildErrors: true`，故类型错误不阻塞，但仍应无运行时 import 错误）。若 `bun` 不可用，用 `npm run build`。

注意：此时 `image.ts`/`video.ts`/`audio.ts`/`prompts.ts` 仍引用旧的 `request.ts` 导出（`compactApiParams`、`apiGet` 等）—— `apiGet` 现已恢复，`compactApiParams` 保留，应无破坏。若 `prompts.ts` 报 `fetchPrompts` 找不到 `/api/prompts` 路由（Step 2 删了内存路由）—— 这是预期的，Task 11 接入后端后恢复。

- [ ] **Step 6: 提交**

```bash
git add "web/src/app/api/[...path]/route.ts" web/src/services/api/request.ts web/package.json
git rm -r web/src/app/api/prompts 2>/dev/null
git commit -m "feat(web): restore catch-all api proxy and request.ts envelope client; drop in-memory prompts route"
```

---

## Task 9: 前端 — 拉回 auth/assets/admin API 客户端

**目标**：从 0.3.0 拉回 `auth.ts`、`assets.ts`、`admin.ts` API 客户端，它们依赖 Task 8 的 `apiGet`/`apiPost`/`apiDelete`。

**Files:**
- Create: `$TGT/web/src/services/api/auth.ts`（从 `$SRC` 复制）
- Create: `$TGT/web/src/services/api/assets.ts`（从 `$SRC` 复制）
- Create: `$TGT/web/src/services/api/admin.ts`（从 `$SRC` 复制）

**Interfaces:**
- Consumes: Task 8 的 `apiGet`/`apiPost`/`apiDelete`/`compactApiParams`
- Produces: `login`/`register`/`fetchCurrentUser`（auth）、`fetchAssetLibrary`（assets）、admin CRUD 函数（admin）—— 供 Task 10 的 store 与 Task 11 的页面使用。导出类型 `AuthUser`、`AuthSession`、`AuthPayload`、`AUTH_TOKEN_KEY`、`AssetLibraryItem`、`AssetLibraryResponse`、`AdminUser` 等。

- [ ] **Step 1: 拉回三个 API 客户端**

```bash
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/services/api/auth.ts web/src/services/api/auth.ts
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/services/api/assets.ts web/src/services/api/assets.ts
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/services/api/admin.ts web/src/services/api/admin.ts
```

- [ ] **Step 2: 验证 import 一致**

```bash
grep -l "apiGet\|apiPost\|apiDelete\|compactApiParams" web/src/services/api/auth.ts web/src/services/api/assets.ts web/src/services/api/admin.ts
```
Expected: 三个文件都命中（它们 import Task 8 的 `request.ts` 导出）。

检查 `admin.ts` 是否 import 了 `prompts.ts` 的类型（0.3.0 的 `admin.ts` 有 `import type { Prompt, PromptListResponse } from "@/services/api/prompts"`）：

```bash
grep "from \"@/services/api/prompts\"" web/src/services/api/admin.ts
```
Expected: 命中。确认 `$TGT/web/src/services/api/prompts.ts` 存在（目标已有，Task 1 前就在）且导出 `Prompt`、`PromptListResponse`。若目标的 `prompts.ts` 导出类型与 0.3.0 不同名，需对齐（见 Step 3）。

- [ ] **Step 3: 对齐 `prompts.ts` 导出类型（若需）**

对比目标的 `prompts.ts` 与 0.3.0 的 `prompts.ts` 导出：

```bash
grep "export" web/src/services/api/prompts.ts | head
grep "export" /Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/services/api/prompts.ts | head
```

若目标的 `prompts.ts` 缺少 `admin.ts` 需要的类型（如 `Prompt`、`PromptListResponse`），从 0.3.0 的 `prompts.ts` 补齐导出（保留目标的 `fetchPrompts` 实现不变，仅补类型导出）。目标的 `prompts.ts` 已有 `Prompt` 与 `PromptListResponse`（见探索阶段的 head 输出），通常无需改动 —— 仅在 `admin.ts` import 报错时补。

- [ ] **Step 4: 前端构建验证**

```bash
cd web && bun run build 2>&1 | tail -20
```
Expected: 构建通过（`ignoreBuildErrors: true` 下类型错误不阻塞；重点确认无 import 路径错误）。

- [ ] **Step 5: 提交**

```bash
git add web/src/services/api/auth.ts web/src/services/api/assets.ts web/src/services/api/admin.ts web/src/services/api/prompts.ts
git commit -m "feat(web): restore auth/assets/admin API clients from 0.3.0"
```

---

## Task 10: 前端 — 拉回完整 user store 并适配更新组件

**目标**：用 0.3.0 的完整 `use-user-store.ts`（token、AuthUser、persist、hydrate/login/register）替换目标的简化 `LocalUser` 版；把目标更新组件中的 `LocalUser` 引用改为 `AuthUser`（超集）。

**Files:**
- Modify: `$TGT/web/src/stores/use-user-store.ts`（替换为 0.3.0 完整版）
- Modify: `$TGT/web/src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx`（`LocalUser` → `AuthUser` 引用）

**Interfaces:**
- Consumes: Task 9 的 `auth.ts`（`AUTH_TOKEN_KEY`、`fetchCurrentUser`、`login`、`register`、`AuthUser`、`AuthPayload`）
- Produces: `useUserStore` 含 `{token, user: AuthUser|null, isReady, isLoading, setSession, clearSession, hydrateUser, login, register}`。`useUserStore.getState().token` 供 `image.ts`/`video.ts`/`audio.ts`/`canvas-assistant-panel.tsx` 使用（已兼容）。

- [ ] **Step 1: 替换 `use-user-store.ts`**

```bash
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/stores/use-user-store.ts web/src/stores/use-user-store.ts
```

验证内容含 `token`、`AuthUser`、`persist`、`hydrateUser`、`login`、`register`：

```bash
grep -c "token\|AuthUser\|hydrateUser\|login\|register\|persist" web/src/stores/use-user-store.ts
```
Expected: ≥6。

- [ ] **Step 2: 找出目标中引用 `LocalUser` 的组件**

```bash
grep -rln "LocalUser" web/src
```
Expected: 列出引用 `LocalUser` 的文件（探索阶段见 `canvas-agent-chat-ui.tsx` 引用 `LocalUser | null`）。

- [ ] **Step 3: 把 `LocalUser` 引用改为 `AuthUser`**

对每个引用 `LocalUser` 的文件，把 import 与类型引用从 `LocalUser` 改为 `AuthUser`（来自 `@/services/api/auth`）。例如 `$TGT/web/src/app/(user)/canvas/components/canvas-agent-chat-ui.tsx`：

原：
```ts
import type { LocalUser } from "@/stores/use-user-store";
// ...
user: LocalUser | null;
```
改为：
```ts
import type { AuthUser } from "@/services/api/auth";
// ...
user: AuthUser | null;
```

逐一处理 `grep -rln "LocalUser"` 列出的每个文件。`AuthUser` 是 `LocalUser` 的超集（含 id/username/displayName/avatarUrl + role/credits/createdAt/updatedAt），访问 `user.id`/`user.username` 等仍合法。

- [ ] **Step 4: 确认无残留 `LocalUser`**

```bash
grep -rn "LocalUser" web/src
```
Expected: 无输出（全部改为 `AuthUser`）。

- [ ] **Step 5: 前端构建验证**

```bash
cd web && bun run build 2>&1 | tail -20
```
Expected: 构建通过。

- [ ] **Step 6: 提交**

```bash
git add web/src/stores/use-user-store.ts web/src/app/\(user\)/canvas/components/canvas-agent-chat-ui.tsx
git commit -m "feat(web): restore full use-user-store (token/AuthUser/persist) and adapt LocalUser refs"
```

---

## Task 11: 前端 — 重新启用 channelMode remote + image.ts remote 分支 + 拉回登录/后台/asset 页面

**目标**：移除 `useEffectiveConfig` 中硬编码的 `channelMode: "local"` 强制；恢复 `image.ts` 的 `channelMode === "remote"` → `/api/v1/*` 分支（与 video/audio 一致）；从 0.3.0 拉回登录页、后台页面、asset-library 页面。

**Files:**
- Modify: `$TGT/web/src/stores/use-config-store.ts`（`useEffectiveConfig` 不再强制 `"local"`；normalize 路径不再硬编码 `"local"`）
- Modify: `$TGT/web/src/services/api/image.ts`（`aiApiUrl` 加 `channelMode === "remote"` → `/api/v1*` 分支，与 video/audio 一致）
- Create: `$TGT/web/src/app/(user)/login/`（从 `$SRC` 复制）
- Create: `$TGT/web/src/app/(admin)/`（从 `$SRC` 复制）
- Create: `$TGT/web/src/app/(user)/asset-library/`（从 `$SRC` 复制）

**Interfaces:**
- Consumes: Task 8-10 的 API 客户端与 store
- Produces: 前端可在 `channelMode: "remote"` 下经后端代理调 AI（计费）；登录/注册/Linux.do OAuth 页面可用；后台管理页面可用；asset-library 页面可用。

- [ ] **Step 1: 重新启用 `channelMode` 用户选择**

打开 `$TGT/web/src/stores/use-config-store.ts`，找到 `useEffectiveConfig`：

```ts
export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}
```
改为（不再强制 local，沿用用户配置的 channelMode）：

```ts
export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config }), [config]);
}
```

找到 normalize 路径中硬编码 `channelMode: "local"` 的地方（探索阶段见约 215 行 `channelMode: "local"`）：

```ts
config: {
    ...config,
    channelMode: "local",
    apiFormat: normalizeApiFormat(config.apiFormat),
    // ...
}
```
改为保留持久化的 channelMode（不强制 local）：

```ts
config: {
    ...config,
    channelMode: config.channelMode ?? "local",
    apiFormat: normalizeApiFormat(config.apiFormat),
    // ...
}
```

注意：`defaultConfig` 中 `channelMode: "local"` 保持（默认值仍是 local，用户可切到 remote）。本步骤仅移除"强制覆盖为 local"。

- [ ] **Step 2: 恢复 `image.ts` 的 remote 分支**

打开 `$TGT/web/src/services/api/image.ts`，找到 `aiApiUrl`（约 231 行）：

```ts
function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}
```
改为（与 `video.ts`/`audio.ts` 一致的 remote 分支）：

```ts
function aiApiUrl(config: AiConfig, path: string) {
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}
```

同样检查 `image.ts` 的 `aiHeaders`（若存在）与 `requestImageQuestion`/`requestToolResponse`/`requestGeneration`/`requestEdit` 在 remote 模式下应使用 `useUserStore.getState().token` 作 Bearer。参照 `video.ts` 的 `aiHeaders`：

```ts
function aiHeaders(config: AiConfig, contentType?: string) {
    const token = useUserStore.getState().token;
    return config.channelMode === "remote"
        ? {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(contentType ? { "Content-Type": contentType } : {}),
          }
        : {
              Authorization: `Bearer ${config.apiKey}`,
              ...(contentType ? { "Content-Type": contentType } : {}),
          };
}
```

若 `image.ts` 现有 `aiHeaders` 已是 remote-aware（探索阶段未见明确 remote 分支），按上方模式补齐。确认 `image.ts` 顶部已 `import { useUserStore } from "@/stores/use-user-store"`（应已存在，因 `video.ts`/`audio.ts` 用同样模式）。

注意：Gemini 路径（`requestGeminiImages`/`requestGeminiStreamingResponse`）在 remote 模式下也应走 `/api/v1/*` —— 但 Gemini 的 URL 构造（`:generateContent?key=`）与 openai 不同。**在 remote 模式下，前端把请求 POST 到 `/api/v1/images/generations` 等 openai 形态路径，后端按选中渠道的 `Protocol` 重写为 Gemini 上游**（见规格 5.3）。因此 `image.ts` 的 Gemini 分支（`if (requestConfig.apiFormat === "gemini")`）在 remote 模式下**不应**构造 Gemini URL 直连，而应走 `aiApiUrl(config, "/images/generations")`（即 `/api/v1/images/generations`），把 Gemini 格式请求体透传给后端。

故需调整 `image.ts` 中 Gemini 分支的 remote 处理：在 `requestConfig.apiFormat === "gemini"` 时，若 `config.channelMode === "remote"`，走 `aiApiUrl` + `aiHeaders`（透传 Gemini 请求体到后端），否则走本地 `geminiApiUrl` 直连。具体改法：

对 `requestGeneration`、`requestEdit`、`requestImageQuestion`、`requestToolResponse` 中的 `if (requestConfig.apiFormat === "gemini")` 分支，在最外层加 remote 判断：

```ts
if (requestConfig.apiFormat === "gemini" && requestConfig.channelMode === "remote") {
    // remote: 透传 Gemini 请求体到后端 /api/v1/*（后端按 protocol 重写）
    // 用 toGeminiBody 构造请求体，POST 到 aiApiUrl(config, "/images/generations" 或 "/chat/completions")
    // 鉴权用 aiHeaders（Bearer token）
    // 响应解析同本地 Gemini（contents/parts）
}
```

**实现说明**：这一步较复杂，因需在 remote 模式下用 `aiApiUrl`（`/api/v1/...`）+ `aiHeaders`（Bearer token）发送 `toGeminiBody` 构造的 Gemini 请求体，并按 Gemini 响应结构解析。最简实现：抽一个 `postGeminiViaBackend(config, path, geminiBody)` 辅助，复用 `aiApiUrl`/`aiHeaders`，响应按 `requestGeminiImages`/`requestGeminiStreamingResponse` 的解析逻辑处理。**由于目标的 Gemini 解析逻辑已在 `requestGeminiImages`/`requestGeminiStreamingResponse` 中，且这些函数内部用 `geminiApiUrl`/`geminiHeaders` 直连 —— remote 模式需绕过这两个、改用 `aiApiUrl`/`aiHeaders`。** 实现时把 `requestGeminiImages`/`requestGeminiStreamingResponse` 参数化：接受可选的 url/headers 提供者，remote 模式传入 `aiApiUrl`/`aiHeaders`，local 模式传入 `geminiApiUrl`/`geminiHeaders`。

若此步过于复杂，**最小可通方案**：remote 模式下 Gemini 渠道暂时不支持（前端在 remote + gemini 时提示"请用 local 模式使用 Gemini 渠道"），后续单独补全。**本计划默认采用完整方案**（参数化 url/headers 提供者）；若实现者评估完整方案风险过大，可采用最小方案并在提交信息标注 `TODO: remote+gemini 完整支持`。

- [ ] **Step 3: 拉回登录页**

```bash
cp -R "/Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/app/(user)/login" "web/src/app/(user)/login"
```

验证：

```bash
ls "web/src/app/(user)/login"
```
Expected: 列出登录页文件（page.tsx 等）。

- [ ] **Step 4: 拉回后台页面**

```bash
cp -R "/Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/app/(admin)" "web/src/app/(admin)"
```

验证：

```bash
ls "web/src/app/(admin)"
```
Expected: 列出后台页面目录（users、credit-logs、settings、prompts、assets 等）。

- [ ] **Step 5: 拉回 asset-library 页面**

```bash
cp -R "/Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/app/(user)/asset-library" "web/src/app/(user)/asset-library"
```

验证：

```bash
ls "web/src/app/(user)/asset-library"
```
Expected: 列出 asset-library 页面文件。

- [ ] **Step 6: 接入后台/登录入口（导航/路由守卫）**

检查 0.3.0 如何在布局中接入登录入口与后台导航：

```bash
grep -rln "login\|/admin\|useUserStore" "/Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/components/layout"
```
对比目标的 `web/src/components/layout/`：

```bash
ls web/src/components/layout/
```

把 0.3.0 布局中与登录/后台入口相关的组件（如 `user-status-actions.tsx`、`client-root-init.tsx` 的登录守卫部分）对齐到目标。**关键**：目标的 `user-status-actions.tsx` 与 `client-root-init.tsx` 已存在（更新版），需在其基础上恢复登录/登出入口与未登录跳转 `/login` 逻辑，而非整体覆盖（避免丢失目标更新）。

具体：
- `client-root-init.tsx`：恢复 `useUserStore.persist.onFinishHydration` + `hydrateUser()` 调用，以及未登录访问受保护页时跳转 `/login`（参照 0.3.0 同名文件）。
- `user-status-actions.tsx`：恢复登录/登出按钮、算力点显示、后台入口（admin 角色才显示）。

用 `diff` 对比两版，逐处合并：

```bash
diff "/Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/components/layout/user-status-actions.tsx" web/src/components/layout/user-status-actions.tsx
diff "/Users/eldenpdx/git-project/infinite-canvas-0.3.0/web/src/components/layout/client-root-init.tsx" web/src/components/layout/client-root-init.tsx
```

把 0.3.0 的登录/后台入口逻辑合并进目标的更新版（保留目标的样式与新增功能）。

- [ ] **Step 7: 前端构建验证**

```bash
cd web && bun run build 2>&1 | tail -30
```
Expected: 构建通过。若有 import 错误（如 0.3.0 页面 import 了目标没有的模块），按错误信息补齐或调整。

- [ ] **Step 8: 提交**

```bash
git add web/src/stores/use-config-store.ts web/src/services/api/image.ts "web/src/app/(user)/login" "web/src/app/(admin)" "web/src/app/(user)/asset-library" web/src/components/layout/
git commit -m "feat(web): re-enable channelMode remote, image.ts remote branch, and pull back login/admin/asset-library pages"
```

---

## Task 12: Docker — 开发环境（Dockerfile.dev + docker-compose.local.yml + .air.toml）

**目标**：建立开发多容器：api（air 热重载@8088）+ web（bun HMR@3000）+ postgres。

**Files:**
- Create: `$TGT/Dockerfile.dev`（从 `$SRC` 复制，双 stage api-dev + web-dev）
- Create: `$TGT/.air.toml`（从 `$SRC` 复制）
- Modify: `$TGT/docker-compose.local.yml`（已是 0.3.0 残留，核对与 0.3.0 一致）
- Modify: `$TGT/.dockerignore`（确认排除 web/.next、node_modules、data 等）

**Interfaces:**
- Consumes: Task 1-7 的 Go 源树、Task 8-11 的前端
- Produces: `docker compose -f docker-compose.local.yml up` 起三服务，api@8088 连 postgres，web@3000 代理到 api。

- [ ] **Step 1: 拉回 Dockerfile.dev 与 .air.toml**

```bash
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/Dockerfile.dev .
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/.air.toml .
```

验证 `Dockerfile.dev` 含 api-dev（golang:1.25-alpine + air）与 web-dev（oven/bun:1.3.13）双 stage：

```bash
grep "api-dev\|web-dev\|air\|bun" Dockerfile.dev
```
Expected: 命中 api-dev、web-dev、air、bun。

- [ ] **Step 2: 核对 docker-compose.local.yml**

`$TGT/docker-compose.local.yml` 已是 0.3.0 残留（探索阶段确认内容与 0.3.0 一致）。确认含 postgres、api、web 三服务与 pgdata volume：

```bash
grep -E "postgres:|api:|web:|pgdata|air|API_BASE_URL" docker-compose.local.yml
```
Expected: 命中三服务、pgdata、air、`API_BASE_URL=http://api:8088`。

若与 0.3.0 不一致，用 0.3.0 的覆盖：

```bash
cp /Users/eldenpdx/git-project/infinite-canvas-0.3.0/docker-compose.local.yml .
```

- [ ] **Step 3: 核对 .dockerignore**

```bash
cat .dockerignore
```
确认排除 `.git`、`web/.next`、`web/node_modules`、`data`、`docs/.next` 等。若缺，补齐（参照 0.3.0 的 `.dockerignore`）：

```bash
diff <(cat /Users/eldenpdx/git-project/infinite-canvas-0.3.0/.dockerignore) <(cat .dockerignore)
```
若有差异，按 0.3.0 对齐。

- [ ] **Step 4: 提交**

```bash
git add Dockerfile.dev .air.toml docker-compose.local.yml .dockerignore
git commit -m "build(docker): add dev Dockerfile.dev, .air.toml, and align docker-compose.local.yml"
```

---

## Task 13: Docker — 生产环境（Dockerfile + Dockerfile.api + docker-compose.yml）

**目标**：生产多容器：postgres + api（go 二进制）+ web（node standalone），非 0.3.0 的单镜像。

**Files:**
- Create: `$TGT/Dockerfile.api`（生产 api：go 构建 → 运行二进制）
- Modify: `$TGT/Dockerfile`（生产 web：bun 构建 → node standalone，移除 0.3.0 单镜像里的 Go 构建与联合 CMD）
- Modify: `$TGT/docker-compose.yml`（生产：postgres + api + web 三服务，构建镜像不挂源码）

**Interfaces:**
- Consumes: Task 12 的开发环境结构
- Produces: `docker compose up` 起生产三服务；api 容器跑 go 二进制，web 容器跑 next standalone。

- [ ] **Step 1: 创建生产 Dockerfile.api**

`$TGT/Dockerfile.api`：

```dockerfile
# 构建 Go 后端二进制。
FROM golang:1.25-alpine AS api-build

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY config ./config
COPY handler ./handler
COPY middleware ./middleware
COPY model ./model
COPY repository ./repository
COPY router ./router
COPY service ./service
COPY main.go ./
RUN go build -o /server .

# 运行镜像。
FROM alpine:3.20

RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=api-build /server /app/server
RUN mkdir -p /app/data
ENV PORT=8088
EXPOSE 8088
CMD ["/app/server"]
```

- [ ] **Step 2: 重写生产 Dockerfile（仅 web）**

`$TGT/Dockerfile` 整体替换为（移除 0.3.0 的 Go 构建与联合 CMD，仅 Next.js）：

```dockerfile
# 构建 Next.js 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：Next.js standalone。
FROM node:22-bookworm-slim

WORKDIR /app
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY --from=web-build /app/web/public /app/web/public
COPY --from=web-build /app/web/.next/standalone /app/web
COPY --from=web-build /app/web/.next/static /app/web/.next/static
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

EXPOSE 3000
CMD ["sh", "-c", "cd /app/web && PORT=3000 node server.js"]
```

- [ ] **Step 3: 重写生产 docker-compose.yml（多容器）**

`$TGT/docker-compose.yml` 整体替换为：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-infinite-canvas}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: ${POSTGRES_DB:-infinite-canvas}
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-infinite-canvas} -d ${POSTGRES_DB:-infinite-canvas}"]
      interval: 3s
      retries: 10

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    depends_on:
      postgres:
        condition: service_healthy
    env_file:
      - .env
    environment:
      - PORT=8088
      - DATABASE_DSN=postgresql://${POSTGRES_USER:-infinite-canvas}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-infinite-canvas}?sslmode=disable
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: Dockerfile
    depends_on:
      api:
        condition: service_started
    env_file:
      - .env
    environment:
      - API_BASE_URL=http://api:8088
    ports:
      - "3000:3000"
    restart: unless-stopped

volumes:
  pgdata:
```

注意：生产 postgres 用 `${POSTGRES_PASSWORD:?...}` 强制要求 `.env` 提供密码（非 trust）。`DATABASE_DSN` 在 compose 中用环境变量拼接（覆盖 `.env` 中的本地 DSN）。

- [ ] **Step 4: 验证 compose 配置语法**

```bash
docker compose -f docker-compose.yml config >/dev/null 2>&1 && echo OK || echo FAIL
```
Expected: `OK`（需 `.env` 含 `POSTGRES_PASSWORD`，否则 `:?` 报错 —— 这是预期，证明密码必填）。若报缺 `POSTGRES_PASSWORD`，先在 `.env` 加（Task 14 统一处理 `.env`）。

```bash
docker compose -f docker-compose.local.yml config >/dev/null 2>&1 && echo OK || echo FAIL
```
Expected: `OK`。

- [ ] **Step 5: 提交**

```bash
git add Dockerfile Dockerfile.api docker-compose.yml
git commit -m "build(docker): multi-container prod — separate Dockerfile + Dockerfile.api + compose"
```

---

## Task 14: .env 与 .env.example 对齐 postgres-only

**目标**：`.env` / `.env.example` 移除 `STORAGE_DRIVER`，仅留 `DATABASE_DSN`（postgres URL）；补生产所需 `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`；对齐 `PORT`、`API_BASE_URL`。

**Files:**
- Modify: `$TGT/.env`
- Modify: `$TGT/.env.example`

**Interfaces:**
- Consumes: Task 2（无 `StorageDriver`）、Task 13（生产需 `POSTGRES_PASSWORD`）
- Produces: 环境变量配置正确，开发/生产 compose 可起。

- [ ] **Step 1: 重写 `.env.example`**

`$TGT/.env.example` 整体替换为：

```bash
# 管理员账号，首次启动会自动创建。
ADMIN_USERNAME=admin
ADMIN_PASSWORD=infinite-canvas

# JWT 登录密钥和过期时间，正式部署请修改 JWT_SECRET。
JWT_SECRET=infinite-canvas
JWT_EXPIRE_HOURS=168

# 后端监听端口（Docker 镜像内 api 固定 8088，避免覆盖）。
PORT=8088

# 公开访问地址，用于把本地上传的 Seedance 参考图/视频暴露给火山方舟拉取。
# 线上部署时填写站点根地址，例如：https://your-domain.example.com
# PUBLIC_BASE_URL=https://your-domain.example.com

# 前端开发代理使用 http://api:8088（compose 内）或 http://127.0.0.1:8088（本地）。
API_BASE_URL=http://127.0.0.1:8088
NEXT_PUBLIC_DOC_URL=https://docs.canvas.best

# 数据库（仅 PostgreSQL）。
# 本地开发：DATABASE_DSN=postgresql://user:password@127.0.0.1:5432/infinite-canvas?sslmode=disable
# docker compose 开发：DATABASE_DSN=postgresql://eldenpdx@postgres:5432/infinite-canvas?sslmode=disable
DATABASE_DSN=postgresql://localhost:5432/infinite-canvas?sslmode=disable

# 生产 docker compose 用（POSTGRES_PASSWORD 必填）。
POSTGRES_USER=infinite-canvas
POSTGRES_PASSWORD=
POSTGRES_DB=infinite-canvas
```

- [ ] **Step 2: 对齐 `.env`（本地开发值）**

`$TGT/.env` 调整为（移除 `STORAGE_DRIVER`，保留本地 postgres DSN）：

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
JWT_SECRET=infinite-canvas
JWT_EXPIRE_HOURS=168
PORT=8088
API_BASE_URL=http://127.0.0.1:8088
NEXT_PUBLIC_DOC_URL=https://docs.canvas.best
DATABASE_DSN=postgresql://eldenpdx@127.0.0.1:5432/infinite-canvas?sslmode=disable
POSTGRES_USER=infinite-canvas
POSTGRES_PASSWORD=
POSTGRES_DB=infinite-canvas
```

注意：`.env` 在 `.gitignore` 中通常被忽略 —— 确认：

```bash
grep "^\.env$" .gitignore || grep "\.env" .gitignore
```
若 `.env` 被 gitignore，Step 3 只提交 `.env.example`。若 `.env` 被跟踪（目标仓库 `.env` 当前似乎被跟踪 —— 探索阶段 `ls` 见 `.env`），则一并提交。

- [ ] **Step 3: 提交**

```bash
git add .env.example
git diff --cached --stat .env 2>/dev/null && git add .env 2>/dev/null
git commit -m "chore(env): align .env to postgres-only (drop STORAGE_DRIVER, add POSTGRES_* for prod compose)"
```

---

## Task 15: 收尾 — 移除 Vercel 引用、更新 CHANGELOG、最终验收

**目标**：移除 README/docs 中的 Vercel 引用；更新 CHANGELOG 记录后端迁移；跑完整验收清单。

**Files:**
- Modify: `$TGT/README.md`（移除 Vercel 徽章/段落，更新部署说明为 Docker）
- Modify: `$TGT/docs/content/docs/overview/quick-start.mdx`（移除 Vercel 一键部署引用）
- Modify: `$TGT/docs/content/docs/overview/render.mdx`（标注 Render 暂未适配多容器，待定）
- Modify: `$TGT/CHANGELOG.md`（加 Unreleased 条目）

**Interfaces:**
- Consumes: Task 1-14 全部
- Produces: 文档与部署说明对齐迁移后状态；验收清单通过。

- [ ] **Step 1: 移除 README 中 Vercel 引用**

编辑 `$TGT/README.md`：
- 移除徽章行 `<a href="https://vercel.com/"><img src="...Vercel-ready..."></a>`（约第 9 行）
- 技术栈段落移除 "Vercel 一键部署" / "Vercel 或 Docker" 改为 "Docker"
- "快速开始" 段落移除 "推荐直接导入仓库到 Vercel" 与 `vercel.json` 提及，改为 docker-compose 启动说明（参照 0.3.0 README 的 docker-compose up -d 段落）

```bash
grep -in "vercel" README.md
```
Expected: 无输出（Vercel 引用已移除）。

- [ ] **Step 2: 移除 docs 中 Vercel 引用**

```bash
grep -rln -i "vercel" docs/content 2>/dev/null
```
对列出的文件（`quick-start.mdx` 等），移除 Vercel 一键部署相关段落，改为 Docker 部署说明。

- [ ] **Step 3: 标注 render.mdx 待定**

在 `$TGT/docs/content/docs/overview/render.mdx` 顶部加备注：

```mdx
> ⚠️ 当前版本后端迁移为多容器（api + web + postgres），render.yaml 暂未适配多服务部署，待后续更新。临时请使用 Docker compose 部署。
```

- [ ] **Step 4: 更新 CHANGELOG**

`$TGT/CHANGELOG.md` 的 `## Unreleased` 段落替换/追加为：

```md
## Unreleased

+ [新增] 迁移 0.3.0 完整 Go 后端（认证/算力点/后台/Linux.do OAuth/AI 代理/提示词同步）。
+ [新增] 后端 AI 代理支持 Gemini 协议（`protocol: "gemini"`）。
+ [重构] 后端改为 PostgreSQL-only，移除 sqlite/mysql 驱动与 StorageDriver 配置。
+ [重构] 拆分 settings.go 为 settings + channel + channel_admin；抽出 ai_proxy.go。
+ [新增] Docker 多容器部署（开发 docker-compose.local.yml + 生产 docker-compose.yml，api + web + postgres）。
+ [调整] 前端重新接入认证/后台/remote 模式；移除内存提示词路由与 Vercel 一键部署。
```

- [ ] **Step 5: 后端最终验收**

```bash
go build ./...
go test ./... 2>&1 | tail -20
```
Expected: 构建通过；全部测试 PASS。

- [ ] **Step 6: 前端最终验收**

```bash
cd web && bun run build 2>&1 | tail -20
```
Expected: 构建通过。

- [ ] **Step 7: 开发 compose 集成验收（手动）**

```bash
docker compose -f docker-compose.local.yml up -d --build
```
等三服务起来后，按验收清单手动验证（见规格 8.4）：
1. 浏览器开 `http://localhost:3000`
2. 注册/登录 → 检查 JWT
3. 后台 `/admin/*` → 用户/算力点/设置/渠道/提示词/素材 CRUD
4. 配置一个 openai 渠道 + 一个 gemini 渠道（后台设置）
5. remote 模式 AI 生成（openai 渠道）→ 算力点预扣、失败返还
6. remote 模式 AI 生成（gemini 渠道）→ 正确 `:generateContent?key=`、算力点预扣/返还
7. remote 模式 Web Agent Loop → 算力点预扣
8. 提示词同步调度器 → 查 `docker compose -f docker-compose.local.yml logs api | grep -i sync`
9. local 模式仍工作（切 channelMode local，浏览器直连，不计费）

```bash
docker compose -f docker-compose.local.yml down
```

- [ ] **Step 8: 生产 compose 验证（手动，可选）**

需 `.env` 填 `POSTGRES_PASSWORD`：

```bash
# 临时设密码测试
POSTGRES_PASSWORD=testpass docker compose up -d --build
docker compose ps   # 三服务 healthy/started
docker compose down
```

- [ ] **Step 9: 提交**

```bash
git add README.md docs/content CHANGELOG.md
git commit -m "docs: remove Vercel references, mark render.yaml pending, update changelog for backend migration"
```

- [ ] **Step 10: 最终提交核对**

```bash
git log --oneline -20
git status
```
Expected: 工作区干净（除 `.codegraph/` 等忽略项）；提交历史含本计划各任务提交。

---

## 验收清单（规格 8.4 映射）

| # | 验收项 | 对应任务 |
|---|---|---|
| 1 | 开发 compose 起来 | Task 12, 15-7 |
| 2 | AutoMigrate 创建 5 张表 | Task 2, 15-7 |
| 3 | 默认管理员自动创建 | Task 1（EnsureDefaultAdmin）, 15-7 |
| 4 | 登录/注册/JWT | Task 9, 10, 11, 15-7 |
| 5 | Linux.do OAuth | Task 9, 11（登录页）, 15-7 |
| 6 | 后台 CRUD | Task 9, 11, 15-7 |
| 7 | remote + openai 计费 | Task 5, 8, 11, 15-7 |
| 8 | remote + gemini 计费 | Task 6, 11, 15-7 |
| 9 | remote Web Agent Loop 计费 | Task 11, 15-7 |
| 10 | 提示词同步调度器 | Task 1, 15-7 |
| 11 | local 模式仍工作 | Task 11, 15-7 |
| 12 | 生产 compose 起来 | Task 13, 14, 15-8 |
| 13 | `go test ./...` 通过 | Task 7, 15-5 |
| 14 | `bun run build` 通过 | Task 8-11, 15-6 |

## "迁移完成"定义

- 后端 `go build` + `go test ./...` 通过
- 前端 `bun run build` 通过
- 开发 compose 启动并跑通验收清单全部流程
- 生产 compose 启动
- Gemini 协议路径工作
- 新功能（Web Agent Loop、canvas-agent、Codex 插件）在 remote 模式工作
- Vercel 引用移除
- `render.yaml` 标注为待定
