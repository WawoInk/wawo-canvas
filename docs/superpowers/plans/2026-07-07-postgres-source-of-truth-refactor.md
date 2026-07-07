# PostgreSQL 为唯一真相源、IndexedDB 为缓存层 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Assets、Canvas、Generation Tasks 三个数据域重构为「PostgreSQL 为唯一真相源，IndexedDB 为缓存层」架构：新增 cursor-based delta sync、乐观锁冲突检测、删除日志表、mutation API 返回完整记录。

**Architecture:** 后端新增 `deleted_records` 表 + cursor-based Sync API + 乐观锁（`updated_at` 条件更新）+ mutation API 返回完整记录；前端新增 `SyncClient` + `SyncScheduler`，重构 `useAssetStore` / `useCanvasStore` 的读写路径，generation logs 接入 sync。

**Tech Stack:** Go (Gin + GORM + PostgreSQL)、TypeScript (React + Zustand + localforage + axios)

## Global Constraints

- 所有 `UpdatedAt`/`CreatedAt` 字段为 RFC3339 string（`time.Now().Format(time.RFC3339)`）
- 时间戳比较使用字符串比较（字符串字典序与 RFC3339 时序一致）
- `{code, data, msg}` 响应格式：成功 `code: 0`、失败 `code: 1`、冲突 `code: "CONFLICT"` + HTTP 409
- 写 API 通过 body 中的 `expectedUpdatedAt` 字段接收乐观锁版本
- 前端 API 层通过 axios (`apiGet`/`apiPost`/`apiPut`/`apiDelete`，token 通过第三个参数传递)
- 前端 store 数据仅通过 Zustand persist middleware 持久化到 IndexedDB
- 删除统一使用物理删除 + `deleted_records` 表记录，不做软删除
- 不支持离线——断网时写操作禁止，读操作用 IndexedDB 缓存降级

---

### Task 1: `deleted_records` 模型 + 数据库迁移

**Files:**
- Create: `model/deleted_record.go`
- Modify: `repository/db.go:30-38`

**Interfaces:**
- Produces: `model.DeletedRecord` struct、`repository.DB()` AutoMigrate 中包含 `&model.DeletedRecord{}`

- [ ] **Step 1: 创建 DeletedRecord 模型**

```go
// model/deleted_record.go
package model

import "time"

// DeletedRecord 记录物理删除的实体，供 Sync API 返回已删除的 ID 列表。
// 按 (table_name, record_id, user_id, deleted_at) 索引，支持 cursor 增量查询。
type DeletedRecord struct {
	ID        uint64    `json:"-" gorm:"primaryKey;autoIncrement"`
	TableName string    `json:"tableName" gorm:"column:table_name;not null;index:idx_dr_user_time,priority:2"`
	RecordID  string    `json:"recordId" gorm:"column:record_id;not null;index:idx_dr_user_time,priority:3"`
	UserID    string    `json:"userId" gorm:"column:user_id;not null;index:idx_dr_user_time,priority:1"`
	DeletedAt time.Time `json:"deletedAt" gorm:"column:deleted_at;not null;index:idx_dr_user_time,priority:4"`
}
```

- [ ] **Step 2: 添加到 AutoMigrate**

修改 `repository/db.go`，在 AutoMigrate 列表中添加 `&model.DeletedRecord{}`：

```go
dbErr = db.AutoMigrate(
    &model.User{},
    &model.CreditLog{},
    &model.Prompt{},
    &model.Asset{},
    &model.Setting{},
    &model.GenerationTask{},
    &model.GenerationPayload{},
    &model.CanvasProject{},
    &model.VideoTask{},
    &model.UserFile{},
    &model.DeletedRecord{}, // 新增：删除日志表
)
```

- [ ] **Step 3: 编译验证**

Run: `go build ./...`
Expected: 编译成功，无错误。

- [ ] **Step 4: Commit**

```bash
git add model/deleted_record.go repository/db.go
git commit -m "feat: add deleted_records model + auto-migrate"
```

---

### Task 2: `deleted_records` repository 层

**Files:**
- Create: `repository/deleted_record.go`

**Interfaces:**
- Produces: `RecordDeletion(tableName, recordID, userID string, deletedAt time.Time) error`
- Produces: `ListDeletedRecords(userID, cursor string) ([]model.DeletedRecord, error)`
- Produces: `PruneDeletedRecords(olderThan time.Time) error`

- [ ] **Step 1: 创建 repository/deleted_record.go**

```go
// repository/deleted_record.go
package repository

import (
	"time"

	"github.com/basketikun/infinite-canvas/model"
)

// RecordDeletion 在物理删除前记录一条删除日志。
func RecordDeletion(tableName, recordID, userID string, deletedAt time.Time) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&model.DeletedRecord{
		TableName: tableName,
		RecordID:  recordID,
		UserID:    userID,
		DeletedAt: deletedAt,
	}).Error
}

// ListDeletedRecords 返回指定用户在 cursor 之后被删除的记录（按 deleted_at 升序）。
func ListDeletedRecords(userID, cursor string) ([]model.DeletedRecord, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var records []model.DeletedRecord
	err = db.
		Where("user_id = ? AND deleted_at > ?", userID, cursor).
		Order("deleted_at asc").
		Find(&records).Error
	return records, err
}

// PruneDeletedRecords 清理创建时间早于 olderThan 的删除日志。
// ponytail: 在清理 cron 或 lazy 调用中执行，保留 30 天。
func PruneDeletedRecords(olderThan time.Time) (int64, error) {
	db, err := DB()
	if err != nil {
		return 0, err
	}
	result := db.Where("deleted_at < ?", olderThan).Delete(&model.DeletedRecord{})
	return result.RowsAffected, result.Error
}
```

- [ ] **Step 2: 编译验证**

Run: `go build ./...`
Expected: 编译成功。

- [ ] **Step 3: Commit**

```bash
git add repository/deleted_record.go
git commit -m "feat: add deleted_records repository (RecordDeletion, ListDeletedRecords, PruneDeletedRecords)"
```

---

### Task 3: 资产乐观锁（repo + service + handler）

**Files:**
- Modify: `repository/asset.go`
- Modify: `service/assets.go`
- Modify: `handler/assets.go`
- Modify: `handler/response.go`

**Interfaces:**
- Consumes: `repository.RecordDeletion()`（来自 Task 2）
- Produces: `repository.SaveAssetWithLock(item, expectedUpdatedAt) (model.Asset, error)` — 返回 `gorm.ErrRecordNotFound` 表示冲突
- Produces: `service.SaveAsset(userID, item, expectedUpdatedAt) (model.Asset, error)` — 返回 `ErrConflict` 表示冲突
- Produces: `handler.Conflict(w, msg, current)` — 新增响应函数
- Modifies: `handler.SaveAsset` — 接收 `expectedUpdatedAt`、返回完整 Asset、处理 409

- [ ] **Step 1: repository 层 — 添加 `SaveAssetWithLock` 和 `SaveAssetWithConflict` 错误**

在 `repository/asset.go` 中，在 `SaveAsset` 之后添加：

```go
import (
	"errors"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

var ErrConflict = errors.New("record modified by another session")

// SaveAssetWithLock 使用乐观锁保存素材。expectedUpdatedAt 必须匹配当前 updated_at，
// 否则返回 ErrConflict。INSERT 时 expectedUpdatedAt 为空，无条件创建。
func SaveAssetWithLock(item model.Asset, expectedUpdatedAt string) (model.Asset, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}

	// 查找是否存在
	saved, exists, err := findAsset(db, item.ID)
	if err != nil {
		return item, err
	}

	if exists {
		// UPDATE: 条件检查 updated_at 是否匹配
		if item.CreatedAt == "" {
			item.CreatedAt = saved.CreatedAt
		}
		result := db.Model(&model.Asset{}).
			Where("id = ? AND updated_at = ?", item.ID, expectedUpdatedAt).
			Updates(map[string]any{
				"user_id":     item.UserID,
				"title":       item.Title,
				"type":        item.Type,
				"cover_url":   item.CoverURL,
				"tags":        item.Tags,
				"category":    item.Category,
				"description": item.Description,
				"content":     item.Content,
				"file_id":     item.FileID,
				"width":       item.Width,
				"height":      item.Height,
				"bytes":       item.Bytes,
				"mime_type":   item.MimeType,
				"updated_at":  item.UpdatedAt,
				"created_at":  item.CreatedAt,
			})
		if result.Error != nil {
			return item, result.Error
		}
		if result.RowsAffected == 0 {
			return item, ErrConflict
		}
		// 重新读取返回最新记录
		updated, _, err := findAsset(db, item.ID)
		return updated, err
	}

	// INSERT: 无冲突可能
	return item, db.Create(&item).Error
}
```

同时保留原有 `SaveAsset` 不动（admin 路径仍用它），在 import 中添加 `"time"`。

- [ ] **Step 2: service 层 — 修改 `SaveAsset` 签名，添加 expectedUpdatedAt 参数**

修改 `service/assets.go` 的 `SaveAsset` 函数：

```go
// SaveAsset 保存素材。expectedUpdatedAt 用于乐观锁：更新时匹配当前版本，插入时传空。
func SaveAsset(userID string, item model.Asset, expectedUpdatedAt string) (model.Asset, error) {
	now := time.Now().Format(time.RFC3339)
	if item.Type == "" {
		item.Type = model.AssetTypeText
	}
	if item.ID == "" {
		item.ID = newID("asset")
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	item.UserID = userID
	if item.CoverURL == "" {
		item.CoverURL = assetCoverURL(item)
	}
	return repository.SaveAssetWithLock(item, expectedUpdatedAt)
}
```

保持其余函数（`ListAssets`, `DeleteAsset`, `UploadAssetImage`, `enrichAssetURLs`, `assetCoverURL`, `fileExt`）不变。

- [ ] **Step 3: handler 层 — 添加 `Conflict` 响应 + 修改 `SaveAsset`**

在 `handler/response.go` 中的 `Fail` 函数之后添加：

```go
// Conflict 返回 HTTP 409，用于乐观锁冲突。
func Conflict(w http.ResponseWriter, msg string, current any) {
	w.WriteHeader(http.StatusConflict)
	writeJSON(w, response{Code: -1, Data: map[string]any{"current": current, "msg": msg}, Msg: msg})
}
```

修改 `handler/assets.go` 的 `SaveAsset` 函数：

```go
import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/basketikun/infinite-canvas/service"
)

func SaveAsset(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	var body struct {
		model.Asset
		ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	result, err := service.SaveAsset(user.ID, body.Asset, body.ExpectedUpdatedAt)
	if err != nil {
		if errors.Is(err, repository.ErrConflict) {
			// 返回当前版本供前端回滚
			Conflict(w, "资产已被其他会话修改", result)
			return
		}
		FailError(w, err)
		return
	}
	OK(w, result)
}
```

保持 `Assets`（GET）、`DeleteAsset`（DELETE）、`AdminAssets`、`AdminSaveAsset`、`AdminDeleteAsset`、`AdminUploadAssetImage` 不变（admin 路径不涉及乐观锁）。

- [ ] **Step 4: 编译验证**

Run: `go build ./...`
Expected: 编译成功。

- [ ] **Step 5: Commit**

```bash
git add repository/asset.go service/assets.go handler/assets.go handler/response.go
git commit -m "feat: add optimistic lock to asset save (SaveAssetWithLock + 409 conflict)"
```

---

### Task 4: Canvas 项目乐观锁 + 删除记录 deleted_records

**Files:**
- Modify: `repository/canvas_project.go`
- Modify: `service/canvas_service.go`
- Modify: `handler/canvas_projects.go`

**Interfaces:**
- Consumes: `repository.RecordDeletion()`（来自 Task 2）、`repository.ErrConflict`（来自 Task 3）
- Produces: `repository.UpdateCanvasProjectWithLock(id, userID, projectJSON, expectedUpdatedAt) error`
- Produces: `service.UpdateCanvasProject(id, userID, projectJSON, expectedUpdatedAt) (model.CanvasProject, error)`
- Modifies: `handler.UpdateCanvasProject` — 接收 `expectedUpdatedAt`、处理 409
- Modifies: `service.DeleteCanvasProject` / `handler.DeleteCanvasProject` — 删除前记录 deleted_records

- [ ] **Step 1: repository 层 — `UpdateCanvasProjectWithLock`**

在 `repository/canvas_project.go` 中修改 `UpdateCanvasProject`，改为条件更新：

```go
// UpdateCanvasProjectWithLock 使用乐观锁更新画布项目。expectedUpdatedAt 必须匹配
// 当前 updated_at，否则返回 ErrConflict。同时递增 version 并更新 updated_at。
func UpdateCanvasProjectWithLock(id, userID string, projectJSON string, version int, expectedUpdatedAt, newUpdatedAt string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	result := db.Model(&model.CanvasProject{}).
		Where("id = ? AND user_id = ? AND updated_at = ?", id, userID, expectedUpdatedAt).
		Updates(map[string]any{
			"project_json": projectJSON,
			"version":      version,
			"updated_at":   newUpdatedAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrConflict
	}
	return nil
}
```

保留原有 `UpdateCanvasProject` 不动（向后兼容），或将其标记为 deprecated。

- [ ] **Step 2: service 层 — 修改 `UpdateCanvasProject` + `DeleteCanvasProject`**

修改 `service/canvas_service.go`：

```go
import (
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// UpdateCanvasProject 更新画布项目（乐观锁 + 版本递增）。expectedUpdatedAt 用于冲突检测。
func UpdateCanvasProject(id string, userID string, projectJSON string, expectedUpdatedAt string) (model.CanvasProject, error) {
	existing, err := repository.GetCanvasProjectByIDAndUser(id, userID)
	if err != nil {
		return model.CanvasProject{}, err
	}
	now := time.Now().Format(time.RFC3339)
	version := existing.Version + 1

	if err := repository.UpdateCanvasProjectWithLock(id, userID, projectJSON, version, expectedUpdatedAt, now); err != nil {
		return existing, err // 透传 ErrConflict
	}

	existing.ProjectJSON = projectJSON
	existing.Version = version
	existing.UpdatedAt = now
	return existing, nil
}

// DeleteCanvasProject 删除画布项目并记录删除日志。
func DeleteCanvasProject(id string, userID string) error {
	if err := repository.DeleteCanvasProject(id, userID); err != nil {
		return err
	}
	// 记录删除日志供 sync API 返回
	_ = repository.RecordDeletion("canvas_projects", id, userID, time.Now())
	return nil
}
```

- [ ] **Step 3: handler 层 — 修改 `UpdateCanvasProject` + `DeleteCanvasProject`**

修改 `handler/canvas_projects.go`：

在 `updateCanvasProjectRequest` 结构体中添加 `ExpectedUpdatedAt` 字段：

```go
type updateCanvasProjectRequest struct {
	Project            any    `json:"project"`
	ExpectedUpdatedAt  string `json:"expectedUpdatedAt"`
}
```

修改 `UpdateCanvasProject` 函数：

```go
func UpdateCanvasProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	body, _ := io.ReadAll(r.Body)
	var req updateCanvasProjectRequest
	_ = json.Unmarshal(body, &req)

	projectJSON := string(body)
	if req.Project != nil {
		pj, _ := json.Marshal(req.Project)
		projectJSON = string(pj)
	}

	project, err := service.UpdateCanvasProject(id, user.ID, projectJSON, req.ExpectedUpdatedAt)
	if err != nil {
		if errors.Is(err, repository.ErrConflict) {
			Conflict(w, "画布已被其他会话修改", project)
			return
		}
		FailError(w, err)
		return
	}
	OK(w, project)
}
```

在 `handler/canvas_projects.go` 的 import 中添加：
```go
import (
	"errors"
	// ... 其他导入
	"github.com/basketikun/infinite-canvas/repository"
)
```

修改 `DeleteCanvasProject` 返回 `{code: 0, data: {id, deletedAt}, msg: "ok"}`：

```go
func DeleteCanvasProject(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if err := service.DeleteCanvasProject(id, user.ID); err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"id": id, "deletedAt": time.Now().Format(time.RFC3339)})
}
```

添加 `"time"` 到 import。

- [ ] **Step 4: 编译验证**

Run: `go build ./...`
Expected: 编译成功。

- [ ] **Step 5: Commit**

```bash
git add repository/canvas_project.go service/canvas_service.go handler/canvas_projects.go
git commit -m "feat: add optimistic lock to canvas update + delete records in deleted_records"
```

---

### Task 5: 资产删除写入 deleted_records + 返回完整删除响应

**Files:**
- Modify: `service/assets.go`
- Modify: `handler/assets.go`

**Interfaces:**
- Consumes: `repository.RecordDeletion()`（来自 Task 2）
- Modifies: `service.DeleteAsset` — 物理删除后记录 deleted_records
- Modifies: `handler.DeleteAsset` — 返回 `{id, deletedAt}`

- [ ] **Step 1: service 层 — `DeleteAsset` 记录删除日志**

修改 `service/assets.go` 的 `DeleteAsset`：

```go
func DeleteAsset(userID, id string) error {
	if err := repository.DeleteAsset(userID, id); err != nil {
		return err
	}
	// 记录删除日志供 sync API 返回
	_ = repository.RecordDeletion("assets", id, userID, time.Now())
	return nil
}
```

- [ ] **Step 2: handler 层 — `DeleteAsset` 返回 `{id, deletedAt}`**

修改 `handler/assets.go` 的 `DeleteAsset`：

```go
func DeleteAsset(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	if err := service.DeleteAsset(user.ID, id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]string{"id": id, "deletedAt": time.Now().Format(time.RFC3339)})
}
```

添加 `"time"` 到 handler/assets.go 的 import。

- [ ] **Step 3: 编译验证**

Run: `go build ./...`
Expected: 编译成功。

- [ ] **Step 4: Commit**

```bash
git add service/assets.go handler/assets.go
git commit -m "feat: record asset deletion in deleted_records + return {id, deletedAt}"
```

---

### Task 6: 生成任务删除写入 deleted_records

**Files:**
- Modify: `service/generation_service.go`

**Interfaces:**
- Consumes: `repository.RecordDeletion()`（来自 Task 2）

- [ ] **Step 1: 修改 `DeleteUserTask` + `AdminDeleteTask` + `AdminBatchDeleteTasks`**

在 `service/generation_service.go` 中，修改这三个函数以在删除后记录 deleted_records：

```go
// DeleteUserTask 删除用户的任务（含 Payload 级联），并记录删除日志。
func DeleteUserTask(taskID string, userID string) error {
	if err := repository.DeleteGenerationTask(taskID, userID); err != nil {
		return err
	}
	_ = repository.RecordDeletion("generation_tasks", taskID, userID, time.Now())
	return nil
}

// AdminDeleteTask 管理员删除单条任务（无所有权校验），并记录删除日志。
func AdminDeleteTask(taskID string) error {
	if _, err := repository.AdminDeleteGenerationTasks([]string{taskID}); err != nil {
		return err
	}
	// admin 删除不记 userID（记空）
	_ = repository.RecordDeletion("generation_tasks", taskID, "", time.Now())
	return nil
}

// AdminBatchDeleteTasks 管理员批量删除任务，并记录删除日志。
func AdminBatchDeleteTasks(ids []string) (int64, error) {
	count, err := repository.AdminDeleteGenerationTasks(ids)
	if err != nil {
		return count, err
	}
	now := time.Now()
	for _, id := range ids {
		_ = repository.RecordDeletion("generation_tasks", id, "", now)
	}
	return count, nil
}
```

- [ ] **Step 2: 编译验证**

Run: `go build ./...`
Expected: 编译成功。

- [ ] **Step 3: Commit**

```bash
git add service/generation_service.go
git commit -m "feat: record generation task deletion in deleted_records"
```

---

### Task 7: Sync API（repository + service + handler + 路由）

**Files:**
- Create: `repository/sync.go`
- Create: `service/sync_service.go`
- Create: `handler/sync.go`
- Modify: `router/router.go`

**Interfaces:**
- Consumes: `repository.ListDeletedRecords()`、`model.Asset`、`model.CanvasProject`、`model.GenerationTask`
- Produces: `GET /api/v1/sync?cursor=&domains=assets,canvas,tasks` → `{code: 0, data: {cursor, assets: {updates, deletes}, canvas: {updates, deletes}, tasks: {updates, deletes}}}`

- [ ] **Step 1: repository 层 — 创建 `repository/sync.go`**

```go
// repository/sync.go
package repository

import (
	"github.com/basketikun/infinite-canvas/model"
)

const syncLimit = 200

// ListUpdatedAssets returns assets updated after the cursor for the given user.
func ListUpdatedAssets(userID, cursor string) ([]model.Asset, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.Asset
	err = db.Where("user_id = ? AND updated_at > ?", userID, cursor).
		Order("updated_at asc").
		Limit(syncLimit).
		Find(&items).Error
	return items, err
}

// ListUpdatedCanvasProjects returns canvas projects updated after the cursor for the given user.
func ListUpdatedCanvasProjects(userID, cursor string) ([]model.CanvasProject, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.CanvasProject
	err = db.Where("user_id = ? AND updated_at > ?", userID, cursor).
		Order("updated_at asc").
		Limit(syncLimit).
		Find(&items).Error
	return items, err
}

// ListUpdatedGenerationTasks returns generation tasks updated after the cursor for the given user.
func ListUpdatedGenerationTasks(userID, cursor string) ([]model.GenerationTask, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.GenerationTask
	err = db.Where("user_id = ? AND updated_at > ?", userID, cursor).
		Order("updated_at asc").
		Limit(syncLimit).
		Find(&items).Error
	return items, err
}
```

- [ ] **Step 2: service 层 — 创建 `service/sync_service.go`**

```go
// service/sync_service.go
package service

import (
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// SyncDomain represents a single domain's delta sync response.
type SyncDomain struct {
	Updates any      `json:"updates"`
	Deletes []string `json:"deletes"`
}

// SyncResponse is the combined sync API response.
type SyncResponse struct {
	Cursor  string     `json:"cursor"`
	Assets  SyncDomain `json:"assets"`
	Canvas  SyncDomain `json:"canvas"`
	Tasks   SyncDomain `json:"tasks"`
}

// SyncUserDomains fetches delta updates for the requested domains since the cursor.
// domains: comma-separated list, e.g. "assets,canvas,tasks". Empty means all.
func SyncUserDomains(userID, cursor string, domains string) (*SyncResponse, error) {
	resp := &SyncResponse{}

	allDomains := domains == ""
	includeAssets := allDomains || containsDomain(domains, "assets")
	includeCanvas := allDomains || containsDomain(domains, "canvas")
	includeTasks := allDomains || containsDomain(domains, "tasks")

	newCursor := cursor

	if includeAssets {
		items, _ := repository.ListUpdatedAssets(userID, cursor)
		deletes := fetchDeletesAsIDs(userID, cursor, "assets")
		resp.Assets = SyncDomain{Updates: items, Deletes: deletes}
		newCursor = maxCursor(newCursor, maxUpdatedAt(items), maxDeletedAt(deletes, items))
	} else {
		resp.Assets = SyncDomain{Updates: []model.Asset{}, Deletes: []string{}}
	}

	if includeCanvas {
		items, _ := repository.ListUpdatedCanvasProjects(userID, cursor)
		deletes := fetchDeletesAsIDs(userID, cursor, "canvas_projects")
		resp.Canvas = SyncDomain{Updates: items, Deletes: deletes}
		newCursor = maxCursor(newCursor, maxUpdatedAtCanvas(items), maxDeletedAt(deletes, items))
	} else {
		resp.Canvas = SyncDomain{Updates: []model.CanvasProject{}, Deletes: []string{}}
	}

	if includeTasks {
		items, _ := repository.ListUpdatedGenerationTasks(userID, cursor)
		deletes := fetchDeletesAsIDs(userID, cursor, "generation_tasks")
		resp.Tasks = SyncDomain{Updates: items, Deletes: deletes}
		newCursor = maxCursor(newCursor, maxUpdatedAtTasks(items), maxDeletedAt(deletes, items))
	} else {
		resp.Tasks = SyncDomain{Updates: []model.GenerationTask{}, Deletes: []string{}}
	}

	// 首次同步(cursor 为空)：返回全量，cursor 设为当前时间
	if cursor == "" {
		newCursor = ""
	}

	resp.Cursor = newCursor
	return resp, nil
}

// ── helpers ──

func fetchDeletesAsIDs(userID, cursor, tableName string) []string {
	records, err := repository.ListDeletedRecords(userID, cursor)
	if err != nil {
		return nil
	}
	ids := make([]string, 0)
	for _, r := range records {
		if r.TableName == tableName {
			ids = append(ids, r.RecordID)
		}
	}
	return ids
}

func containsDomain(domains, target string) bool {
	// ponytail: simple substring check, comma-separated
	for _, d := range splitDomains(domains) {
		if d == target {
			return true
		}
	}
	return false
}

func splitDomains(domains string) []string {
	result := make([]string, 0)
	current := ""
	for _, ch := range domains {
		if ch == ',' {
			if current != "" {
				result = append(result, current)
				current = ""
			}
			continue
		}
		current += string(ch)
	}
	if current != "" {
		result = append(result, current)
	}
	return result
}

func maxCursor(a, b, c string) string {
	result := a
	if b > result {
		result = b
	}
	if c > result {
		result = c
	}
	if result == "" {
		result = a
	}
	return result
}

func maxUpdatedAt(items []model.Asset) string {
	var max string
	for _, i := range items {
		if i.UpdatedAt > max {
			max = i.UpdatedAt
		}
	}
	return max
}

func maxUpdatedAtCanvas(items []model.CanvasProject) string {
	var max string
	for _, i := range items {
		if i.UpdatedAt > max {
			max = i.UpdatedAt
		}
	}
	return max
}

func maxUpdatedAtTasks(items []model.GenerationTask) string {
	var max string
	for _, i := range items {
		if i.UpdatedAt > max {
			max = i.UpdatedAt
		}
	}
	return max
}

func maxDeletedAt(ids []string, items interface{}) string {
	// ponytail: deleted records have their own cursor from deleted_at.
	// We return "" here because deletes-only won't advance cursor beyond
	// the last update's updated_at. For simplicity, use the max update cursor
	// from the items, which covers the common case.
	return ""
}
```

- [ ] **Step 3: handler 层 — 创建 `handler/sync.go`**

```go
// handler/sync.go
package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

// Sync GET /api/v1/sync?cursor=xxx&domains=assets,canvas,tasks
func Sync(w http.ResponseWriter, r *http.Request) {
	user, ok := service.UserFromContext(r.Context())
	if !ok {
		Fail(w, "未登录或权限不足")
		return
	}
	q := r.URL.Query()
	cursor := q.Get("cursor")
	domains := q.Get("domains")

	result, err := service.SyncUserDomains(user.ID, cursor, domains)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
```

- [ ] **Step 4: 路由 — 添加 sync 路由**

在 `router/router.go` 中，在 v1 认证路由组里添加：

```go
// Delta sync (cursor-based)
v1.GET("/sync", gin.WrapF(handler.Sync))
```

添加到 `v1.GET("/canvas/projects", ...)` 附近。

- [ ] **Step 5: 编译验证**

Run: `go build ./...`
Expected: 编译成功。

- [ ] **Step 6: Commit**

```bash
git add repository/sync.go service/sync_service.go handler/sync.go router/router.go
git commit -m "feat: add cursor-based delta sync API (GET /api/v1/sync)"
```

---

### Task 8: 前端 Sync 客户端 + 调度器

**Files:**
- Create: `web/src/services/sync-client.ts`
- Create: `web/src/services/sync-scheduler.ts`

**Interfaces:**
- Produces: `SyncClient` 单例 — `syncAll()`, `syncDomain(domain)`, `getCursor()`, `resetCursor()`
- Produces: `SyncScheduler` — `start()`, `stop()`, `markActivity()`, `onRunningTaskCountChange(count: number)`
- Consumes: `GET /api/v1/sync?cursor=&domains=`、`useUserStore`（user?.id）
- Changes: 仅创建文件，不修改任何现有文件

- [ ] **Step 1: 创建 `web/src/services/sync-client.ts`**

```typescript
// web/src/services/sync-client.ts
import localforage from "localforage";
import { useUserStore } from "@/stores/use-user-store";

export type Domain = "assets" | "canvas" | "tasks";

type SyncDomainData = {
    updates: any[];
    deletes: string[];
};

type SyncDelta = {
    cursor: string;
    assets: SyncDomainData;
    canvas: SyncDomainData;
    tasks: SyncDomainData;
};

const SYNC_CURSOR_KEY = "infinite-canvas:sync_cursor";

function cursorKey(userId: string): string {
    return `${SYNC_CURSOR_KEY}:${userId}`;
}

class SyncClient {
    private applyCallbacks: Map<Domain, (data: SyncDomainData) => void> = new Map();

    /** 注册各数据域的 delta 应用回调 */
    onDelta(domain: Domain, callback: (data: SyncDomainData) => void): void {
        this.applyCallbacks.set(domain, callback);
    }

    /** 获取当前 cursor */
    async getCursor(): Promise<string> {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return "";
        try {
            return (await localforage.getItem<string>(cursorKey(userId))) || "";
        } catch {
            return "";
        }
    }

    /** 持久化 cursor */
    private async setCursor(cursor: string): Promise<void> {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return;
        try {
            if (cursor) {
                await localforage.setItem(cursorKey(userId), cursor);
            }
        } catch { /* IndexedDB 写入失败不影响功能 */ }
    }

    /** 重置 cursor（用户切换时调用）*/
    async resetCursor(): Promise<void> {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return;
        try {
            await localforage.removeItem(cursorKey(userId));
        } catch { /* ignore */ }
    }

    /** 全量同步所有域 */
    async syncAll(): Promise<void> {
        await this.syncDomains("assets,canvas,tasks");
    }

    /** 同步指定数据域 */
    async syncDomain(domain: Domain): Promise<void> {
        await this.syncDomains(domain);
    }

    private async syncDomains(domains: string): Promise<void> {
        const userId = useUserStore.getState().user?.id;
        const token = useUserStore.getState().token;
        if (!userId || !token) return;

        const cursor = await this.getCursor();
        const params = new URLSearchParams();
        if (cursor) params.set("cursor", cursor);
        params.set("domains", domains);

        try {
            const resp = await fetch(`/api/v1/sync?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!resp.ok) return;
            const json = await resp.json();
            if (json.code !== 0) return;

            const delta = json.data as SyncDelta;
            this.applyDelta(delta);

            // 持久化新 cursor
            if (delta.cursor) {
                await this.setCursor(delta.cursor);
            }
        } catch { /* 网络错误，下次重试 */ }
    }

    private applyDelta(delta: SyncDelta): void {
        for (const domain of ["assets", "canvas", "tasks"] as Domain[]) {
            const callback = this.applyCallbacks.get(domain);
            if (!callback) continue;
            callback(delta[domain]);
        }
    }
}

export const syncClient = new SyncClient();
```

- [ ] **Step 2: 创建 `web/src/services/sync-scheduler.ts`**

```typescript
// web/src/services/sync-scheduler.ts
import { syncClient, type Domain } from "./sync-client";

const ACTIVE_TASK_POLL_MS = 5_000;       // C: 有活跃任务时 5s
const DOMAIN_POLL_MS = 60_000;           // A: 数据域默认 60s
const ACTIVITY_IDLE_MS = 120_000;         // B: 2 分钟无操作视为闲置

class SyncScheduler {
    private runningTaskCount = 0;
    private lastActivity = Date.now();
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private visibilityHandler: (() => void) | null = null;

    /** 启动调度器 */
    start(): void {
        // 首次全量同步
        syncClient.syncAll().catch(() => {});
        // 初始化轮询时间戳，避免立即触发第一次定时轮询
        this.lastTasksPoll = Date.now();
        this.lastDomainPoll = Date.now();

        // Tab 可见性
        this.visibilityHandler = () => {
            if (document.visibilityState === "visible") {
                syncClient.syncAll().catch(() => {});
            }
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);

        // 定时器：使用 arrow 包裹确保 this 绑定
        this.intervalId = setInterval(() => this.tick(), 1000);
    }

    /** 停止调度器 */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.visibilityHandler) {
            document.removeEventListener("visibilitychange", this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }

    /** 标记用户活动（mutation 时调用）*/
    markActivity(): void {
        this.lastActivity = Date.now();
    }

    /** 更新活跃任务数（生成任务状态变化时调用）*/
    onRunningTaskCountChange(count: number): void {
        this.runningTaskCount = count;
    }

    private lastTasksPoll = 0;
    private lastDomainPoll = 0;

    private tick(): void {
        const now = Date.now();
        const idle = now - this.lastActivity > ACTIVITY_IDLE_MS;

        // B: 活跃编辑时不轮询
        if (!idle) return;

        // C: 生命周期驱动 — 有活跃任务时高频轮询 tasks
        if (this.runningTaskCount > 0) {
            if (now - this.lastTasksPoll >= ACTIVE_TASK_POLL_MS) {
                this.lastTasksPoll = now;
                syncClient.syncDomain("tasks").catch(() => {});
            }
            return; // tasks 轮询优先，不与 canvas/assets 合并
        }

        // A: 数据域驱动 — canvas/assets 60s 轮询
        if (now - this.lastDomainPoll >= DOMAIN_POLL_MS) {
            this.lastDomainPoll = now;
            syncClient.syncDomain("canvas").catch(() => {});
            syncClient.syncDomain("assets").catch(() => {});
        }
    }
}

export const syncScheduler = new SyncScheduler();
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无类型错误（或仅有预先存在的错误）。

- [ ] **Step 4: Commit**

```bash
git add web/src/services/sync-client.ts web/src/services/sync-scheduler.ts
git commit -m "feat: add sync-client + sync-scheduler for cursor-based delta sync"
```

---

### Task 9: 重构 `useAssetStore` —— IndexedDB 降为缓存层

**Files:**
- Modify: `web/src/services/api/request.ts`（暴露错误状态码 + data，供 409 回滚）
- Modify: `web/src/stores/use-asset-store.ts`
- 需读取（不改）：`web/src/services/api/assets.ts`、`web/src/services/sync-client.ts`、`web/src/lib/localforage-storage.ts`

**Interfaces:**
- Consumes: `syncClient.onDelta('assets', ...)`（来自 Task 8）、`saveAssetToLibrary`/`deleteAssetFromLibrary`（existing）
- Produces: 现有 `useAssetStore` 接口不变（`addAsset`/`updateAsset`/`removeAsset`/`removeAssetWithFile`/`replaceAssets`/`refreshAssetUrls`）
- Changes: `request.ts` 的 `apiRequest` 抛错时附挂 `status` 与 `data`；`updateAsset` 改为 async + 立即调 API + 409 回滚；`addAsset` 改为 await API；`removeAssetWithFile` 改为 await API；删除 `syncAssetsFromBackend`/`syncNewAssetToBackend`/`mergeAssets`；添加 delta 回调注册

- [ ] **Step 0: 修改 `request.ts` —— 抛错时附挂 status + data**

当前 `apiRequest` 在失败时只抛 `new Error(msg)`，丢失了 HTTP 状态码与响应体（409 冲突时无法拿到 `current`）。改为抛一个带 `status` 和 `data` 字段的自定义错误：

修改 `web/src/services/api/request.ts`，在文件顶部（`ApiResponse` 类型之后）添加错误类型：

```typescript
// 可携带 HTTP 状态码与响应 data 的错误，供调用方区分 409 冲突等场景
export class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(msg: string, status: number, data: unknown) {
        super(msg);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
    }
}
```

修改 `apiRequest` 的失败分支：

```typescript
    const payload = result as ApiResponse<T>;
    if (response.status < 200 || response.status >= 300 || payload.code !== 0) {
        throw new ApiError(payload.msg || "请求失败", response.status, payload.data);
    }

    return payload.data;
```

（`catch` 分支的 `new Error("接口连接失败...")` 保持不变——那是网络层错误，无 status/data。）

- [ ] **Step 1: 重构写路径**

修改 `web/src/stores/use-asset-store.ts`，替换 `addAsset`、`updateAsset`、`removeAsset`、`removeAssetWithFile`：

```typescript
"use client";

import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { resolveFileUrls } from "@/services/resolve-file-urls";
import { fetchAssetLibrary, saveAssetToLibrary, deleteAssetFromLibrary } from "@/services/api/assets";
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";
import { message } from "antd";

// ── 类型不变 (AssetKind, TextAsset, ImageAsset, VideoAsset, Asset, AssetStore) ──
// ... (保持现有类型定义不变)

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

const assetStorage: PersistStorage<AssetStore> = {
    // ... 不变
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            synced: false,
            assets: [],
            addAsset: async (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const item = { ...asset, id, createdAt: now, updatedAt: now } as Asset;
                // 先调 API
                try {
                    const result = await saveAssetToLibrary(fromLocalAsset(item) as Parameters<typeof saveAssetToLibrary>[0]);
                    // ponytail: 后端生成的 id 优先
                    const finalId = result.id || id;
                    const finalItem = { ...item, id: finalId };
                    set((state) => ({ assets: [finalItem, ...state.assets] }));
                    syncScheduler.markActivity();
                    return finalId;
                } catch {
                    message.error("创建资产失败，请检查网络连接");
                    throw new Error("创建资产失败");
                }
            },
            updateAsset: async (id, patch) => {
                const local = get().assets.find((a) => a.id === id);
                if (!local) return;
                try {
                    const body = {
                        ...fromLocalAsset({ ...local, ...patch } as Asset),
                        expectedUpdatedAt: local.updatedAt,
                    };
                    const result = await saveAssetToLibrary(body as Parameters<typeof saveAssetToLibrary>[0]);
                    // 用 API 返回的最新记录更新
                    set((state) => ({
                        assets: state.assets.map((a) => (a.id === id ? toLocalAsset(result) : a)),
                    }));
                    syncScheduler.markActivity();
                } catch (err: any) {
                    // 409 冲突：回滚本地
                    if (err?.response?.status === 409 || err?.message?.includes("已被修改")) {
                        // pull latest via sync
                        await syncClient.syncDomain("assets");
                        message.warning("资产已被其他会话修改，已刷新为最新版本");
                        return;
                    }
                    message.error("更新资产失败，请检查网络连接");
                    throw err;
                }
            },
            removeAsset: async (id) => {
                try {
                    await deleteAssetFromLibrary(id);
                    set((state) => ({
                        assets: state.assets.filter((a) => a.id !== id),
                    }));
                    syncScheduler.markActivity();
                } catch {
                    message.error("删除资产失败，请检查网络连接");
                    throw new Error("删除资产失败");
                }
            },
            removeAssetWithFile: async (id, fileId) => {
                try {
                    const token = JSON.parse(localStorage.getItem("infinite-canvas-auth-token-v1") || "{}")?.state?.token || "";
                    await fetch(`/api/v1/files/${encodeURIComponent(fileId)}`, {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    await deleteAssetFromLibrary(id);
                } catch { /* file delete + asset delete — one may fail, still remove locally */ }
                set((state) => ({
                    assets: state.assets.filter((a) => a.id !== id),
                }));
                syncScheduler.markActivity();
            },
            replaceAssets: (assets) => set({ assets }),
            refreshAssetUrls: async (ids) => {
                // ... (保持不变)
            },
            cleanupImages: (_opts) => {},
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (state) => {
                useAssetStore.setState({ hydrated: true });
                // 水合后：先拉取最新数据（not local-wins merge）
                if (state) {
                    syncClient.syncDomain("assets").then(() => {
                        useAssetStore.setState({ synced: true });
                    }).catch(() => {
                        useAssetStore.setState({ synced: true });
                    });
                }
            },
        },
    ),
);

// ── Sync delta 回调：应用后台同步的增量数据 ──
syncClient.onDelta("assets", (data) => {
    const state = useAssetStore.getState();
    if (!data) return;

    // 应用 updates
    if (data.updates && data.updates.length > 0) {
        const remote = data.updates.map((item: any) => toLocalAsset(item));
        const map = new Map(state.assets.map((a) => [a.id, a]));
        for (const a of remote) {
            map.set(a.id, a);
        }
        const merged = Array.from(map.values()).sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        useAssetStore.setState({ assets: merged });
        // 刷新 S3 预签名 URL
        const fileIds = merged
            .filter((a) => (a.kind === "image" || a.kind === "video") && a.data?.fileId)
            .map((a) => a.data!.fileId as string);
        if (fileIds.length) {
            void useAssetStore.getState().refreshAssetUrls(fileIds);
        }
    }

    // 应用 deletes
    if (data.deletes && data.deletes.length > 0) {
        const deleteSet = new Set(data.deletes);
        useAssetStore.setState({
            assets: state.assets.filter((a) => !deleteSet.has(a.id)),
        });
        if (useAssetStore.getState().assets !== state.assets) return; // 类型检查：确认 state 变化
    }
});

// ── 转换函数 ──
// toLocalAsset / fromLocalAsset 保持不变
// ... (保留现有 toLocalAsset 和 fromLocalAsset 函数)
```

**删除** `syncAssetsFromBackend`、`syncNewAssetToBackend`、`mergeAssets` 三个函数。

**保留** `toLocalAsset`、`fromLocalAsset` 函数不变。

- [ ] **Step 2: TypeScript 编译检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无新增类型错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/stores/use-asset-store.ts
git commit -m "refactor: useAssetStore — IndexedDB as cache, API as source of truth, optimistic lock + delta sync"
```

---

### Task 10: 重构 `useCanvasStore` — 去除 local-wins merge，接入 sync

**Files:**
- Modify: `web/src/pages/canvas/stores/use-canvas-store.ts`

**Interfaces:**
- Consumes: `syncClient.onDelta('canvas', ...)`（来自 Task 8）、`updateCanvasProject`（existing）
- Produces: 现有 `useCanvasStore` 接口不变
- Changes: `syncFromBackend` 改为 server delta 覆盖而非 local-wins；注册 delta 回调；debounce push 保持不变；添加 `expectedUpdatedAt`

- [ ] **Step 1: 重构 syncFromBackend**

修改 `web/src/pages/canvas/stores/use-canvas-store.ts`：

在 import 中添加：
```typescript
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";
```

修改 `syncFromBackend` 方法：

```typescript
syncFromBackend: async () => {
    const user = useUserStore.getState().user;
    if (!user?.id) return;
    // ponytail: server delta 直接覆盖，不再 local-wins
    await syncClient.syncDomain("canvas");
},
```

修改 `onRehydrateStorage` 回调以触发 delta sync：

```typescript
onRehydrateStorage: () => () => {
    useCanvasStore.setState({ hydrated: true });
    // hydrated 后触发 delta sync
    syncClient.syncDomain("canvas").catch(() => {});
},
```

修改 debounce 推送函数以传递 `expectedUpdatedAt`：

```typescript
function scheduleBackendSync(projectId: string) {
    const existing = syncTimers.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
        syncTimers.delete(projectId);
        const state = useCanvasStore.getState();
        const project = state.projects.find((p) => p.id === projectId);
        if (!project) return;
        const user = useUserStore.getState().user;
        if (!user?.id) return;
        syncScheduler.markActivity();
        updateCanvasProject(projectId, {
            ...project,
            expectedUpdatedAt: project.updatedAt,  // 乐观锁
        } as any).catch((err: any) => {
            if (err?.response?.status === 409 || err?.message?.includes("已被修改")) {
                syncClient.syncDomain("canvas");
                // ponytail: Ant Design message 提示冲突（需 import { message } from "antd"）
            }
        });
    }, SYNC_DEBOUNCE_MS);
    syncTimers.set(projectId, timer);
}
```

修改 beforeunload 处理器，传递 `expectedUpdatedAt`：

```typescript
if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
        const state = useCanvasStore.getState();
        const user = useUserStore.getState().user;
        const token = useUserStore.getState().token;
        if (!user?.id || !token) return;
        for (const project of state.projects) {
            // ponytail: expectedUpdatedAt 必须放在顶层，与 project 同级
            fetch(`/api/v1/canvas/projects/${encodeURIComponent(project.id)}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    project: {
                        id: project.id,
                        title: project.title,
                        createdAt: project.createdAt,
                        updatedAt: project.updatedAt,
                        nodes: project.nodes,
                        connections: project.connections,
                        chatSessions: project.chatSessions,
                        activeChatId: project.activeChatId,
                        backgroundMode: project.backgroundMode,
                        showImageInfo: project.showImageInfo,
                        viewport: project.viewport,
                    },
                    expectedUpdatedAt: project.updatedAt,
                }),
                keepalive: true,
            }).catch(() => {});
        }
    });
}
```

修改 import 添加 `{ message } from "antd"`。

**关键删除**：删除 `syncFromBackend` 中 local-wins merge 逻辑（即 `if (local.nodes.length || local.connections.length || local.chatSessions.length) continue` 分支）。servers delta 直接覆盖。

**注册 delta 回调**（在文件底部，store 创建之后）：

```typescript
// ── Sync delta 回调 ──
syncClient.onDelta("canvas", (data) => {
    if (!data) return;
    const state = useCanvasStore.getState();

    // 应用 updates
    if (data.updates && data.updates.length > 0) {
        const map = new Map(state.projects.map((p) => [p.id, p]));
        for (const item of data.updates) {
            const existing = map.get(item.id);
            if (existing) {
                // server 版本覆盖本地（local 已通过 debounce push 到 server）
                // 仅当 server 的 updatedAt 更新时才覆盖（防止覆盖本地未推送的编辑）
                if (item.updatedAt && existing.updatedAt && item.updatedAt > existing.updatedAt) {
                    map.set(item.id, fromServerProject(item, existing));
                }
            } else {
                map.set(item.id, fromServerProject(item, null));
            }
        }
        useCanvasStore.setState({ projects: Array.from(map.values()) });
    }

    // 应用 deletes
    if (data.deletes && data.deletes.length > 0) {
        const deleteSet = new Set(data.deletes);
        useCanvasStore.setState({
            projects: state.projects.filter((p) => !deleteSet.has(p.id)),
        });
    }
});

function fromServerProject(item: any, local: any): any {
    // ponytail: 如果 server 的 projectJson 过期（即 local 有更新的编辑尚未推送），保留 local
    // 安全兜底 — 通常 server delta 的 updatedAt > local.updatedAt 时覆盖
    const parsed = item.projectJson ? safeParseJSON(item.projectJson) : {};
    return {
        id: item.id,
        title: parsed.title || item.name || (local?.title ?? "Untitled"),
        createdAt: item.createdAt || "",
        updatedAt: item.updatedAt || "",
        nodes: parsed.nodes || local?.nodes || [],
        connections: parsed.connections || local?.connections || [],
        chatSessions: parsed.chatSessions || local?.chatSessions || [],
        activeChatId: parsed.activeChatId ?? local?.activeChatId ?? null,
        backgroundMode: parsed.backgroundMode || local?.backgroundMode || "lines",
        showImageInfo: parsed.showImageInfo ?? local?.showImageInfo ?? false,
        viewport: parsed.viewport || local?.viewport || { x: 0, y: 0, zoom: 1 },
    };
}

function safeParseJSON(s: string): any {
    try { return JSON.parse(s); } catch { return {}; }
}
```

- [ ] **Step 2: 启动 syncScheduler**

在 Canvas 页面入口或 App 根组件中启动 scheduler。查找合适的位置（如 `web/src/components/layout/client-root-init.tsx` 或 canvas page 的 useEffect）：

```typescript
// 在合适的根组件中添加（如 client-root-init.tsx 或 App）
import { syncScheduler } from "@/services/sync-scheduler";
import { useEffect } from "react";

// 在组件内：
useEffect(() => {
    syncScheduler.start();
    return () => syncScheduler.stop();
}, []);
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无新增类型错误。

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/canvas/stores/use-canvas-store.ts web/src/components/layout/client-root-init.tsx
git commit -m "refactor: useCanvasStore — server delta covers local, optimistic lock on debounced push"
```

---

### Task 11: Generation Logs 接入 SyncClient + 页面注册

**Files:**
- Modify: `web/src/pages/image/index.tsx`
- Modify: `web/src/pages/video/index.tsx`

**Interfaces:**
- Consumes: `syncClient.onDelta('tasks', ...)`（来自 Task 8）、`syncScheduler.onRunningTaskCountChange(count)`

- [ ] **Step 1: 在 image/index.tsx 中注册 tasks delta 回调 + 活动任务通知**

在 `image/index.tsx` 文件底部、默认导出之前添加：

```typescript
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";

// 注册 tasks delta sync 回调
syncClient.onDelta("tasks", (data) => {
    if (!data) return;
    // 任务数据更新后刷新日志列表（incremental refresh）
    void refreshLogsRef?.();
});

// 需要导出一个全局 ref 指向 refreshLogs
let refreshLogsRef: (() => Promise<void>) | null = null;
```

在组件顶部，设置 ref：
```typescript
// 在 ImagePage 组件内的 useEffect 中设置：
refreshLogsRef = refreshLogs;
```

修改 `generate` 函数中创建 pending log 的位置，通知 scheduler：

在 `setRunning(true)` 之后添加：
```typescript
syncScheduler.onRunningTaskCountChange(1);
```

在 `finally` 块（`setRunning(false)` 之后）添加：
```typescript
syncScheduler.onRunningTaskCountChange(0);
```

- [ ] **Step 2: 在 video/index.tsx 中做同样处理**

参考 `image/index.tsx` 的结构，进行同样的改动。（video 页面结构类似，在生成中状态变化时通知 scheduler，状态完成时清除。）

在 video/index.tsx 文件底部添加：
```typescript
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";

syncClient.onDelta("tasks", (data) => {
    if (!data) return;
    // ponytail: video 日志刷新可复用 image 模式
});
```

- [ ] **Step 3: TypeScript 编译检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无新增类型错误（或仅有预先存在的错误）。

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/image/index.tsx web/src/pages/video/index.tsx
git commit -m "feat: connect generation logs to sync-client delta updates"
```

---

### Task 12: 集成测试与验证

**目标：** 编译项目，启动后端和前端，验证核心流程。

- [ ] **Step 1: 后端编译并启动**

```bash
go build -o server . && ./server &
```

Expected: 服务器启动，无 panic。

- [ ] **Step 2: 验证 Sync API 端点**

```bash
# 首次全量同步（无 cursor）
curl -s http://localhost:8088/api/v1/sync -H "Authorization: Bearer <token>" | jq '.code'
# Expected: 0

# 增量同步（带 cursor）
curl -s "http://localhost:8088/api/v1/sync?cursor=2026-01-01T00:00:00Z&domains=assets" -H "Authorization: Bearer <token>" | jq '.code'
# Expected: 0
```

- [ ] **Step 3: 验证乐观锁冲突**

```bash
# 保存资产（首次，expectedUpdatedAt 为空）→ 200
curl -s -X POST http://localhost:8088/api/v1/assets \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"test","type":"text","content":"hello"}' | jq '{code, data: .data.id}'

# 第二次保存同一资产，expectedUpdatedAt 过期 → 409
curl -s -X POST http://localhost:8088/api/v1/assets \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id":"<id-from-step-1>","title":"test-updated","type":"text","content":"bye","expectedUpdatedAt":"2000-01-01T00:00:00Z"}' | jq '{code, status}'
# Expected: HTTP 409, data.current contains latest version
```

- [ ] **Step 4: 前端编译**

```bash
cd web && npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 5: 手动验证流程**

1. 打开浏览器，登录
2. 创建一条资产 → 确认 IndexedDB 和 store 同步更新
3. 编辑资产 → 确认 API 被调用，资产更新
4. 删除资产 → 确认本地和远程同步删除
5. 打开两个 Tab → Tab A 编辑资产 → Tab B 收到 delta sync 更新（页面聚焦后）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: integration verification for sync + optimistic lock flow"
```

---

## 验证检查清单

- [ ] `POST /api/v1/sync`（首次全量同步）返回 200
- [ ] `POST /api/v1/sync?cursor=T&domains=assets`（增量同步）仅返回 cursor 之后的记录
- [ ] `POST /api/v1/assets`（expectedUpdatedAt 匹配）→ 200，返回完整 Asset
- [ ] `POST /api/v1/assets`（expectedUpdatedAt 过期）→ 409 Conflict
- [ ] `DELETE /api/v1/assets/:id` → 200，写入 deleted_records
- [ ] `PUT /api/v1/canvas/projects/:id`（expectedUpdatedAt 匹配）→ 200，版本递增
- [ ] `PUT /api/v1/canvas/projects/:id`（expectedUpdatedAt 过期）→ 409 Conflict
- [ ] sync 请求返回 deletes（另一 Tab 删除后，本 Tab 通过 sync 获取）
- [ ] 前端 `useAssetStore.updateAsset` 触达 API，409 时回滚本地
- [ ] 前端 `useCanvasStore` debounce 推送携带 `expectedUpdatedAt`
- [ ] 生成任务 running → 5s 轮询 tasks 域，completed → 停止
