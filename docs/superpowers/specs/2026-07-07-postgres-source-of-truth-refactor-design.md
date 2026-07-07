# 重构设计文档：PostgreSQL 为唯一真相源，IndexedDB 为缓存层

- **日期**：2026-07-07
- **主题**：修复当前「IndexedDB 为主、PostgreSQL 为从」的颠倒架构，确立「服务器是真相、客户端是缓存」原则，覆盖 Canvas / Assets / Generation Logs 三个数据域
- **状态**：已通过 brainstorming 全部决策评审，待用户复核后进入 writing-plans

---

## 1. 背景与目标

### 1.1 现状判断

经代码审查确认，当前实现与「服务器是真相、客户端是缓存」原则**大部分不符**：

| 数据域 | 当前主存储 | 后端角色 | 违背点 |
|--------|-----------|---------|--------|
| Canvas 项目 | IndexedDB (localforage) | 延迟镜像（4s debounce + beforeunload flush） | 数据流向颠倒；后端无乐观锁；多设备编辑不可见 |
| 资产 (Assets) | IndexedDB (localforage) | 懒镜像（fire-and-forget） | `updateAsset()` 永不同步后端，清浏览器数据则永久丢失 |
| 生成日志 | IndexedDB (cache) + 后端 | 后端为真相源（proxy 自动记录） | **已符合模式**，仅需补 delta sync |

### 1.2 五个差距

1. 数据流向颠倒——IndexedDB 是主，PostgreSQL 是从
2. 资产编辑 (`updateAsset`) 永不同步到后端
3. Canvas 同步依赖 debounce + beforeunload（脆弱）
4. 无后台拉取最新状态（多设备编辑不可见）
5. 后端无冲突检测，last-write-wins

### 1.3 目标

将 Canvas 和 Assets 两个域重构为「PostgreSQL 真相源 + IndexedDB 缓存」架构，并为生成日志域补齐 delta sync 能力。Generation Logs 域已基本符合，仅扩展。

---

## 2. 决策汇总

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 修复范围 | 全部 5 个差距，彻底重构 |
| 2 | 离线支持 | 不需要，必须在线，断网时应用不可用 |
| 3 | 写路径 | API 响应即缓存——mutation API 返回最新记录，前端直接写入 IndexedDB |
| 4 | 同步路径 | cursor-based delta sync——`updated_at` cursor，返回 `{updates, deletes, cursor}` |
| 5 | 冲突检测 | 乐观锁——客户端写时带 `updatedAt`，后端条件更新，不匹配 → 409 Conflict |
| 6 | 同步触发 | 页面加载 + Tab 聚焦（`visibilitychange`）|
| 7 | 轮询频率优先级 | C（生命周期）> A（数据域）> B（用户活动降频）|
| 8 | 删除同步 | 独立 `deleted_records` 表记录 `(table_name, record_id, user_id, deleted_at)` |
| 9 | 资产写路径 | 每次编辑立即调 API，乐观锁失败回滚本地并提示 |
| 10 | Canvas 写路径 | 保持当前 4s debounce + beforeunload flush |

---

## 3. 目标架构

### 3.1 高层数据流

```
PostgreSQL (唯一真相源)
    │
    ├── Mutation API ──── 写操作 → 返回最新记录 → 更新 IndexedDB
    │   (POST/PUT/DELETE)
    │
    └── Sync API ──────── GET /api/v1/sync?cursor=xxx
                            │
                            │ 返回 { updates: [...], deletes: [...], cursor: "..." }
                            ▼
                       IndexedDB (缓存层)
                            │
                            ▼
                        React State
```

**读路径**：页面加载 → IndexedDB 立即出数据（50ms）→ 后台 delta sync 覆盖最新 → React 更新

**写路径**：React mutation → API → 返回最新记录 → 更新 IndexedDB → React 确认

**同步路径**：页面加载 / Tab 聚焦 / 生命周期轮询 → GET /sync?cursor → 增量更新 IndexedDB

### 3.2 离线策略

明确不支持离线。断网时：
- 读：展示 IndexedDB 缓存的历史数据（只读降级），UI 显示「连接断开」状态
- 写：禁止，操作按钮禁用并提示「需要网络连接」
- 不实现写队列、不实现回放，YAGNI

---

## 4. 后端设计

### 4.1 新增表：`deleted_records`

```go
// model/deleted_record.go
type DeletedRecord struct {
    ID        uint64    `json:"-" gorm:"primaryKey;autoIncrement"`
    TableName string    `json:"tableName" gorm:"column:table_name;index:idx_deleted_records_user_time,priority:2"`
    RecordID  string    `json:"recordId" gorm:"column:record_id;index:idx_deleted_records_user_time,priority:2"`
    UserID    string    `json:"userId" gorm:"column:user_id;index:idx_deleted_records_user_time,priority:1"`
    DeletedAt time.Time `json:"deletedAt" gorm:"column:deleted_at;index:idx_deleted_records_user_time,priority:2"`
}
```

- 每次物理删除前，先插入一行到 `deleted_records`
- Sync API 查询 `WHERE user_id = ? AND deleted_at > cursor` 返回 `(tableName, recordId)` 列表
- 定期 TTL 清理：保留 30 天，超期删除（cron 或 lazy 清理，实现细节留给 writing-plans）

### 4.2 乐观锁：`updated_at` 条件更新

当前 Asset / CanvasProject 的 `UpdatedAt` 是 `string` 类型。保留 string 序列化兼容性，但写入时用条件更新：

**Asset（`repository/asset.go` SaveAsset 改造）**：
```go
// ponytail: 用 updated_at 做乐观锁条件，避免 last-write-wins 静默覆盖
func SaveAssetWithLock(item model.Asset, expectedUpdatedAt string) (model.Asset, bool, error) {
    db, _ := DB()
    // INSERT 或条件 UPDATE
    result := db.Model(&model.Asset{}).
        Where("id = ? AND (updated_at = ? OR updated_at = '')", item.ID, expectedUpdatedAt).
        Updates(map[string]interface{}{...})  // 各字段
    if result.RowsAffected == 0 {
        // 检查是否存在 → 存在则 409，不存在则需 create
        return item, false, nil  // conflict
    }
    // 重新读取返回最新记录
    return findAsset(db, item.ID)
}
```

**CanvasProject（`UpdateCanvasProject` 改造）**：
- 当前 `Version` 字段盲目递增，改为 `WHERE id = ? AND updated_at = ?` 条件更新
- 失败返回 409，前端提示刷新
- `Version` 字段保留（向后兼容），但不再作为并发依据

**Handler 行为**：
- 写 API 接受 `If-Match: <updatedAt>` header 或 body 中的 `expectedUpdatedAt` 字段
- 冲突时返回 `409 Conflict` + `{code: "CONFLICT", data: {current: <latest>, msg: "记录已被其他会话修改"}}`

### 4.3 Mutation API 返回最新记录

所有写 API 的响应体改为返回**完整最新记录**（不是只返回 id），让前端直接写缓存：

| API | 当前响应 | 改后响应 |
|-----|---------|---------|
| `POST /v1/assets` | 成功/失败 | 返回完整 Asset |
| `DELETE /v1/assets/:id` | 成功/失败 | 返回 `{id, deletedAt}` |
| `PUT /v1/canvas/projects/:id` | 成功/失败 | 返回完整 CanvasProject |
| `POST /v1/canvas/projects` | 已返回 id | 返回完整 CanvasProject |
| `DELETE /v1/canvas/projects/:id` | 成功/失败 | 返回 `{id, deletedAt}` |

### 4.4 Sync API

新增统一 delta sync 端点：

```
GET /api/v1/sync?cursor=2026-07-07T09:00:00Z&domains=assets,canvas,tasks
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "cursor": "2026-07-07T09:30:00Z",
    "assets": { "updates": [...], "deletes": ["asset-xxx", ...] },
    "canvas": { "updates": [...], "deletes": ["proj-xxx", ...] },
    "tasks":  { "updates": [...], "deletes": ["task-xxx", ...] }
  }
}
```

**查询逻辑**：
- `updates`：`WHERE user_id = ? AND updated_at > cursor ORDER BY updated_at`，分页上限 200 条
- `deletes`：从 `deleted_records` 查 `WHERE user_id = ? AND deleted_at > cursor`
- `cursor`：本次返回的最新 `updated_at`（取 updates 和 deletes 中的最大值）
- 首次同步（cursor 为空）：返回全量列表 + 全部 deletes

**domains 参数**：可选，逗号分隔，缺省全部。用于按数据域独立同步（配合轮询频率策略）。

### 4.5 Repository 新增方法

```go
// repository/sync.go
func ListUpdatedAssets(userID, cursor string, limit int) ([]model.Asset, error)
func ListUpdatedCanvasProjects(userID, cursor string, limit int) ([]model.CanvasProject, error)
func ListUpdatedGenerationTasks(userID, cursor string, limit int) ([]model.GenerationTask, error)
func ListDeletedRecords(userID, cursor string) ([]model.DeletedRecord, error)
func PruneDeletedRecords(olderThan time.Time) error  // TTL 清理
```

---

## 5. 前端设计

### 5.1 新增：Sync 客户端

`web/src/services/sync-client.ts`：

```ts
// ponytail: 单例 sync 客户端，持有 cursor，按策略触发
class SyncClient {
  private cursor: string | null = null;  // 从 localforage 持久化
  private domains: Domain[] = ['assets', 'canvas', 'tasks'];

  // 页面加载 + visibilitychange 调用
  async syncAll(): Promise<void>

  // 按数据域独立调用（配合轮询频率）
  async syncDomain(domain: Domain): Promise<void>

  // 应用 updates / deletes 到对应 store
  private applyDelta(delta: SyncDelta): void
}
```

- cursor 持久化到 localforage（key: `infinite-canvas:sync_cursor:<userId>`）
- 用户切换时重置 cursor（新用户首次全量同步）
- 失败时保留旧 cursor，下次重试

### 5.2 轮询调度器

`web/src/services/sync-scheduler.ts`，实现 C > A > B 优先级：

**C（生命周期驱动）**：
- 有 `running`/`pending` 的生成任务 → 5s 轮询 `tasks` 域
- 全部完成 → 停止 `tasks` 高频轮询

**A（数据域驱动）**：
- `canvas` / `assets`：60s 轮询
- `tasks`（无活跃任务时）：不轮询，仅页面加载 + Tab 聚焦

**B（用户活动降频）**：
- 用户活跃编辑（最近 2 分钟有 mutation）→ 暂停轮询（本地操作已覆盖）
- 闲置 2 分钟后 → 恢复 A 的频率

**触发点**：
- 页面加载（`DOMContentLoaded` / React root mount）
- Tab 聚焦（`visibilitychange` → visible）
- 定时器（按上述策略调度）

### 5.3 Store 重构：`use-asset-store.ts`

**核心改变**：IndexedDB 从「主存储」降为「缓存层」。

```ts
// 读路径
async function hydrate() {
  // 1. IndexedDB 立即出数据（50ms）
  const cached = await loadFromIndexedDB();
  set({ assets: cached });
  // 2. 后台 delta sync 覆盖
  syncClient.syncDomain('assets');
}

// 写路径：每次编辑立即调 API
async function updateAsset(id, patch) {
  const local = get().assets.find(a => a.id === id);
  const res = await api.put(`/v1/assets/${id}`, {
    ...patch,
    expectedUpdatedAt: local.updatedAt,  // 乐观锁
  });
  if (res.status === 409) {
    // 回滚：用 server 返回的 current 覆盖本地
    set({ assets: get().assets.map(a => a.id === id ? res.data.current : a) });
    notifyConflict('资产已被其他会话修改，已刷新为最新版本');
    return;
  }
  // 成功：用 API 返回的最新记录更新 IndexedDB
  await upsertIndexedDB(res.data);
  set({ assets: mergeAsset(get().assets, res.data) });
}
```

- 删除 `syncAssetsFromBackend()` 的全量 merge 逻辑，改为依赖 syncClient
- 删除 `syncNewAssetToBackend()` 的 fire-and-forget，改为 await + 失败回滚
- `removeAssetWithFile`：改为 await API 删除，成功后从 IndexedDB 移除
- IndexedDB 仅在 API 成功后写入（不再独立承载真相）

### 5.4 Store 重构：`use-canvas-store.ts`

**核心改变**：保留 debounce 写（决策 10），但去掉「local 优先 merge」逻辑。

```ts
// 读路径
async function hydrate() {
  const cached = await loadFromIndexedDB();
  set({ projects: cached });
  syncClient.syncDomain('canvas');  // 不再 local-wins，而是 delta 覆盖
}

// 写路径：保持 debounce
const debouncedUpdate = debounce(async (id, patch) => {
  const local = get().projects.find(p => p.id === id);
  const res = await api.put(`/v1/canvas/projects/${id}`, {
    ...patch,
    expectedUpdatedAt: local.updatedAt,
  });
  if (res.status === 409) {
    // 回滚本地，提示刷新
    syncClient.syncDomain('canvas');  // 拉取最新
    notifyConflict('画布已被其他会话修改');
    return;
  }
  upsertIndexedDB(res.data);
}, 4000);

// beforeunload flush 保留（决策 10）
```

- **关键删除**：`syncFromBackend()` 中的「local 有内容就保留 local」逻辑改为「server delta 直接覆盖」
- 空项目 stub 逻辑保留（避免首屏加载全量 projectJson）

### 5.5 Generation Logs 域（已符合，仅扩展）

当前 `image/index.tsx` 和 `video/index.tsx` 已是「API 优先、local fallback」。改动：

- `refreshLogs()` 不再每次全量拉取，改为通过 syncClient 增量同步 `tasks` 域
- 保留 local fallback（断网时只读降级，配合 3.2 策略）
- `saveLog()` 保留「local 先写 → API 同步」，但 API 成功后用返回的最新记录覆盖 local

### 5.6 IndexedDB 写入时机统一

所有 store 遵循同一规则：**仅在 API 成功后写 IndexedDB**。

| 操作 | IndexedDB 写入时机 |
|------|-------------------|
| 读 | hydrate 时从缓存加载 + delta sync 覆盖 |
| 创建 | API 成功响应后 |
| 更新 | API 成功响应后（409 时用 server current 覆盖） |
| 删除 | API 成功响应后 |
| sync delta | applyDelta 时 |

---

## 6. 数据流示例

### 6.1 用户重新打开页面

```
1. React mount
2. hydrate(): IndexedDB 缓存立即出数据 (50ms) → UI 显示历史
3. syncClient.syncAll(): GET /sync?cursor=上次cursor
4. 返回 delta → applyDelta 更新 IndexedDB + store
5. UI 显示最新状态
```

### 6.2 多设备编辑同一条资产

```
设备 A: PUT /v1/assets/123 (expectedUpdatedAt: T1) → 200, 返回 updatedAt: T2
设备 B: PUT /v1/assets/123 (expectedUpdatedAt: T1) → 409 (current updatedAt: T2)
设备 B: 回滚本地，提示「已被修改，已刷新为 T2 版本」
```

### 6.3 设备 A 删除资产，设备 B 还开着

```
设备 A: DELETE /v1/assets/123 → 写 deleted_records
设备 B: 定时轮询 /sync → 返回 deletes: ["123"]
设备 B: 从 IndexedDB 和 store 移除 asset 123
```

---

## 7. 测试策略

### 7.1 后端单元测试

- `SaveAssetWithLock`：相同 expectedUpdatedAt 成功；过期 expectedUpdatedAt 返回 conflict
- `ListUpdatedAssets`：cursor 过滤正确，分页上限生效
- `ListDeletedRecords`：仅返回当前用户、cursor 之后的记录
- Sync API 集成测试：全量首次同步 + 增量后续同步

### 7.2 前端单元测试

- `SyncClient.applyDelta`：updates 和 deletes 正确应用到 store
- `updateAsset` 409 回滚：mock API 返回 409，断言本地被 server current 覆盖
- Scheduler：生命周期驱动（有 running task → 5s）、数据域驱动、用户活动降频

### 7.3 端到端验证

- 两 Tab 编辑同一条资产 → 后者收到 409 并回滚
- 一 Tab 删除 → 另一 Tab 轮询后本地消失
- 生成任务 running → 5s 轮询，completed → 停止

---

## 8. 范围与非目标

### 8.1 本轮范围

- 后端：新增 `deleted_records` 表 + Sync API + 乐观锁 + mutation 返回完整记录
- 前端：新增 syncClient + scheduler，重构 asset/canvas store 的读写路径
- 三个数据域：Assets、Canvas、Generation Tasks

### 8.2 非目标（YAGNI）

- **离线写队列 / 回放**：明确不支持离线（决策 2）
- **WebSocket / SSE 实时推送**：轮询 + delta sync 已足够，YAGNI
- **字段级 merge**：乐观锁 + 全量覆盖已足够（决策 5 排除 C）
- **WebDAV 同步改造**：当前 WebDAV 是独立导出机制，本轮不动
- **User / Config / Theme store 改造**：这些域不用 IndexedDB，不涉及
- **Admin 后台同步**：Admin 是只读视图，不参与 delta sync

### 8.3 已知遗留问题（不在本轮范围，记录待后续）

- Admin 资产列表疑似 bug（`userID=""` 导致返回空）—— 独立修复
- Asset model 的 `Width/Height/Bytes/MimeType` 字段 service 层从未设置 —— 独立修复
- Canvas 的 `Version` 字段保留但不再作为并发依据 —— 兼容性保留

---

## 9. 实施顺序建议（留给 writing-plans 细化）

1. 后端：`deleted_records` 表 + migration
2. 后端：乐观锁改造（SaveAssetWithLock、UpdateCanvasProject）
3. 后端：mutation API 返回完整记录
4. 后端：Sync API + repository 方法
5. 前端：syncClient + scheduler
6. 前端：use-asset-store 重构
7. 前端：use-canvas-store 重构
8. 前端：generation logs 接入 syncClient
9. 集成测试 + 端到端验证
