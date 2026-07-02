# 使用日志功能修复与增强 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix usage log dimension gaps, async task status sync, and add username display + admin delete capabilities.

**Architecture:** Three independent phases. Phase 1 adds username JOIN + admin delete (smallest, no deps). Phase 2 adds backend task status polling/callback sync via new `service/task_sync.go`. Phase 3 adds `source`/`metadata` fields, `DetermineSource` helper, and metadata PATCH endpoint for Canvas context enrichment.

**Tech Stack:** Go (Gin + GORM), TypeScript (Next.js + Ant Design ProComponents), SQLite/MySQL

## Global Constraints

- `ProxyAIRequest` is the sole AI request entry point — all generation tasks are created and lifecycled there
- `generation_tasks` table is only written by Proxy; business layer may only PATCH `metadata`
- Async status sync uses polling (5s→10s exponential backoff, 20 retries, ~15 min timeout) + callback webhook (where supported)
- Delete is admin-only; no soft-delete
- `POST /api/v1/generation-tasks` (RecordGenerationTask) is deprecated but preserved

---

### Task 1: Repository — JOIN query with username + admin bulk delete

**Files:**
- Modify: `repository/generation_task.go:54-129`

**Interfaces:**
- Consumes: `model.GenerationTask`, `model.GenerationTaskQuery`, `model.User` (existing)
- Produces: `AdminGenerationTaskWithUser` struct, `ListGenerationTasksWithUsername()`, `AdminDeleteGenerationTasks()`

- [ ] **Step 1: Add `AdminGenerationTaskWithUser` DTO and JOIN query**

Add after the `DeleteGenerationTask` function (after line 119) in `repository/generation_task.go`:

```go
// AdminGenerationTaskWithUser 管理端列表 DTO，JOIN users 表获取 username。
type AdminGenerationTaskWithUser struct {
	model.GenerationTask
	Username string `json:"username"`
}

// ListGenerationTasksWithUsername 管理员列表查询，LEFT JOIN users 获取 username。
func ListGenerationTasksWithUsername(q model.GenerationTaskQuery) ([]AdminGenerationTaskWithUser, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := db.Table("generation_tasks gt").
		Select("gt.*, u.username").
		Joins("LEFT JOIN users u ON gt.user_id = u.id")

	if q.UserID != "" {
		tx = tx.Where("gt.user_id = ?", q.UserID)
	}
	if q.TaskType != "" {
		tx = tx.Where("gt.task_type = ?", q.TaskType)
	}
	if q.Status != "" {
		tx = tx.Where("gt.status = ?", q.Status)
	}
	if q.StartTime != "" {
		tx = tx.Where("gt.created_at >= ?", q.StartTime)
	}
	if q.EndTime != "" {
		tx = tx.Where("gt.created_at <= ?", q.EndTime)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var tasks []AdminGenerationTaskWithUser
	err = tx.Order("gt.created_at desc").Offset(q.Offset()).Limit(q.PageSize).Scan(&tasks).Error
	return tasks, total, err
}
```

- [ ] **Step 2: Add `AdminDeleteGenerationTasks` for admin batch delete (no ownership check)**

Add after the JOIN query in `repository/generation_task.go`:

```go
// AdminDeleteGenerationTasks 管理员批量删除任务及负载（无所有权校验）。
func AdminDeleteGenerationTasks(ids []string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	db, err := DB()
	if err != nil {
		return 0, err
	}
	var deleted int64
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("task_id IN ?", ids).Delete(&model.GenerationPayload{}).Error; err != nil {
			return err
		}
		result := tx.Where("id IN ?", ids).Delete(&model.GenerationTask{})
		if result.Error != nil {
			return result.Error
		}
		deleted = result.RowsAffected
		return nil
	})
	return deleted, err
}
```

- [ ] **Step 3: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: no compile errors

- [ ] **Step 4: Commit**

```bash
git add repository/generation_task.go
git commit -m "feat: add admin JOIN query with username and batch delete for generation tasks"
```

---

### Task 2: Service — admin list with username + admin delete wrappers

**Files:**
- Modify: `service/generation_service.go:163-211`

**Interfaces:**
- Consumes: `repository.AdminGenerationTaskWithUser`, `repository.ListGenerationTasksWithUsername`, `repository.AdminDeleteGenerationTasks`
- Produces: `AdminGenerationTaskListWithUser` type, `AdminListTasksWithUsername()`, `AdminDeleteTask()`, `AdminBatchDeleteTasks()`

- [ ] **Step 1: Add response DTO and replace `AdminListTasks`**

In `service/generation_service.go`, replace the existing `AdminListTasks` function and add new functions:

```go
// AdminGenerationTaskListWithUser 管理端任务列表（含用户名）。
type AdminGenerationTaskListWithUser struct {
	Items []repository.AdminGenerationTaskWithUser `json:"items"`
	Total int64                                    `json:"total"`
}

// AdminListTasksWithUsername 管理员查看所有用户的任务列表（含用户名）。
func AdminListTasksWithUsername(q model.GenerationTaskQuery) (*AdminGenerationTaskListWithUser, error) {
	tasks, total, err := repository.ListGenerationTasksWithUsername(q)
	if err != nil {
		return nil, err
	}
	return &AdminGenerationTaskListWithUser{Items: tasks, Total: total}, nil
}

// AdminDeleteTask 管理员删除单条任务（无所有权校验）。
func AdminDeleteTask(taskID string) error {
	_, err := repository.AdminDeleteGenerationTasks([]string{taskID})
	return err
}

// AdminBatchDeleteTasks 管理员批量删除任务。
func AdminBatchDeleteTasks(ids []string) (int64, error) {
	return repository.AdminDeleteGenerationTasks(ids)
}
```

Keep the old `AdminListTasks` function as-is (it may be used elsewhere or can be cleaned up later). Add the new functions above it.

- [ ] **Step 2: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: no compile errors

- [ ] **Step 3: Commit**

```bash
git add service/generation_service.go
git commit -m "feat: add admin list with username and admin delete service functions"
```

---

### Task 3: Handler — admin delete endpoints + wire username into list response

**Files:**
- Modify: `handler/generation_tasks.go:134-154`

**Interfaces:**
- Consumes: `service.AdminListTasksWithUsername`, `service.AdminDeleteTask`, `service.AdminBatchDeleteTasks`
- Produces: `AdminDeleteGenerationTask`, `AdminBatchDeleteGenerationTasks` handlers

- [ ] **Step 1: Update `AdminListGenerationTasks` to use username variant**

Replace the body of `AdminListGenerationTasks` (lines 148-153) in `handler/generation_tasks.go`:

```go
// AdminListGenerationTasks GET /api/admin/generation-tasks — 管理员查看所有用户的任务列表。
func AdminListGenerationTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	query := model.GenerationTaskQuery{
		UserID:    strings.TrimSpace(q.Get("user_id")),
		TaskType:  model.TaskType(strings.TrimSpace(q.Get("task_type"))),
		Status:    model.TaskStatus(strings.TrimSpace(q.Get("status"))),
		StartTime: q.Get("start_time"),
		EndTime:   q.Get("end_time"),
		Page:      page,
		PageSize:  pageSize,
	}
	result, err := service.AdminListTasksWithUsername(query)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
```

- [ ] **Step 2: Add `AdminDeleteGenerationTask` and `AdminBatchDeleteGenerationTasks`**

Add after `AdminGetGenerationTaskDetail` (after line 132) in `handler/generation_tasks.go`:

```go
// AdminDeleteGenerationTask DELETE /api/admin/generation-tasks/:id — 管理员删除单条任务。
func AdminDeleteGenerationTask(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.AdminDeleteTask(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

// AdminBatchDeleteGenerationTasks POST /api/admin/generation-tasks/batch-delete — 管理员批量删除。
func AdminBatchDeleteGenerationTasks(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		Fail(w, "参数格式错误")
		return
	}
	if len(req.IDs) == 0 {
		Fail(w, "请选择要删除的记录")
		return
	}
	deleted, err := service.AdminBatchDeleteTasks(req.IDs)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]any{"deleted": deleted})
}
```

Note: `json` and `net/http` are already imported in this file.

- [ ] **Step 3: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: no compile errors

- [ ] **Step 4: Commit**

```bash
git add handler/generation_tasks.go
git commit -m "feat: add admin delete and batch-delete handlers, wire username into list response"
```

---

### Task 4: Router — register admin delete routes

**Files:**
- Modify: `router/router.go:110-114`

**Interfaces:**
- Consumes: `handler.AdminDeleteGenerationTask`, `handler.AdminBatchDeleteGenerationTasks`
- Produces: new admin routes

- [ ] **Step 1: Add delete routes**

In `router/router.go`, add after line 113 (the existing `admin.GET("/generation-tasks/:id", ...)`):

```go
	admin.DELETE("/generation-tasks/:id", func(c *gin.Context) {
		handler.AdminDeleteGenerationTask(c.Writer, c.Request, c.Param("id"))
	})
	admin.POST("/generation-tasks/batch-delete", gin.WrapF(handler.AdminBatchDeleteGenerationTasks))
```

- [ ] **Step 2: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: no compile errors

- [ ] **Step 3: Commit**

```bash
git add router/router.go
git commit -m "feat: register admin generation-task delete and batch-delete routes"
```

---

### Task 5: Frontend API — add delete functions and username field

**Files:**
- Modify: `web/src/services/api/admin.ts:89-138`

**Interfaces:**
- Consumes: `apiDelete`, `apiPost` (existing imports)
- Produces: `deleteAdminGenerationTask()`, `batchDeleteAdminGenerationTasks()`, `username` on `AdminGenerationTask`

- [ ] **Step 1: Add `username` field to `AdminGenerationTask`**

In `web/src/services/api/admin.ts`, add `username` to the type (line 89-104):

```typescript
export type AdminGenerationTask = {
    id: string;
    userId: string;
    username: string;  // 新增：JOIN users 表获取
    taskType: string;
    provider: string;
    model: string;
    status: string;
    credits: number;
    latencyMs: number;
    upstreamTaskId: string;
    traceId: string;
    errorCode: string;
    errorMessage: string;
    createdAt: string;
    updatedAt: string;
};
```

- [ ] **Step 2: Add delete API functions**

Add after `fetchAdminGenerationTaskDetail` (after line 138):

```typescript
export async function deleteAdminGenerationTask(token: string, id: string): Promise<boolean> {
    return apiDelete<boolean>(`/api/admin/generation-tasks/${encodeURIComponent(id)}`, token);
}

export async function batchDeleteAdminGenerationTasks(token: string, ids: string[]): Promise<{ deleted: number }> {
    return apiPost<{ deleted: number }>("/api/admin/generation-tasks/batch-delete", { ids }, token);
}
```

- [ ] **Step 3: TypeScript compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas/web && npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 4: Commit**

```bash
git add web/src/services/api/admin.ts
git commit -m "feat: add username field and admin delete API functions for generation tasks"
```

---

### Task 6: Frontend Hook — add delete mutation

**Files:**
- Modify: `web/src/app/(admin)/admin/generation-tasks/use-admin-generation-tasks.ts:1-78`

**Interfaces:**
- Consumes: `deleteAdminGenerationTask`, `batchDeleteAdminGenerationTasks` from `@/services/api/admin`
- Produces: `deleteTask`, `batchDeleteTasks` in hook return

- [ ] **Step 1: Add imports for mutations**

Replace the import (line 7) to include `useMutation` and the new API functions:

```typescript
import { fetchAdminGenerationTasks, fetchAdminGenerationTaskDetail, deleteAdminGenerationTask, batchDeleteAdminGenerationTasks, type AdminGenerationTask } from "@/services/api/admin";
```

The `useMutation` import from `@tanstack/react-query` should already be there (check line 4). If not, add it:
```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
```

- [ ] **Step 2: Add delete mutations and return values**

Add inside the hook function body, before the `return` statement (before line 50):

```typescript
const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdminGenerationTask(token, id),
    onSuccess: () => {
        message.success("已删除");
        queryClient.invalidateQueries({ queryKey: ["admin", "generation-tasks"] });
    },
    onError: (error: Error) => {
        message.error(error.message || "删除失败");
    },
});

const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => batchDeleteAdminGenerationTasks(token, ids),
    onSuccess: (data) => {
        message.success(`已删除 ${data?.deleted || 0} 条记录`);
        queryClient.invalidateQueries({ queryKey: ["admin", "generation-tasks"] });
    },
    onError: (error: Error) => {
        message.error(error.message || "批量删除失败");
    },
});
```

Add to the return object (after `fetchDetail`):

```typescript
deleteTask: (id: string) => deleteMutation.mutate(id),
batchDeleteTasks: (ids: string[]) => batchDeleteMutation.mutate(ids),
isDeleting: deleteMutation.isPending || batchDeleteMutation.isPending,
```

- [ ] **Step 3: TypeScript compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas/web && npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(admin\)/admin/generation-tasks/use-admin-generation-tasks.ts
git commit -m "feat: add delete mutations to admin generation tasks hook"
```

---

### Task 7: Frontend Page — username column + delete buttons + batch selection

**Files:**
- Modify: `web/src/app/(admin)/admin/generation-tasks/page.tsx:55-375`

**Interfaces:**
- Consumes: `deleteTask`, `batchDeleteTasks`, `isDeleting` from hook
- Produces: username column, delete action buttons, batch row selection UI

- [ ] **Step 1: Add `DeleteOutlined` to ant-design imports**

At line 3, add `DeleteOutlined`:

```typescript
import { DeleteOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
```

- [ ] **Step 2: Destructure new hook return values**

On line 43, update the destructure to include the new functions:

```typescript
const { tasks, keyword, taskType, status, page, pageSize, total, isLoading, isDeleting, searchLogs, filterByType, filterByStatus, changePage, changePageSize, resetFilters, refreshLogs, fetchDetail, deleteTask, batchDeleteTasks } =
    useAdminGenerationTasks();
```

- [ ] **Step 3: Add delete handlers and row selection state**

Add after line 46 (`const [detail, setDetail] = ...`):

```typescript
const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

const handleDelete = (item: AdminGenerationTask) => {
    Modal.confirm({
        title: "确认删除",
        content: `确定删除该条使用日志吗？用户: ${item.username || item.userId}, 模型: ${item.model}`,
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: () => deleteTask(item.id),
    });
};

const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
        title: "确认批量删除",
        content: `确定删除选中的 ${selectedRowKeys.length} 条使用日志吗？此操作不可恢复。`,
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: () => {
            batchDeleteTasks(selectedRowKeys);
            setSelectedRowKeys([]);
        },
    });
};
```

- [ ] **Step 4: Add "用户名" column**

Insert after the "用户 ID" column (after line 65) in the columns array:

```typescript
{
    title: "用户名",
    dataIndex: "username",
    width: 120,
    render: (_, item) => (
        <Typography.Text>{item.username || "-"}</Typography.Text>
    ),
},
```

- [ ] **Step 5: Add delete button to actions column**

Replace the actions column render (lines 128-133):

```typescript
render: (_, item) => (
    <Space size={0}>
        <Tooltip title="查看详情">
            <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => void openDetail(item)} />
        </Tooltip>
        <Tooltip title="删除">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} loading={isDeleting} onClick={() => handleDelete(item)} />
        </Tooltip>
    </Space>
),
```

Also update the actions column `width` from `72` to `108` to fit two buttons.

- [ ] **Step 6: Add rowSelection and batch delete button to ProTable**

On the `ProTable` component (line 206), add `rowSelection`:

```tsx
rowSelection={{
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys as string[]),
}}
```

Update the `headerTitle` to show a batch delete button when items are selected (replace lines 217-221):

```tsx
headerTitle={
    <Space>
        <Typography.Text strong>使用日志</Typography.Text>
        <Tag>{total} 条</Tag>
        {selectedRowKeys.length > 0 && (
            <Button size="small" danger icon={<DeleteOutlined />} loading={isDeleting} onClick={handleBatchDelete}>
                删除选中 ({selectedRowKeys.length})
            </Button>
        )}
    </Space>
}
```

- [ ] **Step 7: Import Modal**

Ensure `Modal` is imported from `antd` at line 5. The current import is:
```typescript
import { Button, Card, Col, Form, Input, Modal, Row, Select, Space, Tag, Tooltip, Typography } from "antd";
```
`Modal` is already imported. No change needed.

- [ ] **Step 8: TypeScript compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas/web && npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 9: Commit**

```bash
git add web/src/app/\(admin\)/admin/generation-tasks/page.tsx
git commit -m "feat: add username column, single/batch delete to admin generation tasks page"
```

---

### Task 8: Model — add CallbackToken field + SupportsCallback method

**Files:**
- Modify: `model/generation_task.go:25-40`
- Modify: `model/setting.go:13-23`

**Interfaces:**
- Consumes: existing `GenerationTask` struct, `ModelChannel` struct
- Produces: `CallbackToken` field, `SupportsCallback()` method

- [ ] **Step 1: Add `CallbackToken` to `GenerationTask`**

In `model/generation_task.go`, add the field after `UpstreamTaskID` (after line 34):

```go
CallbackToken  string     `json:"callbackToken,omitempty"`
```

- [ ] **Step 2: Add `SupportsCallback` method**

In `model/setting.go`, add after the `ModelChannel` struct (after line 23):

```go
// SupportsCallback 判断渠道是否支持异步回调通知。
func (ch ModelChannel) SupportsCallback() bool {
	return ch.Protocol == "aidrama"
}
```

- [ ] **Step 3: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: no compile errors

- [ ] **Step 4: Commit**

```bash
git add model/generation_task.go model/setting.go
git commit -m "feat: add CallbackToken field and SupportsCallback to model"
```

---

### Task 9: Database — migration for callback_token

**Files:**
- Create/modify: `repository/db.go` (or migration file pattern used by the project)

Check the project's migration approach first. If using GORM AutoMigrate, the new field on the struct will be picked up automatically on next restart. Otherwise, write the raw SQL.

For SQL-based migration, create `migrations/003_add_callback_token.sql`:

```sql
ALTER TABLE generation_tasks ADD COLUMN callback_token VARCHAR(64) DEFAULT '';
```

If using GORM AutoMigrate and the field is on the struct, no explicit SQL needed beyond the model change in Task 8.

- [ ] **Step 1: Verify migration approach**

Run: `grep -r "AutoMigrate\|migrat" repository/db.go`
Check if the project uses GORM AutoMigrate.

- [ ] **Step 2: Apply migration**

If AutoMigrate: the field added in Task 8 is sufficient.
If manual SQL: ensure the SQL runs before deploy.

- [ ] **Step 3: Commit**

```bash
# If needed:
git add migrations/003_add_callback_token.sql
git commit -m "chore: add callback_token column migration"
```

---

### Task 10: Service — task sync engine (new file)

**Files:**
- Create: `service/task_sync.go`

**Interfaces:**
- Consumes: `model.GenerationTask`, `model.TaskStatus`, `model.ModelChannel`, `repository.UpdateGenerationTask`, `repository.UpdateGenerationPayload` (new, see below), channel adapter query methods
- Produces: `TaskSyncConfig`, `SyncTaskStatus()`, `CancelTaskSync()`, `OnTaskCompleted()`, `TaskResult`

- [ ] **Step 1: Add `UpdateGenerationPayload` to repository**

First, add a helper in `repository/generation_task.go` (after line 98):

```go
// UpdateGenerationPayload 更新任务的响应负载。
func UpdateGenerationPayload(taskID string, respBody string, respHeaders string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.GenerationPayload{}).Where("task_id = ?", taskID).
		Updates(map[string]any{
			"response_body":    respBody,
			"response_headers": respHeaders,
		}).Error
}
```

- [ ] **Step 2: Create `service/task_sync.go`**

```go
package service

import (
	"context"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

type TaskSyncMode string

const (
	TaskSyncPoll     TaskSyncMode = "poll"
	TaskSyncCallback TaskSyncMode = "callback"
)

// TaskSyncConfig 任务状态同步配置。
type TaskSyncConfig struct {
	GenTaskID       string             // generation_tasks 主键
	UpstreamTaskID  string             // 上游厂商任务 ID
	Channel         model.ModelChannel // 渠道配置
	Mode            TaskSyncMode       // poll 或 callback
	MaxRetries      int                // 最大轮询次数，默认 20
	PollIntervalMin time.Duration      // 起始轮询间隔，默认 5s
	PollIntervalMax time.Duration      // 最大轮询间隔，默认 10s
	CallbackToken   string             // 回调验证令牌
}

// TaskResult 任务终态结果。
type TaskResult struct {
	ErrorCode       string
	ErrorMessage    string
	ResponseBody    string
	ResponseHeaders string
}

// DefaultTaskSyncConfig 返回默认配置。
func DefaultTaskSyncConfig() TaskSyncConfig {
	return TaskSyncConfig{
		Mode:            TaskSyncPoll,
		MaxRetries:      20,
		PollIntervalMin: 5 * time.Second,
		PollIntervalMax: 10 * time.Second,
	}
}

var (
	taskSyncCancels sync.Map // genTaskID → context.CancelFunc
)

// SyncTaskStatus 启动异步任务状态同步。
func SyncTaskStatus(cfg TaskSyncConfig) {
	if cfg.MaxRetries <= 0 {
		cfg.MaxRetries = 20
	}
	if cfg.PollIntervalMin <= 0 {
		cfg.PollIntervalMin = 5 * time.Second
	}
	if cfg.PollIntervalMax <= 0 {
		cfg.PollIntervalMax = 10 * time.Second
	}
	if cfg.CallbackToken == "" {
		cfg.CallbackToken = fmt.Sprintf("cbtok-%s", cfg.GenTaskID)
		// persist callback token so webhook handler can validate
		repository.UpdateGenerationTask(cfg.GenTaskID, map[string]any{
			"callback_token": cfg.CallbackToken,
		})
	}

	if cfg.Mode == TaskSyncCallback && cfg.Channel.SupportsCallback() {
		go waitForCallback(cfg)
	} else {
		go pollUntilTerminal(cfg)
	}
}

// CancelTaskSync 终止任务同步（取消任务时调用）。
func CancelTaskSync(genTaskID string) {
	if cancel, ok := taskSyncCancels.LoadAndDelete(genTaskID); ok {
		cancel.(context.CancelFunc)()
	}
}

// pollUntilTerminal 轮询上游直到任务进入终态。
func pollUntilTerminal(cfg TaskSyncConfig) {
	ctx, cancel := context.WithCancel(context.Background())
	taskSyncCancels.Store(cfg.GenTaskID, cancel)
	defer taskSyncCancels.Delete(cfg.GenTaskID)

	for i := 0; i < cfg.MaxRetries; i++ {
		// 计算退避间隔：max(cfg.PollIntervalMin, min(cfg.PollIntervalMax, min*2^(i-2)))
		interval := cfg.PollIntervalMin
		if i >= 2 {
			backoff := time.Duration(math.Min(
				float64(cfg.PollIntervalMax),
				float64(cfg.PollIntervalMin)*math.Pow(2, float64(i-2)),
			))
			interval = backoff
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}

		status, result := queryUpstreamTask(cfg)
		if status == model.TaskStatusSuccess || status == model.TaskStatusFailed || status == model.TaskStatusCancelled {
			OnTaskCompleted(cfg.GenTaskID, status, result)
			return
		}
	}

	// 超时：标记为失败
	OnTaskCompleted(cfg.GenTaskID, model.TaskStatusFailed, TaskResult{
		ErrorCode:    "TASK_SYNC_TIMEOUT",
		ErrorMessage: "任务状态同步超时",
	})
}

// waitForCallback 等待厂商回调（占位轮询 fallback）。
func waitForCallback(cfg TaskSyncConfig) {
	// 存储 callback_token 供 webhook 验证
	// 启动一个长超时轮询作为 fallback（厂商可能不回调）
	pollUntilTerminal(cfg)
}

// queryUpstreamTask 通过渠道适配器查询上游任务状态。
func queryUpstreamTask(cfg TaskSyncConfig) (model.TaskStatus, TaskResult) {
	adapter, err := GetTaskAdapter(cfg.Channel)
	if err != nil {
		log.Printf("task_sync: get adapter failed: genTask=%s err=%v", cfg.GenTaskID, err)
		return model.TaskStatusRunning, TaskResult{}
	}

	arkResp, err := adapter.QueryTask(cfg.UpstreamTaskID)
	if err != nil {
		log.Printf("task_sync: query upstream failed: genTask=%s upstream=%s err=%v", cfg.GenTaskID, cfg.UpstreamTaskID, err)
		return model.TaskStatusRunning, TaskResult{}
	}

	status := mapArkStatusToModel(arkResp.Status)
	result := TaskResult{
		ErrorCode:    arkResp.ErrorCode,
		ErrorMessage: arkResp.ErrorMessage,
		ResponseBody: arkResp.RawBody,
	}
	return status, result
}

// mapArkStatusToModel 将 Ark 响应状态映射为 model.TaskStatus。
func mapArkStatusToModel(status string) model.TaskStatus {
	switch status {
	case "succeeded":
		return model.TaskStatusSuccess
	case "failed":
		return model.TaskStatusFailed
	case "cancelled":
		return model.TaskStatusCancelled
	case "running", "queued":
		return model.TaskStatusRunning
	default:
		return model.TaskStatusRunning
	}
}

// OnTaskCompleted 统一终态回写。
func OnTaskCompleted(genTaskID string, status model.TaskStatus, result TaskResult) {
	now := time.Now().Format(time.RFC3339)
	updates := map[string]any{
		"status":     string(status),
		"updated_at": now,
	}
	if result.ErrorCode != "" {
		updates["error_code"] = result.ErrorCode
		updates["error_message"] = result.ErrorMessage
	}
	if err := repository.UpdateGenerationTask(genTaskID, updates); err != nil {
		log.Printf("task_sync: update failed: genTask=%s err=%v", genTaskID, err)
	}

	if result.ResponseBody != "" {
		if err := repository.UpdateGenerationPayload(genTaskID, result.ResponseBody, result.ResponseHeaders); err != nil {
			log.Printf("task_sync: update payload failed: genTask=%s err=%v", genTaskID, err)
		}
	}

	// 清理取消上下文
	taskSyncCancels.Delete(genTaskID)
}
```

**Note:** `GetTaskAdapter` is a placeholder that needs to bridge to the existing channel adapter system. For MVP, implement it as a lookup function that finds the right adapter based on `ModelChannel.Protocol`. If the adapter system isn't directly callable, fall back to making an internal HTTP request to `GET /v1/contents/generations/tasks/:task_id`.

- [ ] **Step 3: Implement adapter lookup via HTTP fallback**

Since `resolveUpstreamRequest` in `service/ai_proxy.go` is unexported, add a helper directly in `task_sync.go` that constructs the GET request to the upstream using the channel config:

Add to `service/task_sync.go` after the `queryUpstreamTask` function:

```go
// queryUpstreamTaskViaHTTP 通过 HTTP GET 查询上游任务状态。
func queryUpstreamTaskViaHTTP(cfg TaskSyncConfig) (model.TaskStatus, TaskResult) {
	path := fmt.Sprintf("/v1/contents/generations/tasks/%s", cfg.UpstreamTaskID)
	targetURL := strings.TrimRight(cfg.Channel.BaseURL, "/") + path

	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return model.TaskStatusRunning, TaskResult{}
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Channel.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("task_sync: HTTP query failed: genTask=%s url=%s err=%v", cfg.GenTaskID, targetURL, err)
		return model.TaskStatusRunning, TaskResult{}
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Error  *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	json.Unmarshal(body, &result)

	status := mapArkStatusToModel(result.Status)
	taskResult := TaskResult{ResponseBody: string(body)}
	if result.Error != nil {
		taskResult.ErrorCode = result.Error.Code
		taskResult.ErrorMessage = result.Error.Message
	}
	return status, taskResult
}
```

Replace the `queryUpstreamTask` body to call `queryUpstreamTaskViaHTTP`:

```go
func queryUpstreamTask(cfg TaskSyncConfig) (model.TaskStatus, TaskResult) {
	return queryUpstreamTaskViaHTTP(cfg)
}
```

Update imports in `service/task_sync.go` to add: `"encoding/json"`, `"io"`, `"net/http"`, `"strings"`.

- [ ] **Step 4: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: resolve compile errors (imports, `resolveUpstreamRequest` visibility, etc.)

- [ ] **Step 5: Commit**

```bash
git add service/task_sync.go repository/generation_task.go
git commit -m "feat: add async task status sync engine with polling and callback modes"
```

---

### Task 11: Handler — webhook callback endpoint

**Files:**
- Create: `handler/task_callback.go`

**Interfaces:**
- Consumes: `service.OnTaskCompleted`, `service.CancelTaskSync`, `repository.GetGenerationTaskByID`
- Produces: `HandleTaskCallback` handler

- [ ] **Step 1: Create callback handler**

Create `handler/task_callback.go`:

```go
package handler

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/service"
)

// HandleTaskCallback POST /api/v1/generation-tasks/callback — 厂商异步任务完成回调。
func HandleTaskCallback(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		Fail(w, "缺少回调令牌")
		return
	}

	// 查找匹配 callback_token 的任务
	// 注意：需要 repository 层提供按 callback_token 查询的能力
	genTaskID, err := repository.GetGenerationTaskByCallbackToken(token)
	if err != nil || genTaskID == "" {
		log.Printf("task_callback: invalid token: %s err=%v", token, err)
		Fail(w, "无效的回调令牌")
		return
	}

	var body struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Error  *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		Content map[string]any `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		Fail(w, "请求格式错误")
		return
	}

	status := model.TaskStatusRunning
	switch body.Status {
	case "succeeded":
		status = model.TaskStatusSuccess
	case "failed":
		status = model.TaskStatusFailed
	case "cancelled":
		status = model.TaskStatusCancelled
	default:
		status = model.TaskStatusRunning
	}

	respBody, _ := json.Marshal(body)
	result := service.TaskResult{
		ResponseBody: string(respBody),
	}
	if body.Error != nil {
		result.ErrorCode = body.Error.Code
		result.ErrorMessage = body.Error.Message
	}

	service.OnTaskCompleted(genTaskID, status, result)
	service.CancelTaskSync(genTaskID)

	OK(w, true)
}
```

- [ ] **Step 2: Add `GetGenerationTaskByCallbackToken` to repository**

In `repository/generation_task.go`, add:

```go
// GetGenerationTaskByCallbackToken 根据回调令牌查找任务。
func GetGenerationTaskByCallbackToken(token string) (string, error) {
	db, err := DB()
	if err != nil {
		return "", err
	}
	var task model.GenerationTask
	result := db.Where("callback_token = ?", token).Select("id").First(&task)
	if result.Error != nil {
		return "", result.Error
	}
	return task.ID, nil
}
```

- [ ] **Step 3: Register route in router**

In `router/router.go`, add in the v1 group (near line 62):

```go
v1.POST("/generation-tasks/callback", gin.WrapF(handler.HandleTaskCallback))
```

- [ ] **Step 4: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: no compile errors

- [ ] **Step 5: Commit**

```bash
git add handler/task_callback.go repository/generation_task.go router/router.go
git commit -m "feat: add webhook callback endpoint for async video task completion"
```

---

### Task 12: Wire task sync into video task creation

**Files:**
- Modify: `service/ai_proxy.go:528-540`

**Interfaces:**
- Consumes: `service.SyncTaskStatus`, `service.DefaultTaskSyncConfig`
- Produces: automated sync launch after video task creation

- [ ] **Step 1: Add `SyncTaskStatus` call in onSuccess callback**

In `service/ai_proxy.go`, modify the `onSuccess` callback in `proxyVideoTaskPost` (lines 528-540). After `LogTaskCreated`, add:

```go
func(respBody []byte, respHeaders string) {
    latencyMs := time.Since(startTime).Milliseconds()
    upstreamTaskID := ExtractUpstreamTaskID(respBody)
    proxyAILogf("video task created: genTaskID=%s upstreamTaskID=%s latency=%dms", genTaskID, upstreamTaskID, latencyMs)
    // Async task — created but still running; poll to completion
    LogTaskCreated(genTaskID, upstreamTaskID, latencyMs, credits)
    // ── 视频任务所有权映射 ──
    if upstreamTaskID != "" {
        if err := SaveVideoTask(user.ID, upstreamTaskID, modelName); err != nil {
            proxyAILogf("video task save ownership failed: user=%s task=%s err=%v", user.ID, upstreamTaskID, err)
        }
    }
    // ── 启动异步状态同步 ──
    if upstreamTaskID != "" {
        syncCfg := DefaultTaskSyncConfig()
        syncCfg.GenTaskID = genTaskID
        syncCfg.UpstreamTaskID = upstreamTaskID
        syncCfg.Channel = channel
        SyncTaskStatus(syncCfg)
    }
},
```

- [ ] **Step 2: Add `CancelTaskSync` call in ProxyVideoTaskDelete**

Find the `ProxyVideoTaskDelete` function in `service/ai_proxy.go` and add after the cancellation logic:

```go
// After successful upstream cancel, also cancel our sync:
CancelTaskSync(genTaskID)
```

If `ProxyVideoTaskDelete` doesn't have access to `genTaskID` (it only has `upstreamTaskID`), add a helper to look up `genTaskID` by `upstreamTaskID`.

- [ ] **Step 3: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: no compile errors

- [ ] **Step 4: Commit**

```bash
git add service/ai_proxy.go
git commit -m "feat: wire task status sync into video task creation and cancellation"
```

---

### Task 13: Model — add Source and Metadata fields + DetermineSource

**Files:**
- Modify: `model/generation_task.go:6-40`
- Modify: `service/generation_service.go:14-28`

**Interfaces:**
- Consumes: existing `GenerationTask` struct
- Produces: `Source` constants, `Source` field, `Metadata` field, `DetermineSource()`, `DetermineSourceFromPath()`

- [ ] **Step 1: Add Source constants and fields**

In `model/generation_task.go`, add source constants after TaskType constants (after line 11):

```go
// Source 生成任务来源场景。
type Source string

const (
	SourceCanvas         Source = "canvas"
	SourceImageWorkbench Source = "image_workbench"
	SourceVideoWorkbench Source = "video_workbench"
)
```

Add `Source` and `Metadata` fields to `GenerationTask` struct (after `TaskType`, and after `ErrorMessage`):

```go
Source         string     `json:"source" gorm:"index"`   // 场景来源
// ... existing fields ...
Metadata       string     `json:"metadata" gorm:"type:text"` // JSON 扩展元数据
```

- [ ] **Step 2: Add DetermineSource helper**

In `service/generation_service.go`, add:

```go
// DetermineSource 根据请求头推断生成来源（优先 X-Source，fallback Referer/路径）。
func DetermineSource(r *http.Request) string {
	// 1) 显式 header（最可靠）
	if src := r.Header.Get("X-Source"); src != "" {
		return src
	}
	// 2) Referer 推断（fallback）
	referer := r.Referer()
	if strings.Contains(referer, "/canvas") {
		return string(model.SourceCanvas)
	}
	return model.DetermineSourceFromPath(r.URL.Path)
}

// DetermineSourceFromPath 根据 API 路径推断来源。
func DetermineSourceFromPath(path string) string {
	if strings.Contains(path, "/contents/generations/tasks") {
		return string(model.SourceVideoWorkbench)
	}
	if strings.Contains(path, "/images/") {
		return string(model.SourceImageWorkbench)
	}
	return ""
}
```

Note: `net/http` needs to be imported if not already, and `strings` is already imported.

- [ ] **Step 3: Extend LogTaskStart signature**

Update `LogTaskStart` in `service/generation_service.go`:

```go
func LogTaskStart(user model.AuthUser, taskType model.TaskType, provider string,
	modelName string, reqBody []byte, reqHeaders string,
	source string, metadata string) (string, error) {
	id := "gentask-" + uuid.NewString()
	now := time.Now().Format(time.RFC3339)

	task := model.GenerationTask{
		ID:        id,
		UserID:    user.ID,
		TaskType:  taskType,
		Provider:  provider,
		Model:     modelName,
		Status:    model.TaskStatusRunning,
		Source:    source,
		Metadata:  metadata,
		CreatedAt: now,
		UpdatedAt: now,
	}
	// ... rest unchanged ...
}
```

- [ ] **Step 4: Update callers of LogTaskStart**

In `service/ai_proxy.go`:

`ProxyAIRequest` (line 65):
```go
source := DetermineSource(r)
genTaskID, _ := LogTaskStart(user, taskType, provider, modelName, body, SerializeHeaders(resolved.Headers), source, "")
```

`proxyVideoTaskPost` (line 514):
```go
genTaskID, _ := LogTaskStart(user, taskType, provider, modelName, body, SerializeHeaders(resolved.Headers), string(model.SourceVideoWorkbench), "")
```

- [ ] **Step 5: Add UpdateTaskMetadata service function**

In `service/generation_service.go`:

```go
// UpdateTaskMetadata 业务层补充任务元数据（所有权校验，仅允许更新 metadata 字段）。
func UpdateTaskMetadata(taskID string, userID string, metadata string) error {
	// 校验所有权
	_, err := repository.GetGenerationTaskByIDAndUser(taskID, userID)
	if err != nil {
		return err
	}
	// 限制 metadata 大小
	if len(metadata) > 4096 {
		return fmt.Errorf("metadata too large: %d bytes (max 4096)", len(metadata))
	}
	return repository.UpdateGenerationTask(taskID, map[string]any{
		"metadata":   metadata,
		"updated_at": time.Now().Format(time.RFC3339),
	})
}
```

- [ ] **Step 6: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: fix compile errors from callers of LogTaskStart that need the new signature

- [ ] **Step 7: Commit**

```bash
git add model/generation_task.go service/generation_service.go service/ai_proxy.go
git commit -m "feat: add Source and Metadata fields, DetermineSource helper, UpdateTaskMetadata"
```

---

### Task 14: Handler — metadata PATCH endpoint

**Files:**
- Modify: `handler/generation_tasks.go:94-121`
- Modify: `router/router.go:56-64`

**Interfaces:**
- Consumes: `service.UpdateTaskMetadata`
- Produces: `UpdateGenerationTaskMetadata` handler, new route

- [ ] **Step 1: Add handler**

Add after `RecordGenerationTask` in `handler/generation_tasks.go`:

```go
// UpdateGenerationTaskMetadata PATCH /api/v1/generation-tasks/:id/metadata — 业务层补充元数据。
func UpdateGenerationTaskMetadata(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var body struct {
		Metadata string `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		Fail(w, "参数格式错误")
		return
	}
	// 校验 metadata 是合法 JSON
	if body.Metadata != "" {
		var js json.RawMessage
		if err := json.Unmarshal([]byte(body.Metadata), &js); err != nil {
			Fail(w, "metadata 必须是合法的 JSON 字符串")
			return
		}
	}
	if err := service.UpdateTaskMetadata(id, user.ID, body.Metadata); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
```

- [ ] **Step 2: Register route**

In `router/router.go`, add in the v1 group:

```go
v1.PATCH("/generation-tasks/:id/metadata", func(c *gin.Context) {
    handler.UpdateGenerationTaskMetadata(c.Writer, c.Request, c.Param("id"))
})
```

Note: Gin's default router doesn't support `PATCH` natively in the same pattern. Use `v1.Handle("PATCH", "/generation-tasks/:id/metadata", gin.WrapF(func(w http.ResponseWriter, r *http.Request) {
    // extract id from URL path
    parts := strings.Split(r.URL.Path, "/")
    id := parts[len(parts)-2] // .../metadata
    handler.UpdateGenerationTaskMetadata(w, r, id)
}))`.

Or simpler: use `POST` instead of `PATCH`:
```go
v1.POST("/generation-tasks/:id/metadata", func(c *gin.Context) {
    handler.UpdateGenerationTaskMetadata(c.Writer, c.Request, c.Param("id"))
})
```

- [ ] **Step 3: Compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas && go build ./...`
Expected: no compile errors

- [ ] **Step 4: Commit**

```bash
git add handler/generation_tasks.go router/router.go
git commit -m "feat: add PATCH endpoint for business layer metadata enrichment"
```

---

### Task 15: Database — migration for source and metadata columns

**Files:**
- SQL or GORM AutoMigrate

Same approach as Task 9. If using AutoMigrate, the struct changes in Task 13 handle it. Otherwise:

```sql
ALTER TABLE generation_tasks ADD COLUMN source VARCHAR(32) DEFAULT '' AFTER task_type;
ALTER TABLE generation_tasks ADD COLUMN metadata TEXT AFTER error_message;
CREATE INDEX idx_generation_tasks_source ON generation_tasks(source);
```

- [ ] **Step 1: Apply migration**

- [ ] **Step 2: Commit**

```bash
git add migrations/004_add_source_metadata.sql
git commit -m "chore: add source and metadata column migration"
```

---

### Task 16: Frontend — Canvas metadata reporting + API function

**Files:**
- Modify: `web/src/services/api/generation-tasks.ts:100-126`
- Modify: Canvas generation file (use `mcp__codegraph__codegraph_explore` to find the exact file that calls the generation API)

**Interfaces:**
- Consumes: generation task ID from proxy response
- Produces: `patchGenerationTaskMetadata()` API function

- [ ] **Step 1: Add API function**

In `web/src/services/api/generation-tasks.ts`, add after `deleteGenerationTask` (line 103):

```typescript
export async function patchGenerationTaskMetadata(taskId: string, metadata: string): Promise<boolean> {
    const token = authToken();
    return apiPost<boolean>(`/api/v1/generation-tasks/${encodeURIComponent(taskId)}/metadata`, { metadata }, token);
}
```

- [ ] **Step 2: Return genTaskID in proxy response header**

Modify `ProxyAIRequest` in `service/ai_proxy.go` to add a response header with the generation task ID before calling `proxyCopyAIResponse`. This allows the frontend to read it from the proxy response:

In `ProxyAIRequest` (around line 65), add after `genTaskID, _ := LogTaskStart(...)`:

```go
// Add generation task ID header so frontend can enrich metadata
w.Header().Set("X-Generation-Task-Id", genTaskID)
```

Do the same in `proxyVideoTaskPost` after line 514.

- [ ] **Step 3: Read header in Next.js proxy and expose to frontend**

In `web/src/app/api/[...path]/route.ts`, update `responseHeaders` to preserve the custom header:

```typescript
function responseHeaders(response: Response) {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    // Preserve generation task ID header for metadata enrichment
    const genTaskId = response.headers.get("x-generation-task-id");
    if (genTaskId) headers.set("x-generation-task-id", genTaskId);
    return headers;
}
```

- [ ] **Step 4: Call metadata PATCH from Canvas generation code**

Find the canvas generation trigger in `canvas-client-page.tsx` or `infinite-canvas.tsx` where `fetch()` calls go to `/api/images/generations` or `/api/chat/completions`. After the fetch completes, extract the header and patch metadata:

```typescript
import { patchGenerationTaskMetadata } from "@/services/api/generation-tasks";

// After any generation fetch completes:
const response = await fetch(`/api/images/generations`, { method: "POST", headers, body });
const genTaskId = response.headers.get("x-generation-task-id");
if (genTaskId) {
    patchGenerationTaskMetadata(genTaskId, JSON.stringify({
        canvas_project_id: projectId,
        canvas_node_id: nodeId,
        generation_mode: mode,
    })).catch(() => {
        // metadata write failure must not block generation
        console.warn("Failed to patch generation task metadata", genTaskId);
    });
}
```

The exact location for this code is in the canvas generation flow (search for `fetch(` calls targeting `/api/` paths in the canvas directory). Add it as a non-blocking side-effect after each generation request.

- [ ] **Step 3: TypeScript compile check**

Run: `cd /Users/eldenpdx/git-project/infinite-canvas/web && npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 4: Commit**

```bash
git add web/src/services/api/generation-tasks.ts
git commit -m "feat: add frontend API and Canvas integration for generation task metadata"
```

---

## Implementation Order

| Phase | Tasks | Independent? |
|-------|-------|-------------|
| Phase 1 (Module C) | Tasks 1→2→3→4→5→6→7 | Yes, deployable alone |
| Phase 2 (Module B) | Tasks 8→9→10→11→12 | Yes, after Phase 1 for shared repository additions |
| Phase 3 (Module A) | Tasks 13→14→15→16 | Yes, after Phase 2 for Proxy understanding |

Each phase should be verified end-to-end before starting the next.
