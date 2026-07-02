# 使用日志功能修复与增强 - 设计文档

> 日期：2026-07-02
> 状态：待评审
> 关联：`docs/video-generation-api.md` (视频生成标准化接口)

---

## 1. 背景与问题

### 1.1 问题概述

当前平台"使用日志"功能存在三个核心缺陷：

| # | 问题 | 影响 |
|---|------|------|
| 1 | **统计维度不完整** — 画布中的文字/图片/音频生成未被纳入 `generation_tasks` 表 | 管理员无法看到完整的平台用量全貌 |
| 2 | **异步任务状态不更新** — 视频任务创建后状态始终为 `running`，实际已完成/失败却不回写 | 使用日志中视频任务的状态数据不可信 |
| 3 | **缺少用户名和删除功能** — 管理后台只显示 `userId` 没有 `username`，且无删除按钮 | 管理员难以识别用户，无法清理脏数据 |

### 1.2 架构原则（用户确认）

1. **ProxyAIRequest 是唯一的 AI 请求入口** — 所有 AI 生成必须经过后端代理
2. **generation_tasks 只能由 Proxy 创建和维护生命周期** — 业务层不负责创建任务记录
3. **业务层仅补充 metadata** — 通过轻量的元数据补充接口写入业务上下文（场景来源、画布节点 ID 等）
4. **异步状态同步采用轮询+回调混合策略** — 厂商支持回调的用 webhook，否则用后端轮询
5. **删除权限仅限管理员** — 管理员可在后台单条/批量删除

---

## 2. 当前系统分析

### 2.1 任务记录链路

```
同步任务（image/audio/chat）:
  业务前端 → Next.js /api/[...path] → 后端 ProxyAIRequest
    → LogTaskStart(status=running)
    → proxyCopyAIResponse
      → onSuccess: LogTaskSuccess(status=success, 写入 respBody)
      → onFailure: LogTaskFailure(status=failed) + refund

异步任务（video）:
  视频创作台 → Next.js /api/[...path] → 后端 ProxyVideoTaskCreate
    → LogTaskStart(status=running)
    → proxyVideoTaskPost
      → onSuccess: LogTaskCreated(status 仍为 running ❌, 仅写入 upstream_task_id)
      → onFailure: LogTaskFailure + refund
    → ❌ 无人轮询/callback 更新终态
```

### 2.2 当前 generation_tasks 表结构

```go
type GenerationTask struct {
    ID             string    `gorm:"primaryKey"`
    UserID         string    `gorm:"index"`
    TaskType       TaskType  `gorm:"index"`  // image|video|audio|chat
    Provider       string
    Model          string
    Status         TaskStatus               // pending|running|success|failed|cancelled
    Credits        int
    LatencyMs      int64
    UpstreamTaskID string
    TraceID        string
    ErrorCode      string
    ErrorMessage   string
    CreatedAt      string
    UpdatedAt      string
}
```

### 2.3 当前已覆盖的生成场景

| 场景 | 覆盖 | 不足 |
|------|------|------|
| 图片工作台（独立页面） | ✅ 通过 ProxyAIRequest | credits 在前端直写路径为 0 |
| 视频创作台（独立页面） | ✅ 通过 ProxyVideoTaskCreate | 状态不更新 |
| 音频生成（TTS） | ✅ 通过 ProxyAIRequest | — |
| 聊天/文本 | ✅ 通过 ProxyAIRequest | — |
| 画布-文字生成 | ❌ 若走本地 Agent 直连 | 无来源标记 |
| 画布-图片生成 | ❌ 若走本地 Agent 直连 | 无来源标记 |
| 画布-音频生成 | ❌ 若走本地 Agent 直连 | 无来源标记 |

---

## 3. 设计方案

### 3.1 模块 A：职责收敛与统计维度补全

#### 3.1.1 数据模型变更

`model/generation_task.go` — `GenerationTask` 新增字段：

```go
type GenerationTask struct {
    // ... 现有字段保持不变 ...

    // 新增字段
    Source   string `json:"source" gorm:"index"`   // 场景来源: "canvas"|"image_workbench"|"video_workbench"
    Metadata string `json:"metadata" gorm:"type:text"` // JSON 扩展元数据
}
```

`Source` 枚举：

```go
const (
    SourceCanvas          = "canvas"
    SourceImageWorkbench  = "image_workbench"
    SourceVideoWorkbench  = "video_workbench"
)
```

`Metadata` 示例（Canvas 场景）：
```json
{
    "canvas_project_id": "proj-xxx",
    "canvas_node_id": "image-12345-abcde",
    "generation_mode": "text2image"
}
```

#### 3.1.2 服务层变更

**`service/generation_service.go`：**

- `LogTaskStart` 签名扩展：
  ```go
  func LogTaskStart(user model.AuthUser, taskType model.TaskType, provider string,
      modelName string, reqBody []byte, reqHeaders string,
      source string, metadata string) (string, error)
  ```

- 新增 `UpdateTaskMetadata`：
  ```go
  func UpdateTaskMetadata(taskID string, userID string, metadata string) error
  ```
  调用 `repository.UpdateGenerationTask(taskID, updates)` 做所有权校验后更新。

- `DetermineTaskType` 不变 — 通过 API 路径推断类型已覆盖所有场景。

- `DetermineSource` 新增辅助函数（优先使用显式传入的 `X-Source` 头，fallback 到 Referer 推断）：
  ```go
  func DetermineSource(r *http.Request) string {
      // 1) 显式 header（最可靠）
      if src := r.Header.Get("X-Source"); src != "" { return src }
      // 2) Referer 推断（fallback）
      referer := r.Referer()
      if strings.Contains(referer, "/canvas") { return model.SourceCanvas }
      return model.DetermineSourceFromPath(r.URL.Path)
  }
  func DetermineSourceFromPath(path string) string {
      if strings.Contains(path, "/contents/generations/tasks") { return model.SourceVideoWorkbench }
      if strings.Contains(path, "/images/") { return model.SourceImageWorkbench }
      return ""
  }
  ```

**`service/ai_proxy.go`：**

- `ProxyAIRequest` 中调用 `LogTaskStart` 时传入 `DetermineSource(r)`
- `proxyVideoTaskPost` 同理 — 视频创作台由路径推断为 `SourceVideoWorkbench`

#### 3.1.3 API 层变更

**`handler/generation_tasks.go` — 新增端点：**

```
PATCH /api/v1/generation-tasks/:id/metadata
```

请求体：`{"metadata": "{...}"}`

逻辑：`UpdateTaskMetadata(id, user.ID, body.Metadata)` — 需要用户所有权校验，仅允许更新 `metadata` 字段。

> **安全约束**：此端点只接受 `metadata` 字段更新，禁止通过此接口修改 `status`、`credits`、`user_id` 等系统字段。

#### 3.1.4 前端变更

**Canvas 组件：**

1. `canvas-client-page.tsx` — 画布节点的 AI 生成确保走 Next.js API 代理：
   - 文字生成：POST `/api/chat/completions`（通过 `web/src/app/api/[...path]/route.ts` 代理到后端）
   - 图片生成：POST `/api/images/generations`
   - 音频生成：POST `/api/audio/speech`
   - 视频生成：POST `/api/contents/generations/tasks`

2. 生成完成后调用 `PATCH /api/v1/generation-tasks/:id/metadata` 补充画布上下文：
   ```typescript
   await patchGenerationTaskMetadata(taskId, JSON.stringify({
       canvas_project_id: projectId,
       canvas_node_id: currentNodeId,
       generation_mode: mode,
   }))
   ```

**现有 `POST /api/v1/generation-tasks`（RecordGenerationTask）端点：**
- 标记为 deprecated（通过注释），不再作为主动记录路径
- 保留兼容性，但不鼓励新代码使用
- 图片工作台现有的 `recordGenerationTask` 调用可以逐步迁移移除

#### 3.1.5 数据库迁移

```sql
ALTER TABLE generation_tasks ADD COLUMN source VARCHAR(32) DEFAULT '' AFTER task_type;
ALTER TABLE generation_tasks ADD COLUMN metadata TEXT AFTER error_message;
CREATE INDEX idx_generation_tasks_source ON generation_tasks(source);
```

---

### 3.2 模块 B：异步任务状态同步

#### 3.2.1 新增文件：`service/task_sync.go`

**核心类型与函数：**

```go
type TaskSyncMode string
const (
    TaskSyncPoll TaskSyncMode = "poll"
    TaskSyncCallback TaskSyncMode = "callback"
)

type TaskSyncConfig struct {
    TaskID         string
    UpstreamTaskID string
    GenTaskID      string       // generation_tasks 主键
    Channel        model.ModelChannel
    Mode           TaskSyncMode
    MaxRetries     int          // 默认 20
    PollIntervals  []time.Duration // [5s, 5s, 5s, 8s, 10s, 10s, ...] (起始 5s, 指数退避, 最大 10s)
}

// SyncTaskStatus 启动异步任务状态同步。
// 根据渠道是否支持 callback 自动选择模式。
func SyncTaskStatus(cfg TaskSyncConfig) {
    if cfg.Mode == TaskSyncCallback && cfg.Channel.SupportsCallback() {
        go waitForCallback(cfg)
    } else {
        go pollUntilTerminal(cfg)
    }
}

// CancelTaskSync 终止任务同步（取消任务时调用）。
func CancelTaskSync(genTaskID string)
```

**轮询逻辑 `pollUntilTerminal`：**
```
intervals = [5s, 5s, 5s, 8s, 10s, 10s, 10s, ..., 最多 20 次]  (起始 5s，指数退避，最大 10s)
for i, interval := range intervals {
    sleep(interval)
    status, result := queryUpstreamTask(cfg)
    if status is terminal (succeeded/failed/cancelled) {
        OnTaskCompleted(cfg.GenTaskID, status, result)
        return
    }
}
// 超时（~15 分钟，20 次轮询后）：最后一次标记为 failed
OnTaskCompleted(cfg.GenTaskID, TaskStatusFailed, TaskResult{
    ErrorCode: "TASK_SYNC_TIMEOUT",
    ErrorMessage: "任务状态同步超时",
})
```

**回调模式：**
- 在创建上游任务时设置 `callback_url` 参数（如果渠道支持）
- 回调 URL 格式：`{baseURL}/api/v1/generation-tasks/callback?token={callbackToken}`
- `callbackToken` 在 `LogTaskCreated` 时生成并存到 `generation_tasks` 表（复用或新增字段）

#### 3.2.2 统一终态回写 `OnTaskCompleted`

```go
func OnTaskCompleted(genTaskID string, status model.TaskStatus, result TaskResult) {
    updates := map[string]any{
        "status":     string(status),
        "updated_at": time.Now().Format(time.RFC3339),
    }
    if result.ErrorCode != "" {
        updates["error_code"] = result.ErrorCode
        updates["error_message"] = result.ErrorMessage
    }
    repository.UpdateGenerationTask(genTaskID, updates)

    // 更新 payload 响应数据
    if result.ResponseBody != "" {
        repository.UpdateGenerationPayload(genTaskID, result.ResponseBody, result.ResponseHeaders)
    }
}
```

#### 3.2.3 查询上游状态

复用电台已有的标准化查询能力（GET `/v1/contents/generations/tasks/:task_id`），通过直接调用各渠道适配器的查询方法，避免额外的 HTTP 调用开销：

```go
func queryUpstreamTask(cfg TaskSyncConfig) (model.TaskStatus, TaskResult) {
    // 直接调用对应 channel adapter 的查询方法
    // 利用 adapter 的 ConvertToArkResponse 获取标准化的 status
    adapter := GetChannelAdapter(cfg.Channel)
    arkResp, err := adapter.QueryTask(cfg.UpstreamTaskID)
    if err != nil {
        // 查询失败不算终态，继续轮询
        return model.TaskStatusRunning, TaskResult{}
    }
    return mapArkStatus(arkResp.Status), extractResult(arkResp)
}
```

#### 3.2.4 Webhook 回调端点

**`handler/task_callback.go` — 新增文件：**

```
POST /api/v1/generation-tasks/callback
```

- URL 参数：`token`（回调令牌，在创建上游任务时传入 `callback_url` 参数中）
- 请求体验证：
  1. 校验 `token` 是否有效（查 `generation_tasks` 表中匹配的 `callback_token`）
  2. 校验请求签名（如果厂商支持签名回调）
  3. 解析回调 body 中的 `status`、`result`
- 处理：
  1. 调用 `OnTaskCompleted(genTaskID, status, result)`
  2. 调用 `CancelTaskSync(genTaskID)` 终止关联的轮询 goroutine（如有）

#### 3.2.5 Model 变更

`model/generation_task.go` — 新增字段：

```go
CallbackToken string `json:"callbackToken,omitempty"`
```

`model/model_channel.go` — 新增方法：

```go
func (ch ModelChannel) SupportsCallback() bool {
    // Seedance/AIDrama 支持 callback_url
    // Vidu/Kuaizi 暂不支持
    return ch.Protocol == "aidrama"
}
```

**数据库迁移（模块 B 独立）：**

```sql
ALTER TABLE generation_tasks ADD COLUMN callback_token VARCHAR(64) DEFAULT '' AFTER upstream_task_id;
```

#### 3.2.6 API 代理变更

`service/ai_proxy.go:proxyVideoTaskPost` — 在 `LogTaskCreated` 成功后启动同步：

```go
// 在 onSuccess 回调中，LogTaskCreated 之后增加：
syncCfg := TaskSyncConfig{
    GenTaskID:      genTaskID,
    UpstreamTaskID: upstreamTaskID,
    Channel:        channel,
    Mode:           TaskSyncPoll, // 默认轮询
    MaxRetries:     20,
    PollIntervalMin: 5 * time.Second,
    PollIntervalMax: 10 * time.Second,
}
if channel.SupportsCallback() {
    syncCfg.Mode = TaskSyncCallback
}
SyncTaskStatus(syncCfg)
```

#### 3.2.7 Goroutine 管理

- 使用 `sync.Map` 存储 `genTaskID → context.CancelFunc`，支持取消
- 在 `ProxyVideoTaskDelete` 调用 `CancelTaskSync(genTaskID)` 终止轮询
- Goroutine 退出时自动清理 map 条目
- 服务重启时，已创建的 `running` 状态任务不会被重新调度（可接受 — 后续可考虑启动时扫描恢复，但非 MVP 必须）

---

### 3.3 模块 C：用户名展示 + 管理端删除

#### 3.3.1 后端变更

**Repository 层 `repository/generation_task.go`：**

新增 JOIN 查询和批量删除：

```go
// AdminGenerationTaskWithUser 管理端列表 DTO。
type AdminGenerationTaskWithUser struct {
    model.GenerationTask
    Username string `json:"username"`
}

// ListGenerationTasksWithUsername 管理员列表查询，JOIN users 表获取 username。
func ListGenerationTasksWithUsername(q model.GenerationTaskQuery) ([]AdminGenerationTaskWithUser, int64, error) {
    // SELECT gt.*, u.username FROM generation_tasks gt
    // LEFT JOIN users u ON gt.user_id = u.id
    // WHERE ... ORDER BY gt.created_at DESC LIMIT ... OFFSET ...
}

// DeleteGenerationTasks 管理员批量删除（无所有权校验）。
func DeleteGenerationTasks(ids []string) error {
    // 事务中删除 generation_payloads + generation_tasks
}
```

**Service 层 `service/generation_service.go`：**

```go
// AdminListTasksWithUsername 管理员查询（含用户名）。
func AdminListTasksWithUsername(q model.GenerationTaskQuery) (*AdminGenerationTaskListWithUser, error)

// AdminDeleteTask 管理员删除单条任务。
func AdminDeleteTask(taskID string) error

// AdminBatchDeleteTasks 管理员批量删除。
func AdminBatchDeleteTasks(ids []string) error
```

**Handler 层 `handler/generation_tasks.go`：**

- `AdminListGenerationTasks` — 改为调用 `AdminListTasksWithUsername`，返回含 `username` 的列表
- 新增 `AdminDeleteGenerationTask` — `DELETE /api/admin/generation-tasks/:id`
- 新增 `AdminBatchDeleteGenerationTasks` — `POST /api/admin/generation-tasks/batch-delete`

**Router 注册 `router/router.go`：**

```go
admin.GET("/generation-tasks", handler.AdminListGenerationTasks)
admin.GET("/generation-tasks/:id", handler.AdminGetGenerationTaskDetail)
admin.DELETE("/generation-tasks/:id", handler.AdminDeleteGenerationTask)        // 新增
admin.POST("/generation-tasks/batch-delete", handler.AdminBatchDeleteGenerationTasks) // 新增
```

#### 3.3.2 前端变更

**`web/src/services/api/admin.ts`：**

```typescript
export type AdminGenerationTask = {
    // ... 现有字段 ...
    username: string;  // 新增
};

// 新增 API 函数
export async function deleteAdminGenerationTask(token: string, id: string): Promise<boolean>
export async function batchDeleteAdminGenerationTasks(token: string, ids: string[]): Promise<boolean>
```

**`web/src/app/(admin)/admin/generation-tasks/page.tsx`：**

1. **新增"用户名"列**（在用户 ID 列之后）：
   ```tsx
   { title: "用户名", dataIndex: "username", width: 120,
     render: (_, item) => <Typography.Text>{item.username || "-"}</Typography.Text>
   }
   ```

2. **新增单条删除按钮**（操作列）：
   ```tsx
   <Tooltip title="删除"><Button type="text" size="small" danger
     icon={<DeleteOutlined />}
     onClick={() => handleDelete(item)}
   /></Tooltip>
   ```
   `handleDelete` 弹出 Modal.confirm 确认后调用 `deleteAdminGenerationTask(token, id)`。

3. **新增批量选择 + 批量删除**：
   - `ProTable` 配置 `rowSelection` 用于多选
   - 选中项 ≥1 时显示"批量删除"按钮
   - 点击弹出确认框显示选中数量，确认后调用 `batchDeleteAdminGenerationTasks`

**`web/src/app/(admin)/admin/generation-tasks/use-admin-generation-tasks.ts`：**

- 新增 `deleteTask(id)` / `batchDeleteTasks(ids)` 方法
- 使用 `useMutation` + `queryClient.invalidateQueries` 刷新列表
- 删除成功后 `message.success("已删除")`

---

## 4. 接口汇总

### 4.1 新增接口

| 方法 | 路径 | 用途 | 认证 |
|------|------|------|------|
| PATCH | `/api/v1/generation-tasks/:id/metadata` | 业务层补充元数据 | 用户 Token |
| POST | `/api/v1/generation-tasks/callback` | 厂商异步回调接收 | Token 参数 |
| DELETE | `/api/admin/generation-tasks/:id` | 管理员删除单条 | 管理员 Token |
| POST | `/api/admin/generation-tasks/batch-delete` | 管理员批量删除 | 管理员 Token |

### 4.2 变更接口

| 方法 | 路径 | 变更内容 |
|------|------|---------|
| GET | `/api/admin/generation-tasks` | 响应新增 `username` 字段 |
| POST | `/api/v1/generation-tasks` | 标记 deprecated |

---

## 5. 安全考量

| 模块 | 风险 | 缓解措施 |
|------|------|---------|
| A - metadata 补充 | 恶意写入任意 JSON | 仅允许更新 `metadata` 字段，size 限制 4KB |
| B - callback 端点 | 伪造回调请求 | `callbackToken` 随机生成（UUID），存储在 task 记录中，回调时校验 |
| B - 轮询 goroutine | 内存泄漏 | 统一管理 context + cancel，最大生命周期 20 轮后自动退出 |
| C - 批量删除 | 误删大量数据 | 前端二次确认，后端返回实际删除数量，日志记录操作人和时间 |

---

## 6. 测试策略

| 层次 | 覆盖内容 |
|------|---------|
| 单元测试 | `DetermineSource`、`LogTaskStart` 新签名、`OnTaskCompleted`、`pollUntilTerminal` 超时逻辑 |
| 集成测试 | callback webhook 校验、metadata 更新权限校验、批量删除事务 |
| E2E | Canvas 生成 → 自动记录 → 管理后台可见 → 状态同步 → 管理员删除 |

---

## 7. 实施顺序

建议分以下阶段实施，每个阶段独立可交付：

| 阶段 | 模块 | 预估工作量 | 依赖 |
|------|------|-----------|------|
| Phase 1 | 模块 C（用户名+删除） | 小 | 无 |
| Phase 2 | 模块 B（状态同步） | 中 | C 的 repository 批量删除可复用 |
| Phase 3 | 模块 A（职责收敛+Source/Metadata） | 大 | B 完成后的 Proxy 理解 |

Phase 1 先行可以快速解决最直观的用户体验问题，同时为后续改动铺好 repository 层基础。

---

## 8. 开放问题

1. **历史 `running` 任务处理**：部署 Phase 2 后，已有的 `running` 视频任务如何处理？建议：提供一次性脚本，对过去 N 天内 `status=running` 且有 `upstream_task_id` 的任务，查询一次上游状态并回写。不自动处理超老的任务（避免上游已清理导致 query 失败）。

2. **Canvas 本地 Agent 直连的迁移**：当前本地 Agent（Codex）通过 WebSocket 直连 AI 提供商，不经过后端。要纳入统计需要改为通过 Next.js API 路由代理，可能影响延迟。需要和用户确认是否接受。

3. **source 字段的 Referer 推断可靠性**：`DetermineSource` 用 HTTP Referer header 推断来源，但 Referer 可能被浏览器策略裁剪。建议同时接受请求头 `X-Source` 显式传入。
