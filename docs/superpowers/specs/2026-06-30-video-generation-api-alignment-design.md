# 视频生成接口对齐 xvanai 标准化入口 — 设计文档

## 背景与目标

`docs/video-generation-api.md` 是 xvanai 视频生成网关的标准化接口文档，定义了统一入口 `/v1/contents/generations/tasks`，背后通过中间件链路（TaskInputConvert → Distribute → RelayTask）把请求分发转换到 Vidu / AIDrama (Seedance) / Kuaizi 等不同上游厂商。

平台当前 Go 后端是「OpenAI 兼容代理 + Seedance 路径改写」的轻量代理：

- `POST /api/v1/videos`、`GET /api/v1/videos/:id`、`GET /api/v1/videos/:id/content` 三个路由（`UserAuth` + credits 预扣/返还）。
- `resolveAIProxyPath` 在模型名含 `seedance`/`doubao-seedance` 或 baseURL 含 `/api/plan/v3` 时，把 `/videos` 改写为上游 `/contents/generations/tasks`，即 Seedance/Ark 路径的透传。
- 没有 Vidu/Kuaizi/AIDrama 厂商适配器，没有取消（cancel）、没有 remix。

**本次目标**：把平台视频生成相关请求路由**端到端对齐** xvanai 文档的标准化入口 `/v1/contents/generations/tasks`（创建 / 查询 / 取消 / remix 四个路由），同时与系统现有功能（UserAuth + credits + 渠道选择 + 透传）对齐。旧 `/api/v1/videos` 路径保留为遗留版本，项目统一使用新标准入口。

## 决策汇总（brainstorming 确认）

| 维度 | 决策 |
|------|------|
| 对齐方向 | 前端 + 后端端到端对齐；保留旧 `/api/v1/videos` 作为遗留，项目统一用 `/api/v1/contents/generations/tasks` |
| 厂商范围 | 仅 Seedance 系（AIDrama / Kuaizi / Ark Plan），不实现 Vidu 适配器 |
| 请求体转换 | 后端不转换、原样透传（前端继续发 Ark `content[]` 格式） |
| 取消 / remix | 两个都透传实现 |
| 查询返回 | 原样透传上游 Ark 格式（`status: succeeded/failed/running`、`content.video_url`） |
| 计费 | 复用现有 `ModelCost` 预扣 / 返还（创建 / remix 扣费，查询 / 取消不扣） |
| 前端迁移 | 只迁 Seedance 系，OpenAI multipart `/videos` 保持现状 |
| 查询 / 取消选渠道 | 用 `?model=` query 参数 |
| 认证 | 挂 `UserAuth`、用平台 token（与现有 `/api/v1/videos` 一致） |
| 后端代码组织 | 方案 A — 独立 `handler/video_tasks.go` + 复用现有 proxy 原语 |

## 1. 架构与路由

### 1.1 新增路由

在 `router/router.go` 的现有 `v1` 组（`middleware.UserAuth` 下）新增四个路由：

```go
v1.POST("/contents/generations/tasks",            gin.WrapF(handler.CreateVideoTask))
v1.GET ("/contents/generations/tasks/:id", func(c *gin.Context) {
    handler.GetVideoTask(c.Writer, c.Request, c.Param("id"))
})
v1.DELETE("/contents/generations/tasks/:id", func(c *gin.Context) {
    handler.CancelVideoTask(c.Writer, c.Request, c.Param("id"))
})
v1.POST("/contents/generations/tasks/:id/remix", func(c *gin.Context) {
    handler.RemixVideoTask(c.Writer, c.Request, c.Param("id"))
})
```

完整对外路径：

| 平台路由 | 方法 | 用途 |
|---|---|---|
| `/api/v1/contents/generations/tasks` | POST | 创建视频生成任务 |
| `/api/v1/contents/generations/tasks/:id` | GET | 查询任务状态 |
| `/api/v1/contents/generations/tasks/:id` | DELETE | 取消任务 |
| `/api/v1/contents/generations/tasks/:id/remix` | POST | 基于原任务二次创作 |

### 1.2 与文档路由的映射

| 文档路由（`/v1/...`） | 平台路由（`/api/v1/...`） | handler |
|---|---|---|
| `POST /v1/contents/generations/tasks` | `POST /api/v1/contents/generations/tasks` | `CreateVideoTask` |
| `GET /v1/contents/generations/tasks/:task_id` | `GET /api/v1/contents/generations/tasks/:id` | `GetVideoTask` |
| `DELETE /v1/contents/generations/tasks/:task_id` | `DELETE /api/v1/contents/generations/tasks/:id` | `CancelVideoTask` |
| `POST /v1/contents/generations/tasks/:task_id/remix` | `POST /api/v1/contents/generations/tasks/:id/remix` | `RemixVideoTask` |

平台在 `/v1` 前加 `/api` 前缀（与现有所有 v1 路由一致；前端 catch-all 代理 `web/src/app/api/[...path]/route.ts` 已按 `/api/*` 转发到后端 8088）。

### 1.3 认证与中间件

- 挂在现有 `v1 := api.Group("/v1", middleware.UserAuth)` 下 → 复用平台登录 token + `UserFromContext`。
- 不引入文档的独立 Bearer API Key 体系。

## 2. Handler 与 Service 层

### 2.1 新增 `handler/video_tasks.go`

4 个 handler，结构对齐现有 `handler/ai.go` 的薄包装风格（handler 只做参数注入，逻辑在 service）：

```go
func CreateVideoTask(w http.ResponseWriter, r *http.Request) {
    service.ProxyVideoTaskCreate(w, r)
}
func GetVideoTask(w http.ResponseWriter, r *http.Request, id string) {
    service.ProxyAIGetRequest(w, r, "/contents/generations/tasks/"+id)
}
func CancelVideoTask(w http.ResponseWriter, r *http.Request, id string) {
    service.ProxyVideoTaskDelete(w, r, "/contents/generations/tasks/"+id)
}
func RemixVideoTask(w http.ResponseWriter, r *http.Request, id string) {
    service.ProxyVideoTaskRemix(w, r, "/contents/generations/tasks/"+id+"/remix")
}
```

router 里 `:id` 参数通过 `gin.WrapF` 的闭包注入（与现有 `AIVideo` handler 写法一致）。

### 2.2 新增 service 函数（`service/ai_proxy.go` 末尾追加）

#### 创建 / remix — 复用现有计费链路

`CreateVideoTask` 和 `RemixVideoTask` 的逻辑与现有 `ProxyAIRequest` 一致（读 body → 取 model → 算 credits → 选渠道 → 构造上游请求 → 预扣 → 转发 → 失败返还）。区别仅在于**上游路径已经是标准 `/contents/generations/tasks...`，不再走 `resolveAIProxyPath` 改写**。

提取一个内部函数避免重复：

```go
func ProxyVideoTaskCreate(w http.ResponseWriter, r *http.Request) {
    proxyVideoTaskPost(w, r, "/contents/generations/tasks")
}
func ProxyVideoTaskRemix(w http.ResponseWriter, r *http.Request, path string) {
    proxyVideoTaskPost(w, r, path)
}

// proxyVideoTaskPost：POST 类标准入口，带 credits 预扣/返还，直接透传标准路径。
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

> **关键不变性**：`buildOpenAIUpstream` 内部调用 `resolveAIProxyPath(channel.BaseURL, modelName, path)`。当 `path` 已经是 `/contents/generations/tasks...` 时，`resolveAIProxyPath` 现有分支不会命中（它只处理 `/videos` 前缀），会原样返回 → 正好是我们要的直通行为。**所以 `resolveAIProxyPath` 无需改动**，新路径天然透传。

#### 查询 — 复用 `ProxyAIGetRequest`

`GetVideoTask` 直接复用现有 `ProxyAIGetRequest(w, r, path)`，它已经从 `?model=` query 选渠道 + GET 透传 + 不计费。

`ProxyAIGetRequest` 在 model 为空时默认 `grok-imagine-video`——前端会带 `?model=`，不命中默认分支。**保持现状不改默认值**（改了会影响旧 `/videos/:id`）。

#### 取消 — 新增 `ProxyVideoTaskDelete`

```go
func ProxyVideoTaskDelete(w http.ResponseWriter, r *http.Request, path string) {
    modelName := r.URL.Query().Get("model")
    if strings.TrimSpace(modelName) == "" {
        proxyFail(w, "缺少模型名称") // 取消必须带 ?model= 选渠道
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
    proxyCopyAIResponse(w, request, nil) // 不计费，nil onFailure
}
```

DELETE 不计费（取消是终止一个已计费任务，不再扣点）。

### 2.3 路径重写的行为不变性

| 入口 | `path` 入参 | `resolveAIProxyPath` 行为 | 上游实际路径 |
|---|---|---|---|
| 旧 `POST /api/v1/videos`（Seedance 模型） | `/videos` | 命中 `isArkSeedanceVideo` → 改写 | `/contents/generations/tasks` |
| 新 `POST /api/v1/contents/generations/tasks` | `/contents/generations/tasks` | 不命中任何分支 → 原样 | `/contents/generations/tasks` |
| 新 `GET /tasks/:id` | `/contents/generations/tasks/:id` | 不命中 → 原样 | 同上 |
| 新 `DELETE /tasks/:id` | `/contents/generations/tasks/:id` | 不命中 → 原样 | 同上 |
| 新 `POST /tasks/:id/remix` | `/contents/generations/tasks/:id/remix` | 不命中 → 原样 | 同上 |

→ `resolveAIProxyPath` / `isArkSeedanceVideo` **完全不改**，旧路径行为零影响，新路径天然直通。

### 2.4 计费行为表

| 路由 | 计费 | 失败返还 | 说明 |
|---|---|---|---|
| `POST /tasks`（创建） | 预扣 `ModelCost(model) * n` | 是 | 复用 `ConsumeUserCredits` / `RefundUserCredits` |
| `POST /tasks/:id/remix` | 预扣 `ModelCost(model) * n` | 是 | 同创建（remix 是一次新生成） |
| `GET /tasks/:id` | 不计费 | — | 同现有 `ProxyAIGetRequest` |
| `DELETE /tasks/:id` | 不计费 | — | 取消已计费任务，不再扣点 |

`readAIRequestCount` 对创建/remix 仍读 `n`（Ark `content[]` 格式没有 `n`，默认 1 → 正确）。

## 3. 前端对齐

### 3.1 改动范围

仅 `web/src/services/api/video.ts`，且**仅 Seedance 系**（`isSeedanceVideoConfig(requestConfig)` 分支）。OpenAI 风格 `createOpenAIVideoTask` / `pollOpenAIVideoTask`（multipart `/videos`）**完全不动**。

### 3.2 远程模式 URL 切换

`seedanceApiUrl` 改为与 `aiApiUrl` 一致的 channelMode 分流：

```ts
// 现状（本地直连上游，远程模式也走同一个 URL）
function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

// 改为
function seedanceApiUrl(config: AiConfig, taskId?: string) {
    const path = `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`;
    return config.channelMode === "remote" ? `/api/v1${path}` : buildApiUrl(config.baseUrl, path);
}
```

- **远程模式** → `/api/v1/contents/generations/tasks[/:id]` → 前端 catch-all 代理 → 后端 8088 → 新标准路由。
- **本地模式** → 不变，仍直连 `config.baseUrl/v1/contents/generations/tasks`。

`aiHeaders(config, "application/json")` 已有 channelMode 分流（远程带 userToken，本地带 `config.apiKey`），无需改。

### 3.3 `?model=` query 参数

后端 GET/DELETE 靠 `?model=` 选渠道。`pollSeedanceTask` 改为带 `params: { model: modelOptionName(task.model) }`：

```ts
async function pollSeedanceTask(config, task, options) {
    const state = unwrapSeedanceTask(
        (await axios.get<ApiEnvelope<SeedanceTask>>(
            seedanceApiUrl(config, task.id),
            { headers: aiHeaders(config), params: { model: modelOptionName(task.model) }, signal: options?.signal }
        )).data
    );
    // ... 不变 ...
}
```

`seedanceApiUrl` 不拼 query（保持 URL 纯净），由 axios `params` 注入 `?model=`。本地模式上游是 Ark Plan，忽略多余 query，无副作用。

### 3.4 新增取消功能（cancel）

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
```

OpenAI 风格（`provider: "openai"`）不支持取消 → 抛错（与文档「并非所有厂商都支持取消」一致；旧 `/videos` 路径本就没有 cancel 路由）。

### 3.5 remix 暂不接前端 UI

后端实现 remix 透传路由，但**前端不新增 remix UI 调用**——视频页当前没有「基于已有任务二次创作」的入口。`video.ts` 暴露一个 `remixVideoGenerationTask` 导出函数备用，但不接入页面（YAGNI）。

```ts
export async function remixVideoGenerationTask(config, task, newPrompt, options): Promise<VideoGenerationTask> {
    // POST /api/v1/contents/generations/tasks/:id/remix { prompt, duration? }
    // 返回新任务，复用 createSeedanceTask 的返回结构
}
```

### 3.6 视频页 `page.tsx` 改动

最小化：

- 引入 `cancelVideoGenerationTask`。
- 在「生成中」状态的日志条目上加一个**取消按钮**，点击调用 `cancelVideoGenerationTask`，成功后把该日志状态置为「已取消」并停止轮询。
- 不加 remix UI。

UI 细节（按钮位置、文案「取消生成」、已取消状态展示）在实现阶段按现有页面风格对齐。

## 4. 错误处理与边界

### 4.1 错误响应格式

后端沿用现有统一信封 `{code, data, msg}`，HTTP 200（与 `proxyFail` / `ProxyAIRequest` 一致）。前端 `unwrapEnvelope` 已按此格式解包（`code !== 0` 抛 `msg`）。

不引入文档的 `{success, error}` 格式——那是 xvanai 网关自己的格式，与平台现有信封冲突。文档的错误码（`invalid_request` / `model_not_found` / `insufficient_user_balance` 等）以中文 `msg` 形式映射到现有信封，不逐字对齐错误码字符串。

### 4.2 边界与失败语义

| 场景 | 后端行为 | 前端表现 |
|---|---|---|
| 创建/remix 上游非 2xx | 预扣后 `proxyCopyAIResponse` 触发 `RefundUserCredits`，返回 `proxyFail(上游错误文案)` | `readAxiosError` 抛 `msg` |
| 创建 body 无 `model` | `readAIRequest` 返回 `errMissingModel` → `proxyFail("AI 接口请求失败")` | 抛「视频任务创建失败」 |
| 渠道不可用（`SelectModelChannel` 无渠道） | `proxyFail("AI 接口请求失败")`（沿用现状，不暴露内部细节） | 抛通用错误 |
| 余额不足 | `ConsumeUserCredits` 返回 `SafeMessage()` → `proxyFailError` 返回余额文案 | 抛余额提示 |
| GET/DELETE 缺 `?model=` | GET 走默认 `grok-imagine-video`（现状）；DELETE 新逻辑直接 `proxyFail("缺少模型名称")` | DELETE 抛「视频任务取消失败」 |
| DELETE 上游不支持取消 | 透传上游错误状态码 + 文案（如 Seedance 返回 4xx） | `readAxiosError` 抛上游 `msg` |
| Gemini 协议渠道 | `buildGeminiUpstream` 对 `/contents/generations/tasks*` 走 `geminiActionFor` default 分支 → `generateContent`，上游 4xx。前端 `assertVideoConfig` 已对 `apiFormat==="gemini"` 抛「Gemini 调用格式暂不支持视频生成」，前端拦截在前，后端不会收到 Gemini 视频请求。保持双保险不新增拦截。 |

### 4.3 与旧路径的隔离保证

- `resolveAIProxyPath` / `isArkSeedanceVideo` **不改** → 旧 `/api/v1/videos` 行为完全不变。
- 新 handler 是独立文件 `video_tasks.go`，不触碰 `handler/ai.go`。
- 新 service 函数追加在 `ai_proxy.go` 末尾，不改动现有 `ProxyAIRequest` / `ProxyAIGetRequest` / `resolveAIProxyPath`。
- 唯一共享点：`buildOpenAIUpstream`（只读复用，无修改）+ `readAIRequest` / `SelectModelChannel` / `ModelCost` / `ConsumeUserCredits` / `RefundUserCredits` / `proxyCopyAIResponse`（均只读复用）。

→ **回归风险仅限新路由本身**，旧路径零回归。

### 4.4 前端 channelMode 边界

- `seedanceApiUrl` 远程模式拼 `/api/v1/contents/generations/tasks`，经 Next.js catch-all `[...path]/route.ts` 转发到后端 8088。catch-all 用 `path.map(encodeURIComponent).join("/")` —— `/` 已是路径分隔符，`encodeURIComponent` 不影响 `/`，所以 `/api/v1/contents/generations/tasks/:id` 正常透传。
- `task.id` 已在 `seedanceApiUrl` 内 `encodeURIComponent`，含特殊字符也安全。
- 本地模式仍走 `buildApiUrl(config.baseUrl, path)` → 对 Ark Plan baseURL 做 `normalizeArkPlanBaseUrl` 归一化（现有逻辑），行为不变。

### 4.5 不在本次范围（YAGNI 剔除）

- Vidu 国内/海外/CN 适配器、AIDrama/Kuaizi 请求体转换中间件（仅 Seedance 系）。
- `TaskInputConvert` 格式转换（原样透传）。
- 任务持久化表（`tasks` 表 pub_id↔model 映射）—— 用 `?model=` 替代。
- 文档的 `callback_url` 回调机制、`return_last_frame`、`tools` 等高级字段——后端透传不解析，前端按需在 `content[]` 里带，上游处理。
- 前端 remix UI、文档管理类 API（`/kuaizi/*` 独立路由）。

## 5. 测试策略

### 5.1 后端单元测试（`service/ai_proxy_test.go` 追加）

沿用现有纯函数测试风格，不引入 HTTP mock。

| 测试 | 验证点 |
|---|---|
| `TestResolveAIProxyPathPassesThroughTasksPath` | `resolveAIProxyPath(base, "seedance-2.0", "/contents/generations/tasks")` 原样返回（不改写）→ 新路径直通 |
| `TestResolveAIProxyPathPassesThroughTasksIdPath` | `"/contents/generations/tasks/:id"`、`".../:id/remix"` 原样返回 |
| `TestResolveAIProxyPathStillRewritesVideosForSeedance` | 回归保护：`resolveAIProxyPath(base, "seedance-2.0", "/videos")` 仍改写为 `/contents/generations/tasks`（旧路径不变） |
| `TestBuildOpenAIUpstreamTasksCreateURL` | `buildOpenAIUpstream(channel, "seedance-2.0", "/contents/generations/tasks", body, "application/json")` 产出 URL = `{base}/contents/generations/tasks`、Bearer 头、原 body |
| `TestBuildOpenAIUpstreamTasksRemixURL` | `"/contents/generations/tasks/:id/remix"` 同上 |

这些测试覆盖第 2.3 节路径行为不变性表的全部行，是本次正确性的核心证据。

### 5.2 handler 层

现有 `handler/ai.go` 无单测（handler 是薄包装），`video_tasks.go` 同样不写 handler 单测，保持一致。路由挂载由 `router.New()` 保证，靠集成验证。

### 5.3 前端

`video.ts` 现无单测。本次不新增前端单测（与现有前端测试密度一致——前端无 vitest/jest 配置）。验证靠手动 + 后端路由测试。

### 5.4 集成验证（实现阶段手动）

1. 启 dev 栈（api air@8088 + web bun@3000 + postgres），配一个 Seedance/AIDrama 渠道（模型 `seedance-2.0`，Ark Plan baseURL）。
2. 视频页发起一次 Seedance 文生视频 → 确认请求落到 `POST /api/v1/contents/generations/tasks`，后端日志显示上游 URL = `{base}/contents/generations/tasks`，credits 预扣。
3. 轮询 → 确认 `GET /api/v1/contents/generations/tasks/:id?model=seedance-2.0` 返回 Ark 格式，前端正常解析 `succeeded`。
4. 生成中点「取消」→ 确认 `DELETE /api/v1/contents/generations/tasks/:id?model=seedance-2.0` 透传，任务停止。
5. 回归：旧路径 `POST /api/v1/videos`（OpenAI multipart 渠道）仍可用。

### 5.5 验证命令

- 后端：`go test ./service/...`（含新增 + 回归测试）。
- 后端编译：`go build ./...`。
- 前端：`cd web && bun run lint && bun run build`（或 `npm`，按现有 lockfile）。

## 涉及文件清单

**后端（新增 / 改动）：**
- `router/router.go` — 新增 4 个路由。
- `handler/video_tasks.go` — 新增文件，4 个 handler。
- `service/ai_proxy.go` — 末尾追加 `ProxyVideoTaskCreate` / `proxyVideoTaskPost` / `ProxyVideoTaskRemix` / `ProxyVideoTaskDelete`；不改动现有函数。
- `service/ai_proxy_test.go` — 追加 5 个测试。

**前端（新增 / 改动）：**
- `web/src/services/api/video.ts` — `seedanceApiUrl` channelMode 分流；`pollSeedanceTask` 带 `?model=`；新增 `cancelVideoGenerationTask` / `remixVideoGenerationTask` 导出。
- `web/src/app/(user)/video/page.tsx` — 引入 `cancelVideoGenerationTask`，「生成中」日志条目加取消按钮。

**不改动（隔离保证）：**
- `handler/ai.go`、`service/ai_proxy.go` 中 `ProxyAIRequest` / `ProxyAIGetRequest` / `resolveAIProxyPath` / `isArkSeedanceVideo` / `buildOpenAIUpstream` / `buildGeminiUpstream`。
- 前端 `createOpenAIVideoTask` / `pollOpenAIVideoTask`（OpenAI multipart `/videos` 路径）。
