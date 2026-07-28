# Infinite Canvas 长期维护知识库

本目录面向后续 AI Agent 和维护者。它不是用户手册，也不是代码清单；目标是在进入某个修改前，快速建立可靠的系统边界、数据流、依赖关系和改动落点。

统一知识入口见 [index.md](index.md)。本文件保留知识库的事实优先级、分册说明和维护约定。

## 事实优先级

遇到冲突时按以下顺序判断：

1. 当前代码、数据库约束和测试。
2. 根目录 `CONTEXT.md` 中的领域词汇与已接受的不变量。
3. `docs/architecture/` 中标记为 Accepted 的架构决策。
4. 本知识库。
5. `README.md`、用户文档和 `docs/superpowers/` 中的历史设计稿。

历史设计稿用于解释为什么形成当前结构，不能直接当成已实现事实。尤其需要注意：

- `docs/superpowers/specs/2026-07-07-postgres-source-of-truth-refactor-design.md` 已被当前 Canvas Replica 行为部分修正：服务端不能用空响应或远端删除覆盖本地 `dirty` 项目。
- `docs/content/docs/backend/canvas-data-structure.mdx` 仍以较早的纯本地结构为主，遗漏了 `revision/localVersion/dirty/tombstones`。
- `docs/architecture/generation-platform.md` 描述长期目标；当前第一方生成只落地了 `video.generate` 和 `video.short-drama`。

## 推荐阅读顺序

| 任务 | 先读 | 再读 |
| --- | --- | --- |
| 初次进入项目 | [architecture.md](architecture.md) | [backend-modules.md](backend-modules.md)、[frontend-modules.md](frontend-modules.md) |
| 修改 Canvas | [canvas.md](canvas.md) | [business-flows.md](business-flows.md)、[api.md](api.md) |
| 修改生成、模型或计费 | [generation.md](generation.md) | [database.md](database.md)、[api.md](api.md) |
| 修改账号、企业或积分 | [backend-modules.md](backend-modules.md) | [database.md](database.md)、[business-flows.md](business-flows.md) |
| 修改素材或文件 | [frontend-modules.md](frontend-modules.md) | [backend-modules.md](backend-modules.md)、[database.md](database.md) |
| 修改接口 | [api.md](api.md) | 对应模块文档 |
| 修改部署、Agent、插件或 docs | [runtime-supporting-systems.md](runtime-supporting-systems.md) | [architecture.md](architecture.md) |

## 文件索引

- [architecture.md](architecture.md)：仓库组成、运行拓扑、分层、状态和持久化边界。
- [backend-modules.md](backend-modules.md)：Go 后端模块职责、输入输出、依赖和常见修改位置。
- [frontend-modules.md](frontend-modules.md)：Vite SPA、全局状态、页面模块、本地缓存和 API 映射。
- [canvas.md](canvas.md)：Canvas 数据模型、交互编排、Replica 同步、生成输入和 Agent 操作。
- [generation.md](generation.md)：本地直连、兼容代理、第一方 Generation Run、计费、worker 和终态。
- [database.md](database.md)：13 张表、序列、索引、事务边界、查询语义和 schema 联动。
- [api.md](api.md)：完整 HTTP API 分组、鉴权、输入输出和代码落点。
- [business-flows.md](business-flows.md)：关键端到端业务流程。
- [runtime-supporting-systems.md](runtime-supporting-systems.md)：Docker、蓝绿部署、Canvas Agent、Codex 插件和 docs 应用。

## 项目速览

- 主 Web：`web/`，Vite + React + React Router + Ant Design + Zustand + TanStack Query。
- API：仓库根目录 Go 模块，Gin + GORM + PostgreSQL。
- 二进制文件：S3 兼容对象存储；数据库只保存 `S3Key/fileId` 和元数据。
- 本地媒体：浏览器 IndexedDB 的 `image_files/media_files`，由 `storageKey` 引用。
- 文档站：`docs/`，独立 Next.js + Fumadocs 应用。
- 本地 Agent：`canvas-agent/`，HTTP/SSE + Codex app-server + stdio MCP。
- Codex 插件：`plugins/infinite-canvas/`，静态 manifest、skills 和 MCP 配置。

## 核心领域词汇

以下词汇来自 `CONTEXT.md`，后续 Agent 应沿用：

- **Model Profile**：稳定、可部署的生成选择；不是上游模型名或渠道。
- **Generation Run**：一次持久化的 Canvas 生成尝试，连接输入、Profile、任务和终态结果。
- **Materialized Result**：已经落入平台文件系统、可由 `fileId` 使用的终态结果。
- **Stop Observing**：停止本地轮询，不改变任务。
- **Resume Observing**：继续观察同一个任务，不重新提交。
- **Cancel Run**：请求取消任务，由终态仲裁决定是否成功。
- **Retry Run**：从旧输入创建新的 Generation Run。
- **Canvas Project Replica**：浏览器可用的画布副本，不等同于临时缓存。
- **Offline Dirty**：已在本地接受、尚未被同步参与者确认的修改。
- **Tombstone**：明确的删除事实；远端缺少记录不是 Tombstone。
- **Account Data Boundary**：当前用户 ID，是 Canvas、个人素材、游标和本地历史的隔离边界。
- **Enterprise Shared Asset**：企业按需读取的共享素材，不进入个人素材缓存或 WebDAV。

## 最重要的边界

1. `handler/` 解析 HTTP，`service/` 做业务决策，`repository/` 做数据库访问，`model/` 定义结构。
2. 用户自定义 AI API Key 保存在浏览器；平台远程渠道 Key 保存在服务端 `settings.private`。
3. Canvas 是本地先接受修改的 Replica；个人素材写入则以后端成功为主。
4. 企业素材与个人素材是两条独立数据链，不能通过个人 store、同步或文件 API 混用。
5. 第一方生成结果只有在转存为平台文件后才算成功。
6. `generation_tasks` 是统一任务事实表；`generation_task_events` 只是审计，不是事件溯源。
7. 工作流没有独立表，节点、连线和配置都在 `canvas_projects.project_json`。
8. API 业务失败通常仍是 HTTP 200；调用方必须同时检查响应信封的 `code`。

## 维护本知识库

- 只记录已经由代码或约束证明的结构。
- 新增模块时优先更新现有分册，不为单一小功能创建新文件。
- 路由、表结构、领域状态或持久化边界变化时，应同步更新对应知识文件。
- 用户功能文档仍按 `AGENTS.md` 的 todo、pending-test、features 流程维护；`.knowledge` 不替代该流程。
