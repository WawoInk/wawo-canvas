# 视频生成接口对齐 xvanai 标准化入口 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把平台视频生成路由端到端对齐 xvanai 文档的标准化入口 `/api/v1/contents/generations/tasks`（创建/查询/取消/remix 四个路由），仅 Seedance 系，原样透传，复用现有 UserAuth + credits；保留旧 `/api/v1/videos` 不动。

**Architecture:** 后端新增独立 `handler/video_tasks.go`（4 个薄 handler）+ `service/ai_proxy.go` 末尾追加 3 个 proxy 函数（创建+remix 共用带计费的 `proxyVideoTaskPost`，查询复用现有 `ProxyAIGetRequest`，取消新增 `ProxyVideoTaskDelete`）。新路由直接透传上游标准路径 `/contents/generations/tasks...`，靠 `resolveAIProxyPath` 对非 `/videos` 前缀原样返回的天性实现直通——不改动 `resolveAIProxyPath`/`isArkSeedanceVideo`，旧路径零回归。前端仅 `web/src/services/api/video.ts` 的 Seedance 分支：`seedanceApiUrl` 加 channelMode 分流、轮询带 `?model=`、新增 `cancelVideoGenerationTask`/`remixVideoGenerationTask` 导出；视频页给「生成中」日志加取消按钮。

**Tech Stack:** Go 1.x + Gin + GORM（后端）；Next.js + React + axios + Ant Design（前端）；PostgreSQL；TDD（后端纯函数测试）。

## Global Constraints

- 后端模块路径：`github.com/basketikun/infinite-canvas`（go.mod）。
- 后端统一响应信封 `{code, data, msg}`，HTTP 200（即使业务失败）——所有新 handler/service 必须沿用 `proxyFail`/`proxyFailError`，不引入文档的 `{success, error}` 格式。
- 计费复用 `service.ConsumeUserCredits` / `service.RefundUserCredits` + `service.ModelCost` + `service.SelectModelChannel`，不新增计费模型。
- 认证挂在现有 `v1 := api.Group("/v1", middleware.UserAuth)` 组下，不引入 Bearer API Key 体系。
- **不得改动** `resolveAIProxyPath` / `isArkSeedanceVideo` / `ProxyAIRequest` / `ProxyAIGetRequest` / `buildOpenAIUpstream` / `buildGeminiUpstream`（旧路径隔离保证）。
- 厂商范围仅 Seedance 系（模型名含 `seedance`/`doubao-seedance` 或 baseURL 含 `/api/plan/v3`），不实现 Vidu/Kuaizi/AIDrama 适配器。
- 请求体原样透传，不实现 `TaskInputConvert` 格式转换。
- 前端只改 Seedance 系分支，OpenAI multipart `/videos` 路径（`createOpenAIVideoTask`/`pollOpenAIVideoTask`）不动。
- 错误文案使用中文，与现有 `proxyFail` 文案风格一致。
- 测试命令：后端 `go test ./service/...`；编译 `go build ./...`；前端 `cd web && bun run lint && bun run build`（若无 bun 用 npm）。

---

## File Structure

**后端新增 / 改动：**
- `handler/video_tasks.go`（新建）— 4 个薄 handler：`CreateVideoTask` / `GetVideoTask` / `CancelVideoTask` / `RemixVideoTask`。只做参数注入，逻辑在 service。
- `service/ai_proxy.go`（改动，末尾追加）— `ProxyVideoTaskCreate` / `proxyVideoTaskPost` / `ProxyVideoTaskRemix` / `ProxyVideoTaskDelete`。不改动现有函数。
- `service/ai_proxy_test.go`（改动，追加测试）— 5 个测试覆盖路径不变性 + 新 URL 构造。
- `router/router.go`（改动）— 在 v1 组新增 4 个路由。

**前端新增 / 改动：**
- `web/src/services/api/video.ts`（改动）— `seedanceApiUrl` channelMode 分流；`pollSeedanceTask` 带 `?model=`；新增 `cancelVideoGenerationTask` / `remixVideoGenerationTask` 导出。
- `web/src/app/(user)/video/page.tsx`（改动）— 引入 `cancelVideoGenerationTask`；per-log `AbortController`；「生成中」日志加取消按钮。

**不改动（隔离保证）：** `handler/ai.go`；`service/ai_proxy.go` 中的 `ProxyAIRequest`/`ProxyAIGetRequest`/`resolveAIProxyPath`/`isArkSeedanceVideo`/`buildOpenAIUpstream`/`buildGeminiUpstream`；前端 `createOpenAIVideoTask`/`pollOpenAIVideoTask`。

---

### Task 1: 后端 — 路径直通与回归测试（TDD 红绿）

验证 `resolveAIProxyPath` 对标准 `/contents/generations/tasks*` 路径原样返回（新路径直通），且对旧 `/videos` 仍改写（回归保护）。这是本次正确性的核心证据，先写测试再确认现有行为已满足（无需改实现）。

**Files:**
- Modify: `service/ai_proxy_test.go`（末尾追加测试）

**Interfaces:**
- Consumes: `resolveAIProxyPath(baseURL, modelName, path) string`（现有，`service/ai_proxy.go:175`）
- Produces: 无（纯回归测试，锁定行为供后续任务依赖）

- [ ] **Step 1: 写失败/通过的测试**

在 `service/ai_proxy_test.go` 末尾追加：

```go
func TestResolveAIProxyPathPassesThroughTasksPath(t *testing.T) {
	base := "https://ark.cn-beijing.volces.com/api/plan/v3"
	got := resolveAIProxyPath(base, "seedance-2.0", "/contents/generations/tasks")
	if got != "/contents/generations/tasks" {
		t.Fatalf("tasks path should pass through unchanged, got %q", got)
	}
}

func TestResolveAIProxyPathPassesThroughTasksIdAndRemixPath(t *testing.T) {
	base := "https://ark.cn-beijing.volces.com/api/plan/v3"
	cases := []string{
		"/contents/generations/tasks/pub_abc123",
		"/contents/generations/tasks/pub_abc123/remix",
	}
	for _, path := range cases {
		got := resolveAIProxyPath(base, "seedance-2.0", path)
		if got != path {
			t.Fatalf("path %q should pass through unchanged, got %q", path, got)
		}
	}
}

func TestResolveAIProxyPathStillRewritesVideosForSeedance(t *testing.T) {
	base := "https://ark.cn-beijing.volces.com/api/plan/v3"
	got := resolveAIProxyPath(base, "seedance-2.0", "/videos")
	if got != "/contents/generations/tasks" {
		t.Fatalf("legacy /videos should still rewrite for seedance, got %q", got)
	}
	// /videos/:id（非 /content 结尾）也应改写
	gotID := resolveAIProxyPath(base, "seedance-2.0", "/videos/pub_abc")
	if gotID != "/contents/generations/tasks/pub_abc" {
		t.Fatalf("legacy /videos/:id should still rewrite, got %q", gotID)
	}
	// /videos/:id/content 不改写（保持现状）
	gotContent := resolveAIProxyPath(base, "seedance-2.0", "/videos/pub_abc/content")
	if gotContent != "/videos/pub_abc/content" {
		t.Fatalf("legacy /videos/:id/content should not rewrite, got %q", gotContent)
	}
}
```

- [ ] **Step 2: 运行测试确认通过（锁定现有行为）**

Run: `go test ./service/ -run TestResolveAIProxyPath -v`
Expected: PASS（4 个测试全过）。这验证 `resolveAIProxyPath` 现有逻辑已满足新路径直通 + 旧路径改写，**无需改实现**。

> 若有失败：检查 `resolveAIProxyPath`（`service/ai_proxy.go:175-186`）是否被人改动。本任务**不应该**改 `resolveAIProxyPath`；失败说明环境状态异常，先恢复再继续。

- [ ] **Step 3: 提交**

```bash
git add service/ai_proxy_test.go
git commit -m "test(backend): lock resolveAIProxyPath passthrough for /tasks + legacy /videos regression"
```

---

### Task 2: 后端 — `buildOpenAIUpstream` 构造新标准路径 URL（TDD）

验证 `buildOpenAIUpstream`（经 `resolveUpstreamRequest`）对 `/contents/generations/tasks*` 路径产出正确的上游 URL、Bearer 头、原 body。

**Files:**
- Modify: `service/ai_proxy_test.go`（末尾追加测试）

**Interfaces:**
- Consumes: `resolveUpstreamRequest(channel, modelName, path, body, contentType) upstreamRequest`（现有，`service/ai_proxy.go:108`）；`model.ModelChannel`（`model/setting.go:13`）
- Produces: 无（锁定 URL 构造行为，供 Task 3/4 的 service 函数依赖）

- [ ] **Step 1: 写测试**

在 `service/ai_proxy_test.go` 末尾追加：

```go
func TestBuildOpenAIUpstreamTasksCreateURL(t *testing.T) {
	channel := model.ModelChannel{Protocol: "openai", BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3", APIKey: "ark-key", Models: []string{"seedance-2.0"}}
	body := []byte(`{"model":"seedance-2.0","content":[{"type":"text","text":"a cat"}]}`)
	got := resolveUpstreamRequest(channel, "seedance-2.0", "/contents/generations/tasks", body, "application/json")
	if got.URL != "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks" {
		t.Fatalf("tasks create URL = %q", got.URL)
	}
	if got.Headers.Get("Authorization") != "Bearer ark-key" {
		t.Fatalf("tasks create Bearer = %q", got.Headers.Get("Authorization"))
	}
	if string(got.Body) != string(body) {
		t.Fatalf("tasks create body should be preserved, got %q", string(got.Body))
	}
}

func TestBuildOpenAIUpstreamTasksRemixURL(t *testing.T) {
	channel := model.ModelChannel{Protocol: "openai", BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3", APIKey: "ark-key", Models: []string{"seedance-2.0"}}
	got := resolveUpstreamRequest(channel, "seedance-2.0", "/contents/generations/tasks/pub_abc/remix", []byte(`{"prompt":"x"}`), "application/json")
	if got.URL != "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks/pub_abc/remix" {
		t.Fatalf("tasks remix URL = %q", got.URL)
	}
	if got.Headers.Get("Authorization") != "Bearer ark-key" {
		t.Fatalf("tasks remix Bearer = %q", got.Headers.Get("Authorization"))
	}
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `go test ./service/ -run TestBuildOpenAIUpstreamTasks -v`
Expected: PASS。`buildOpenAIUpstream` → `BuildModelChannelURL` 已对 `/api/plan/v3` baseURL 不再追加 `/v1`（`service/channel.go:41`），所以 URL 正确拼接。

- [ ] **Step 3: 提交**

```bash
git add service/ai_proxy_test.go
git commit -m "test(backend): verify buildOpenAIUpstream URL/auth for /tasks create + remix"
```

---

### Task 3: 后端 — service 层 `proxyVideoTaskPost` + `ProxyVideoTaskDelete`（TDD 核心）

实现创建/remix 的带计费 POST 透传 + 取消的 DELETE 透传。`proxyVideoTaskPost` 复用现有 `ProxyAIRequest` 的全部计费链路原语（`readAIRequest`/`UserFromContext`/`ModelCost`/`readAIRequestCount`/`SelectModelChannel`/`buildOpenAIUpstream`/`ConsumeUserCredits`/`proxyCopyAIResponse`/`RefundUserCredits`），仅上游路径不同。

> 注：service 包内的 proxy 函数涉及 `http.ResponseWriter` 和外部 HTTP 调用，与现有 `ProxyAIRequest` 一样不写单测（现有 `ProxyAIRequest` 也无单测，靠纯函数 `buildOpenAIUpstream`/`resolveAIProxyPath` 的测试覆盖构造逻辑）。本任务的正确性由 Task 1/2 锁定的路径+URL 行为 + 编译保证 + Task 6 集成验证共同保证。

**Files:**
- Modify: `service/ai_proxy.go`（末尾追加，不改动现有函数）

**Interfaces:**
- Consumes: `readAIRequest(r) ([]byte, string, string, error)`；`UserFromContext(ctx) (model.User, bool)`；`ModelCost(modelName) (int, error)`；`readAIRequestCount(body, contentType) int`；`SelectModelChannel(modelName) (model.ModelChannel, error)`；`buildOpenAIUpstream(channel, modelName, path, body, contentType) upstreamRequest`；`ConsumeUserCredits(userID, model, credits, path) error`；`proxyCopyAIResponse(w, request, onFailure)`；`RefundUserCredits(userID, model, credits, path) error`；`proxyFail(w, msg)`；`proxyFailError(w, err)`；`proxyAILogf(format, args...)`（均现有）
- Produces:
  - `ProxyVideoTaskCreate(w http.ResponseWriter, r *http.Request)`
  - `ProxyVideoTaskRemix(w http.ResponseWriter, r *http.Request, path string)`
  - `ProxyVideoTaskDelete(w http.ResponseWriter, r *http.Request, path string)`

- [ ] **Step 1: 写实现 — `proxyVideoTaskPost` + `ProxyVideoTaskCreate` + `ProxyVideoTaskRemix`**

在 `service/ai_proxy.go` 末尾追加：

```go
// ProxyVideoTaskCreate 处理标准入口 POST /contents/generations/tasks：选渠道、扣算力点、转发上游、失败返还。
func ProxyVideoTaskCreate(w http.ResponseWriter, r *http.Request) {
	proxyVideoTaskPost(w, r, "/contents/generations/tasks")
}

// ProxyVideoTaskRemix 处理标准入口 POST /contents/generations/tasks/:id/remix：同创建计费链路。
func ProxyVideoTaskRemix(w http.ResponseWriter, r *http.Request, path string) {
	proxyVideoTaskPost(w, r, path)
}

// proxyVideoTaskPost POST 类标准入口视频任务：读请求→选渠道→预扣→透传上游→失败返还。
// 上游 path 已是标准 /contents/generations/tasks...，resolveAIProxyPath 原样返回，不走 /videos 改写。
func proxyVideoTaskPost(w http.ResponseWriter, r *http.Request, path string) {
	body, contentType, modelName, err := readAIRequest(r)
	if err != nil {
		proxyAILogf("video task request read failed: %v", err)
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
		proxyAILogf("video task read model cost failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	credits *= readAIRequestCount(body, contentType)
	channel, err := SelectModelChannel(modelName)
	if err != nil {
		proxyAILogf("video task select channel failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	resolved := buildOpenAIUpstream(channel, modelName, path, body, contentType)
	if resolved.URL == "" {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	request, err := http.NewRequest(http.MethodPost, resolved.URL, bytes.NewReader(body))
	if err != nil {
		proxyAILogf("video task build request failed: url=%s err=%v", resolved.URL, err)
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
			proxyAILogf("video task refund credits failed: user=%s model=%s credits=%d err=%v", user.ID, modelName, credits, err)
		}
	})
}
```

- [ ] **Step 2: 写实现 — `ProxyVideoTaskDelete`**

紧接追加：

```go
// ProxyVideoTaskDelete 处理标准入口 DELETE /contents/generations/tasks/:id：按 ?model= 选渠道，透传上游，不计费。
func ProxyVideoTaskDelete(w http.ResponseWriter, r *http.Request, path string) {
	modelName := r.URL.Query().Get("model")
	if strings.TrimSpace(modelName) == "" {
		proxyFail(w, "缺少模型名称")
		return
	}
	channel, err := SelectModelChannel(modelName)
	if err != nil {
		proxyAILogf("video task select channel failed: model=%s err=%v", modelName, err)
		proxyFail(w, "AI 接口请求失败")
		return
	}
	resolved := buildOpenAIUpstream(channel, modelName, path, nil, "")
	if resolved.URL == "" {
		proxyFail(w, "AI 接口请求失败")
		return
	}
	request, err := http.NewRequest(http.MethodDelete, resolved.URL, nil)
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
```

- [ ] **Step 3: 编译确认**

Run: `go build ./...`
Expected: 无输出（编译通过）。`bytes`/`net/http`/`strings` 已在 `ai_proxy.go` 现有 import 中。

- [ ] **Step 4: 跑全量 service 测试确认无回归**

Run: `go test ./service/...`
Expected: PASS（含 Task 1/2 新增 + 现有全部测试）。

- [ ] **Step 5: 提交**

```bash
git add service/ai_proxy.go
git commit -m "feat(backend): add video task proxy funcs (create/remix with credits, delete passthrough)"
```

---

### Task 4: 后端 — handler 层 + 路由挂载

新增 `handler/video_tasks.go`（4 个薄 handler），在 `router/router.go` v1 组挂载 4 个路由。结构与现有 `handler/ai.go` + router `/videos` 路由完全一致。

**Files:**
- Create: `handler/video_tasks.go`
- Modify: `router/router.go:31-43`（v1 组内新增 4 个路由）

**Interfaces:**
- Consumes: `service.ProxyVideoTaskCreate(w, r)`；`service.ProxyAIGetRequest(w, r, path)`（现有）；`service.ProxyVideoTaskDelete(w, r, path)`；`service.ProxyVideoTaskRemix(w, r, path)`（Task 3 产出）
- Produces: `handler.CreateVideoTask` / `handler.GetVideoTask` / `handler.CancelVideoTask` / `handler.RemixVideoTask`（供 router 引用）

- [ ] **Step 1: 创建 `handler/video_tasks.go`**

```go
package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

// CreateVideoTask POST /api/v1/contents/generations/tasks
func CreateVideoTask(w http.ResponseWriter, r *http.Request) {
	service.ProxyVideoTaskCreate(w, r)
}

// GetVideoTask GET /api/v1/contents/generations/tasks/:id
func GetVideoTask(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyAIGetRequest(w, r, "/contents/generations/tasks/"+id)
}

// CancelVideoTask DELETE /api/v1/contents/generations/tasks/:id
func CancelVideoTask(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyVideoTaskDelete(w, r, "/contents/generations/tasks/"+id)
}

// RemixVideoTask POST /api/v1/contents/generations/tasks/:id/remix
func RemixVideoTask(w http.ResponseWriter, r *http.Request, id string) {
	service.ProxyVideoTaskRemix(w, r, "/contents/generations/tasks/"+id+"/remix")
}
```

- [ ] **Step 2: 在 `router/router.go` v1 组挂载路由**

在 `router/router.go` 现有 `v1.POST("/videos", ...)` 之后、`v1.POST("/media/references", ...)` 之前，以及 `v1.GET("/videos/:id/content", ...)` 之后，插入新路由。具体：找到这两行：

```go
	v1.POST("/videos", gin.WrapF(handler.AIVideos))
```

和

```go
	v1.GET("/videos/:id/content", func(c *gin.Context) {
		handler.AIVideoContent(c.Writer, c.Request, c.Param("id"))
	})
```

在 `v1.GET("/videos/:id/content", ...)` 这个块**之后**插入：

```go
	// 视频生成标准入口（对齐 xvanai /v1/contents/generations/tasks）。旧 /videos 路由保留为遗留。
	v1.POST("/contents/generations/tasks", gin.WrapF(handler.CreateVideoTask))
	v1.GET("/contents/generations/tasks/:id", func(c *gin.Context) {
		handler.GetVideoTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.DELETE("/contents/generations/tasks/:id", func(c *gin.Context) {
		handler.CancelVideoTask(c.Writer, c.Request, c.Param("id"))
	})
	v1.POST("/contents/generations/tasks/:id/remix", func(c *gin.Context) {
		handler.RemixVideoTask(c.Writer, c.Request, c.Param("id"))
	})
```

- [ ] **Step 3: 编译确认**

Run: `go build ./...`
Expected: 无输出（编译通过）。

- [ ] **Step 4: 提交**

```bash
git add handler/video_tasks.go router/router.go
git commit -m "feat(backend): mount /api/v1/contents/generations/tasks routes (create/get/cancel/remix)"
```

---

### Task 5: 前端 — `video.ts` Seedance 远程模式 URL + `?model=` + cancel/remix 导出

改 `seedanceApiUrl` 加 channelMode 分流；`pollSeedanceTask` 带 `?model=`；新增 `cancelVideoGenerationTask` + `remixVideoGenerationTask` 导出。OpenAI 风格分支不动。

**Files:**
- Modify: `web/src/services/api/video.ts:144-157`（pollSeedanceTask）；`web/src/services/api/video.ts:181-183`（seedanceApiUrl）；末尾追加两个导出函数

**Interfaces:**
- Consumes: `axios`；`AiConfig`（`@/stores/use-config-store`）；`buildApiUrl`/`modelOptionName`/`resolveModelRequestConfig`（`@/stores/use-config-store`）；`VideoGenerationTask`/`RequestOptions`/`aiHeaders`/`readAxiosError`/`assertVideoConfig`/`unwrapSeedanceTask`（本文件内现有）
- Produces: `cancelVideoGenerationTask(config, task, options?)`；`remixVideoGenerationTask(config, task, prompt, options?)`（供 Task 6 视频页引用）

- [ ] **Step 1: 改 `seedanceApiUrl` 加 channelMode 分流**

在 `web/src/services/api/video.ts` 找到现有：

```ts
function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}
```

替换为：

```ts
function seedanceApiUrl(config: AiConfig, taskId?: string) {
    const path = `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`;
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}
```

- [ ] **Step 2: 改 `pollSeedanceTask` 带 `?model=`**

在 `web/src/services/api/video.ts` 找到 `pollSeedanceTask` 内的 axios.get 调用：

```ts
        const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
```

替换为（加 `params: { model: modelOptionName(task.model) }`）：

```ts
        const state = unwrapSeedanceTask(
            (await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), {
                headers: aiHeaders(config),
                params: { model: modelOptionName(task.model) },
                signal: options?.signal,
            })).data,
        );
```

- [ ] **Step 3: 新增 `cancelVideoGenerationTask` 导出**

在 `web/src/services/api/video.ts` 末尾（`blobToDataUrl` 函数之后）追加：

```ts
export async function cancelVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<void> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider !== "seedance") {
        throw new Error("当前视频接口不支持取消任务，请切换到 Seedance 2.0 / 火山 Agent Plan 模型");
    }
    try {
        await axios.delete(seedanceApiUrl(requestConfig, task.id), {
            headers: aiHeaders(requestConfig),
            params: { model: modelOptionName(task.model) },
            signal: options?.signal,
        });
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务取消失败"));
    }
}

export async function remixVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, newPrompt: string, options?: RequestOptions): Promise<VideoGenerationTask> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider !== "seedance") {
        throw new Error("当前视频接口不支持二次创作，请切换到 Seedance 2.0 / 火山 Agent Plan 模型");
    }
    const payload = {
        model: modelOptionName(task.model),
        prompt: newPrompt,
    };
    try {
        const created = unwrapSeedanceTask(
            (await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(requestConfig, `${task.id}/remix`), payload, {
                headers: aiHeaders(requestConfig, "application/json"),
                signal: options?.signal,
            })).data,
        );
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model: task.model };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频二次创作失败"));
    }
}
```

> 注：`seedanceApiUrl(config, \`${task.id}/remix\`)` 会产出 `/api/v1/contents/generations/tasks/{enc(task.id)}/remix`（`encodeURIComponent` 对含 `/` 的整体编码；这里传入的 `${task.id}/remix` 会被整体 encode，`/` 变 `%2F`）。**这是错的**——会破坏路径分隔。改用拼接：见 Step 3 修正。

- [ ] **Step 4: 修正 `remixVideoGenerationTask` 的 URL 拼接**

`seedanceApiUrl` 的 `encodeURIComponent(taskId)` 会把 `task.id/remix` 里的 `/` 编码成 `%2F`。remix 路径需要原样 `/`。把 Step 3 里 remix 的 URL 调用改为手动拼路径，不走 `seedanceApiUrl` 的 taskId 参数：

将 Step 3 中这一行：

```ts
            (await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(requestConfig, `${task.id}/remix`), payload, {
```

替换为：

```ts
            (await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(requestConfig, task.id) + "/remix", payload, {
```

这样 `seedanceApiUrl(config, task.id)` 产出 `/api/v1/contents/generations/tasks/{enc(task.id)}`，再 `+ "/remix"` → `/api/v1/contents/generations/tasks/{enc(task.id)}/remix`，路径分隔正确。

- [ ] **Step 5: lint + build 确认**

Run: `cd web && bun run lint && bun run build`
Expected: 无错误（若无 bun，用 `npm run lint && npm run build`）。`modelOptionName`/`resolveModelRequestConfig`/`assertVideoConfig`/`aiHeaders`/`readAxiosError`/`unwrapSeedanceTask`/`SeedanceTask`/`RequestOptions`/`VideoGenerationTask` 均在本文件已定义或已 import。

- [ ] **Step 6: 提交**

```bash
git add web/src/services/api/video.ts
git commit -m "feat(web): route Seedance remote mode to /api/v1/contents/generations/tasks + add cancel/remix"
```

---

### Task 6: 前端 — 视频页「生成中」取消按钮 + per-log AbortController

在视频页给「生成中」状态的日志加取消按钮，点击调用 `cancelVideoGenerationTask`，并通过 per-log `AbortController` 中断轮询循环，把日志状态置为「已取消」（复用现有「失败」状态展示，文案区分）。

**Files:**
- Modify: `web/src/app/(user)/video/page.tsx`：import 行（line 19）；`activeLogIdsRef` 附近（line 75）；`pollGenerationLog`（line 288-331）；取消按钮渲染位置（LogPanel 内「生成中」tag 附近，需先定位 LogPanel 组件）

**Interfaces:**
- Consumes: `cancelVideoGenerationTask`（Task 5 产出）；`pollVideoGenerationTask`（现有）；`VideoGenerationTask`（现有）；`AiConfig`/`useEffectiveConfig`（现有）
- Produces: 无（UI 改动）

- [ ] **Step 1: 改 import 引入 `cancelVideoGenerationTask`**

在 `web/src/app/(user)/video/page.tsx` line 19 找到：

```ts
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
```

替换为：

```ts
import { cancelVideoGenerationTask, createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
```

- [ ] **Step 2: 新增 per-log AbortController ref**

在 `web/src/app/(user)/video/page.tsx` 找到 line 75 附近：

```ts
    const activeLogIdsRef = useRef<Set<string>>(new Set());
```

在其**之后**追加：

```ts
    const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
```

- [ ] **Step 3: 改 `pollGenerationLog` 用 AbortController 并接受外部 signal**

本步有 4 处局部编辑 + 1 处整块替换，全部在 `pollGenerationLog`（line 288-331）内。

**编辑 a — 函数开头新增 AbortController。** 找到 line 288-290：

```ts
    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        activeLogIdsRef.current.add(log.id);
```

替换为：

```ts
    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        activeLogIdsRef.current.add(log.id);
        const abortController = new AbortController();
        abortControllersRef.current.set(log.id, abortController);
```

**编辑 b — 轮询调用传 signal。** 找到 line 297：

```ts
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task);
```

替换为：

```ts
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task, { signal: abortController.signal });
```

**编辑 c — 循环末尾 delay 改可中断。** 找到 line 317：

```ts
                await delay(log.task.provider === "seedance" ? 5000 : 2500);
```

替换为：

```ts
                await delay(log.task.provider === "seedance" ? 5000 : 2500, abortController.signal);
```

**编辑 d — 整块替换 catch + finally（line 319-330）。** 找到现有：

```ts
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            await saveLog({ ...log, status: "失败", durationMs: Date.now() - log.createdAt, error: errorMessage });
            message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
```

整块替换为（abort 时文案「已取消」且不弹错误 toast）：

```ts
        } catch (error) {
            const aborted = abortController.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
            const errorMessage = aborted ? "已取消" : error instanceof Error ? error.message : "生成失败";
            setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            await saveLog({ ...log, status: "失败", durationMs: Date.now() - log.createdAt, error: errorMessage });
            if (!aborted) message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            abortControllersRef.current.delete(log.id);
            if (!activeLogIdsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
```

替换后 `catch` + `finally` 仍各一个，结构与原代码一致，仅内容变化。

- [ ] **Step 4: 改本地 `delay` 函数支持 signal**

在 `web/src/app/(user)/video/page.tsx` 末尾找到（line 851-853）：

```ts
function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
```

替换为：

```ts
function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
```

- [ ] **Step 5: 新增 `cancelGenerationLog` 处理函数**

在 `pollGenerationLog` 函数定义**之后**（line 331 之后）追加：

```ts
    const cancelGenerationLog = async (log: GenerationLog) => {
        if (!log.task) return;
        const controller = abortControllersRef.current.get(log.id);
        if (!controller) return;
        controller.abort();
        abortControllersRef.current.delete(log.id);
        if (log.task.provider !== "seedance") {
            message.info("当前视频接口不支持取消任务");
            return;
        }
        try {
            const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
            await cancelVideoGenerationTask(taskConfig, log.task);
        } catch (error) {
            message.warning(error instanceof Error ? error.message : "视频任务取消失败");
        }
    };
```

> `buildVideoConfig` 是视频页现有函数（在 `pollGenerationLog` 内 line 294 已使用 `buildVideoConfig(...)`）。确认其签名支持 `(config, model)`。

- [ ] **Step 6: 定位 LogPanel 并给「生成中」日志加取消按钮**

LogPanel 是单独的组件。先找到它：

Run: `grep -rn "function LogPanel\|const LogPanel\|LogPanel =" "web/src/app/(user)/video/"` 
Expected: 显示 LogPanel 定义文件路径（很可能在同目录 `log-panel.tsx` 或 `page.tsx` 内）。

根据找到的位置，在 LogPanel 渲染「生成中」tag 的那行（line 659 附近 `<Tag ... color={log.status === "成功" ? "blue" : log.status === "生成中" ? "processing" : "red"}>`）旁边，对 `log.status === "生成中"` 的条目加一个取消按钮。具体写法取决于 LogPanel 是否接收 `onCancel` 回调 prop：

- 若 LogPanel 是独立组件：在其 props 类型加 `onCancel?: (logId: string) => void`，在「生成中」条目渲染处加 `<Button size="small" onClick={() => onCancel?.(log.id)}>取消</Button>`；在 `page.tsx` 的 `<LogPanel ... />` 调用处传 `onCancel={(id) => { const log = logs.find((l) => l.id === id); if (log) void cancelGenerationLog(log); }}`。
- 若 LogPanel 在 page.tsx 内联：直接在「生成中」渲染处加按钮，onClick 调 `cancelGenerationLog(log)`。

按钮文案「取消」，size="small"，与现有「取消」全选按钮（line 629）风格区分（放在每条「生成中」日志行内）。引入 `LogPanel` 已有的 antd `Button`。

- [ ] **Step 7: lint + build 确认**

Run: `cd web && bun run lint && bun run build`
Expected: 无错误。`AbortController`/`DOMException` 是浏览器全局，无需 import。

- [ ] **Step 8: 提交**

```bash
git add "web/src/app/(user)/video/page.tsx" web/src/app/\(user\)/video/<log-panel-file-if-separate>
git commit -m "feat(web): add cancel button for in-progress video generation with abort-aware polling"
```

---

### Task 7: 集成验证（手动）

启动 dev 栈，端到端验证标准入口 + 取消 + 旧路径回归。

**Files:** 无（验证 only）

- [ ] **Step 1: 启动 dev 栈**

Run: `docker compose -f docker-compose.local.yml up`（或按 README 的 dev 启动方式：api air@8088 + web bun@3000 + postgres）
Expected: 三个服务起来，api 监听 8088，web 监听 3000。

- [ ] **Step 2: 配置 Seedance 渠道**

登录管理后台（admin），在渠道配置加一个 Seedance/AIDrama 渠道：模型 `seedance-2.0`，BaseURL 填 Ark Plan（如 `https://ark.cn-beijing.volces.com/api/plan/v3`），API Key 填真实 key，模型费用配 credits。启用。

- [ ] **Step 3: 验证创建走标准入口**

视频页发起一次 Seedance 文生视频。观察：
- 前端网络面板：`POST /api/v1/contents/generations/tasks`（远程模式）。
- 后端日志：上游 URL = `https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks`。
- credits 预扣成功（管理后台用户余额减少）。

- [ ] **Step 4: 验证轮询 + Ark 返回**

观察轮询请求：`GET /api/v1/contents/generations/tasks/:id?model=seedance-2.0`。返回 Ark 格式（`status: running` → `succeeded`，`content.video_url`）。前端正常解析并下载视频。生成成功后 credits 不返还（成功扣费符合预期）。

- [ ] **Step 5: 验证取消**

再发起一个视频任务，生成中点击「取消」按钮。观察：
- 前端：`DELETE /api/v1/contents/generations/tasks/:id?model=seedance-2.0`。
- 后端透传到上游。
- 轮询中断，日志状态变「失败」/文案「已取消」。
- credits：取消不额外扣费（创建时已扣的 credits 是否返还取决于现有 `RefundUserCredits` 语义——本任务不改变取消计费，取消不计费即不触发返还，与设计一致）。

- [ ] **Step 6: 回归旧路径**

切到 OpenAI multipart 渠道（如 grok-imagine-video），视频页发起视频生成。观察 `POST /api/v1/videos`（旧路径）仍正常工作，`resolveAIProxyPath` 改写行为未变。

- [ ] **Step 7: 全量测试最终确认**

Run: `go test ./service/... && go build ./... && cd web && bun run lint && bun run build`
Expected: 全部 PASS / 无错误。

- [ ] **Step 8: 提交（如有集成过程中的小修）**

若集成验证发现并修复了问题，提交修复。否则跳过。

```bash
git add -A
git commit -m "test: integration fixes from video generation standard entry verification"
```

---

## Self-Review

**1. Spec coverage:**
- 路由 4 个（创建/查询/取消/remix）→ Task 4。✓
- handler 薄包装 → Task 4。✓
- service `proxyVideoTaskPost`（创建+remix 带计费）→ Task 3 Step 1。✓
- service `ProxyVideoTaskDelete`（取消不计费）→ Task 3 Step 2。✓
- 查询复用 `ProxyAIGetRequest` → Task 4 handler `GetVideoTask`。✓
- `?model=` 选渠道 → Task 3 Step 2（DELETE）+ Task 5 Step 2（前端轮询）。✓
- 路径直通不变性 → Task 1 + Task 2 测试锁定。✓
- 旧路径隔离不改 `resolveAIProxyPath` → 全程无改动 + Task 1 回归测试。✓
- 前端 `seedanceApiUrl` channelMode 分流 → Task 5 Step 1。✓
- 前端 `?model=` → Task 5 Step 2。✓
- 前端 cancel 导出 → Task 5 Step 3。✓
- 前端 remix 导出（不接 UI）→ Task 5 Step 3-4。✓
- 视频页取消按钮 → Task 6。✓
- 错误信封 `{code,data,msg}` → Task 3 沿用 `proxyFail`。✓
- 测试策略 5 个后端测试 → Task 1（3 个）+ Task 2（2 个）。✓
- 集成验证 5 步 → Task 7。✓

**2. Placeholder scan:** 无 TBD/TODO。Task 6 Step 6 因 LogPanel 位置需先 grep 定位（真实分支条件，非占位）——给出两种情况的具体写法。其余步骤均含完整代码。

**3. Type consistency:**
- `ProxyVideoTaskCreate(w, r)` / `ProxyVideoTaskRemix(w, r, path)` / `ProxyVideoTaskDelete(w, r, path)` — handler（Task 4）与 service（Task 3）签名一致。✓
- `cancelVideoGenerationTask(config, task, options?)` — video.ts（Task 5）与 page.tsx（Task 6 Step 5）调用签名一致。✓
- `pollVideoGenerationTask(config, task, options?)` — 现有签名已支持第三参 `options`（`video.ts:71`）。✓
- `delay(ms, signal?)` — Task 6 Step 4 定义与 Step 3 调用一致。✓
- `buildVideoConfig(config, model)` — Task 6 Step 5 调用与现有 line 294 用法一致。✓

无类型不一致。
