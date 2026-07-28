# Canvas 模块

## 模块边界

- **职责**：管理无限画布项目、节点/连线、交互历史、生成输入编译、助手会话、导入导出和本地 Agent 操作。
- **输入**：用户鼠标/键盘操作、素材、prompt、模型配置、生成任务状态、Agent operations、远端项目 delta。
- **输出**：`CanvasProject Replica`、节点和连线、Generation Run、项目 JSON、ZIP、Canvas 快照。
- **核心文件**：
  - 编排：`web/src/pages/canvas/project/index.tsx`
  - 类型：`web/src/pages/canvas/types.ts`
  - 项目 Store：`web/src/pages/canvas/stores/use-canvas-store.ts`
  - 同步：`web/src/pages/canvas/stores/canvas-sync.ts`
  - Replica 归一化：`web/src/pages/canvas/stores/canvas-replica.ts`
  - 渲染：`web/src/pages/canvas/components/infinite-canvas.tsx`、`canvas-node.tsx`、`canvas-connections.tsx`
  - 生成输入：`web/src/pages/canvas/components/canvas-node-generation.ts`
  - 导入导出：`web/src/pages/canvas/utils/canvas-export.ts`、`export-types.ts`
  - Agent：`canvas-assistant-panel.tsx`、`canvas-local-agent-panel.tsx`、`utils/canvas-agent-ops.ts`
- **数据流**：页面本地 state -> `useCanvasStore.updateProject` -> IndexedDB Replica -> 防抖 REST CAS -> PostgreSQL；远端 delta 反向合并非 dirty 项目。
- **依赖关系**：依赖用户边界、AI 配置、素材/文件、生成 API、sync client、WebDAV、Canvas Agent。
- **常见修改位置**：
  - 项目持久结构：`types.ts` + Store normalize + 导入导出。
  - 交互行为：`project/index.tsx` 和具体 component。
  - 生成输入语义：`canvas-node-generation.ts`。
  - 同步冲突：`canvas-sync.ts` + 后端 canvas repository。
  - Agent 操作：`canvas-agent-ops.ts` + 两个 panel + `canvas-agent/` 契约。

## 项目结构

当前 `CanvasProject` 由本地同步元数据和业务数据组成：

```ts
type CanvasProject = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  localVersion: number;
  dirty: boolean;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  chatSessions: CanvasAssistantSession[];
  activeChatId: string | null;
  backgroundMode: "lines" | "dots" | "blank";
  showImageInfo: boolean;
  viewport: { x: number; y: number; k: number };
};
```

字段语义：

- `revision`：服务端全局序列分配的 CAS 版本。
- `localVersion`：浏览器每次接受项目修改后递增，用于判断一次异步保存期间是否又发生修改。
- `dirty`：本地已接受但服务端尚未确认。
- `tombstones`：Store 级待确认删除 ID，不写入单个项目。
- `project_json`：服务端对内部结构不做字段级理解，保存完整项目 JSON。

## 节点和连线

实际节点类型是五种：

| 类型 | 主要内容 | 常见 metadata |
| --- | --- | --- |
| `text` | 用户文本或文本生成结果 | `content/prompt/fontSize/status/errorDetails` |
| `image` | 图片、批量根或批量子图 | `content/storageKey/fileId/naturalWidth/naturalHeight/batch*` |
| `config` | 生成模式、模型和输出设置 | `generationMode/model/size/count/inputOrder`、视频/音频设置 |
| `video` | 视频引用或结果 | `content/storageKey/fileId/task IDs/status` |
| `audio` | 音频引用或结果 | `content/storageKey/fileId/duration/status` |

`CanvasConnection` 只保存：

```ts
{ id, fromNodeId, toNodeId }
```

连接不保存端口坐标、供应商字段或意图 metadata。渲染时根据节点位置计算 SVG 路径。

连接规则集中在项目页：

- 同一节点不能自连。
- Config 节点之间不能直接连接。
- Config 节点可作为输入汇总点或生成目标的配置来源。
- 删除节点必须同时删除相关连线；批量根节点还要处理子节点。

## 状态所有权

| 状态 | 所有者 | 原因 |
| --- | --- | --- |
| 项目列表、项目业务 JSON、dirty/revision | `useCanvasStore` | 需要账户隔离、持久化和跨页面同步 |
| 节点/连线当前编辑副本 | `project/index.tsx` | 高频交互，避免每个 pointer event 写全局 store |
| 选择、框选、拖拽、连线预览、弹窗 | 项目页本地 state | 短生命周期 UI |
| 项目列表选择/重命名/删除对话框 | `use-canvas-ui-store` | 列表页跨组件 UI 状态 |
| 在线/本地 Agent 面板状态 | `use-canvas-agent-store` | 面板跨组件共享，但不属于项目业务 JSON |
| 在线助手会话 | `CanvasProject.chatSessions` | 需要随项目同步和导出 |
| 本地 Codex thread 历史 | Canvas Agent 工作区 | 不应塞入 Canvas 项目 |

项目页是核心编排器，体积很大。修改时先查对应 helper/component 和调用链；只有出现真实复用或独立状态机时才继续拆分。

## 渲染与交互

Canvas 未使用 React Flow：

- `infinite-canvas.tsx`：世界坐标、viewport、滚轮缩放、平移和 pointer 入口。
- `canvas-node.tsx`：节点内容、编辑、resize 和媒体状态。
- `canvas-connections.tsx`：SVG 贝塞尔连线。
- `canvas-toolbar.tsx`：命令入口，不拥有业务状态。
- `canvas-mini-map.tsx`、`canvas-overview-sidebar.tsx`：项目导航投影。

固定格式元素需要稳定尺寸，避免工具栏、节点状态或动态文本改变布局。Canvas UI 必须使用 `canvasThemes/useThemeStore`，不要硬编码只适合单一主题的颜色。

## 生成输入编译

`canvas-node-generation.ts` 将节点图转换为 `NodeGenerationContext`。核心步骤：

1. 读取目标节点和关联 Config 节点。
2. 按连接关系收集上游文本、图片、视频和音频。
3. 解析 Config Composer 中的 `@[node:id]` 精确引用和 `inputOrder`。
4. 读取节点级模型、尺寸、数量、视频/音频设置。
5. 为第一方视频准备 `fileId` 引用；为兼容路径准备供应商形态输入。
6. 返回项目页执行具体生成。

普通节点默认合并所有有效上游资源；Config Composer 可以精确选择和排序资源。新增一种资源角色或工作流语义时，优先修改这里和 Canvas 类型，不要在 HTTP client 中反推图结构。

## 节点生成流程

```mermaid
flowchart TB
    Target["Target / Config node"]
    Context["buildNodeGenerationContext"]
    Placeholder["Create loading result node"]
    Submit["Submit text/image/video/audio"]
    Task["Store task/profile/model IDs in metadata"]
    Observe["Poll or resume same task"]
    File["Upload or resolve platform file"]
    Result["Update content/fileId/size/status"]
    Store["updateProject -> Replica sync"]

    Target --> Context --> Placeholder --> Submit --> Task --> Observe --> File --> Result --> Store
```

关键语义：

- 图片数量大于 1 时，根节点和子节点通过 `batchRootId/batchChildIds/primaryImageId` 组织。
- 工作流没有独立实体；它就是项目中的节点和连线。
- `Stop Observing` 只停止本地等待，不取消任务。
- 刷新后通过 metadata 中的 `generationTaskId/upstreamTaskId` 恢复观察。
- 旧 loading 节点如果没有可恢复任务 ID，会被标记为中断错误。
- `Retry Run` 必须创建新任务，不能伪装成 resume。

## Canvas Project Replica

### 创建和导入

1. 浏览器生成项目 ID。
2. 本地立即插入 `revision=0/localVersion=1/dirty=true` 的 Replica。
3. 异步 `POST /api/v1/canvas/projects`。
4. 成功后写入服务端 revision；若期间又有修改，仍保持 dirty 并安排 update。

当前缺口：首次 POST 失败后项目会长期保持 `revision=0`，普通 update 同步会跳过它，没有可靠的自动重试队列。

### 更新

1. 项目页调用 `updateProject`。
2. Store 递增 `localVersion`，设置 `dirty=true`。
3. subscription 比较业务字段，安排 4 秒防抖。
4. PUT 发送完整项目和 `expectedRevision`。
5. 服务端 CAS 成功后返回新 revision。
6. `acknowledgeProject` 只有在 `localVersion` 未变化时清除 dirty。

### 删除

1. 本地立刻移除项目并加入 Store tombstone。
2. 异步 DELETE 服务端。
3. 成功或服务端 404 后确认本地 tombstone。
4. 服务端删除和 `deleted_records` Canvas tombstone 同事务。

### 拉取和冲突

- 启动时先水合 IndexedDB，再执行全量项目拉取和 cursor delta。
- 非 dirty 项目只有在远端 revision 更高时才替换。
- dirty 项目拒绝远端 update/delete。
- 409 只提示“本地修改已保留”，不会自动 merge、fork 或覆盖。
- 当 delta 中存在比 dirty 项目更新的 revision 时，Canvas cursor 不前进，避免永久跳过冲突事实。

## 账户隔离

Canvas store key 实际为：

```text
infinite-canvas:canvas_store:<userId>
```

切换用户时：

- 禁止旧账号继续写 scoped storage。
- 清理内存项目和同步 timer。
- 水合新账号缓存。
- 所有异步 server response 在应用前检查 `{token,userId}` 未变化。

媒体 Blob store 没有按账号物理分库，因此业务引用必须通过项目/素材边界隔离，不能用遍历 Blob store 作为账号数据列表。

## 媒体引用

Canvas 节点可能同时有：

- `storageKey`：浏览器 IndexedDB Blob 的长期引用。
- `fileId`：平台 S3 文件的长期引用。
- `content`：当前会话可展示的 `blob:` 或预签名 URL。

读取优先级取决于场景：

- 本地展示：通过 `storageKey` 还原 object URL。
- 第一方生成：必须使用可授权的 `fileId`。
- 兼容上游：可使用上传后的平台 URL、data URI 或协议允许的引用。
- 导出/WebDAV：收集所有 `storageKey` 并携带 Blob。

## 在线助手

`canvas-assistant-panel.tsx` 使用当前网页文本模型：

- 提供画布快照和选中/上游节点上下文。
- 最多执行有限轮工具调用。
- 将 tool call 校验并转换为 `CanvasAgentOp`。
- 写操作可先进入确认卡片。
- 会话保存到项目 `chatSessions`。

修改工具 schema 时需要同步：

1. 助手提示和 tool definition。
2. `toCanvasAgentOp` 输入验证。
3. `CanvasAgentOp` union。
4. 项目页应用操作的实现。

## 本地 Canvas Agent

`canvas-local-agent-panel.tsx` 通过 HTTP/SSE 连接 `canvas-agent`：

- 上报当前 Canvas snapshot。
- 发送 prompt 和本地图片附件。
- 接收 Codex 事件和待执行工具。
- 用户确认后应用 ops，再回传工具结果。

网页侧 Store 只保存面板临时状态；thread、workspace 和历史由本地 Agent 管理。详细通信见 [runtime-supporting-systems.md](runtime-supporting-systems.md)。

## 导入、导出与 WebDAV

ZIP 导出：

- `projects.json` 当前格式版本为 3。
- 每个项目携带业务 JSON。
- 递归收集 `storageKey`，把对应 Blob 放在 `projects/<id>/files/`。

WebDAV：

- Canvas 与个人素材、工作台日志一起做用户触发的全快照 merge。
- merge 主要按 ID 和 `updatedAt/createdAt`。
- WebDAV 是同步参与者，不应凭空删除本地 `Offline Dirty`。
- 企业素材不参与。

## 常见修改地图

| 需求 | 优先修改 |
| --- | --- |
| 新节点类型 | `types.ts`、`constants.ts`、`canvas-node.tsx`、项目创建/复制/导出逻辑 |
| 新节点 metadata | `types.ts`、normalize、生成输入、导入导出、相关 UI |
| 新连线规则 | 项目页 `normalizeConnection` 和输入编译 |
| 新生成参数 | Config UI + node metadata + `canvas-node-generation.ts` + API contract |
| 新批量展示 | batch metadata、节点渲染、overview、删除/复制逻辑 |
| 修改项目同步 | Store、`canvas-sync.ts`、后端 canvas/sync repository |
| 新 Agent 工具 | `canvas-agent-ops.ts`、在线/本地 panel、`canvas-agent/src/schemas.ts` |
| 修改导出格式 | `export-types.ts`、`canvas-export.ts`、导入入口、WebDAV |
| 修改主题 | `canvas-theme.ts`、Theme Store、Canvas 组件 token |

## 已知限制

- 核心项目页承担过多编排职责。
- 新建项目 POST 失败没有可靠重试。
- 409 冲突只有保留本地，没有 merge UI。
- `cleanupImages` 是空实现，Blob 可能累积。
- Undo/Redo 快照不包含 viewport；视口单独持久化。
- 旧文档只列图片/文本/config 等较少节点类型，不能作为当前类型来源。
- 本地 Agent 当前单一 Canvas state/广播模型不适合可靠的多画布并发。
