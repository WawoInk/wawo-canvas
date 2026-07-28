# Project Knowledge Index

这是 AI Agent 的知识路由表，不是项目说明书。

先判断任务属于哪个主题，只读取对应文档。不要默认加载整个 `.knowledge` 目录。

## Routing Rules

- 按每个主题的 `Read` 顺序加载文档。
- 跨模块行为额外读取 [business-flows.md](business-flows.md)。
- 修改 HTTP 合同额外读取 [api.md](api.md)。
- 修改持久化、事务或同步语义额外读取 [database.md](database.md)。
- 修改领域词汇或不变量时，同时读取根目录 `CONTEXT.md` 和相关 Accepted ADR。
- 事实冲突时，以当前代码、数据库约束和测试为准。

## Unknown Scope

When:

- 第一次进入项目
- 无法判断改动属于哪个模块
- 改动可能跨越前端、后端和浏览器本地状态

Read:

- [architecture.md](architecture.md)
- [business-flows.md](business-flows.md)
- 再选择下面最接近的主题

## Architecture

When:

- 新增、拆分或删除服务
- 修改系统结构、模块边界或启动顺序
- 修改前后端职责、状态所有权或持久化边界
- 修改外部依赖或运行拓扑

Read:

- [architecture.md](architecture.md)
- [runtime-supporting-systems.md](runtime-supporting-systems.md)，涉及运行或部署时
- [business-flows.md](business-flows.md)，改变现有业务链路时

## Backend

When:

- 修改 `handler/`、`service/`、`repository/` 或 `model/`
- 修改认证、用户、企业、积分或权限
- 修改设置、模型渠道、价格或提示词
- 修改个人/企业素材、平台文件或管理后台
- 新增后端业务模块

Read:

- [backend-modules.md](backend-modules.md)
- [api.md](api.md)，接口行为变化时
- [database.md](database.md)，查询、事务或持久化变化时
- [business-flows.md](business-flows.md)，行为跨模块时

## Frontend

When:

- 新增或修改页面、路由、布局或 Provider
- 修改 Zustand Store、TanStack Query 或页面状态
- 修改登录态、账号切换或本地数据隔离
- 修改 AI 配置、模型选择或 API 请求层
- 修改素材、Blob、工作台或管理后台

Read:

- [frontend-modules.md](frontend-modules.md)
- [api.md](api.md)，请求或响应合同变化时
- [business-flows.md](business-flows.md)，影响冷启动、账号边界或同步时
- [canvas.md](canvas.md)，改动位于 Canvas 时

## Canvas

When:

- 修改节点类型、节点字段或连线规则
- 修改渲染、缩放、拖拽、选择或快捷操作
- 修改项目 JSON、历史记录或 viewport
- 修改生成输入编译
- 修改 Replica、`dirty`、revision、tombstone、保存或冲突
- 修改导入导出、WebDAV、助手或 Agent operations

Read:

- [canvas.md](canvas.md)
- [business-flows.md](business-flows.md)
- [generation.md](generation.md)，涉及节点生成时
- [api.md](api.md) 和 [database.md](database.md)，涉及服务端同步时
- [runtime-supporting-systems.md](runtime-supporting-systems.md)，涉及 Canvas Agent 时

## AI Generation

When:

- 修改图片、文本、音频或视频生成
- 新增或修改 Provider、Channel、Protocol 或 Model Profile
- 修改 Compatibility API 或 `GenerationCommand`
- 修改 worker、lease、Adapter、轮询或回调
- 修改 Stop、Resume、Cancel 或 Retry
- 修改计费、任务审计或结果物化

Read:

- [generation.md](generation.md)
- [api.md](api.md)
- [database.md](database.md)，涉及任务生命周期、幂等、计费或审计时
- [business-flows.md](business-flows.md)
- [canvas.md](canvas.md)，结果进入 Canvas 节点时

## Database

When:

- 新增或删除表
- 修改字段、类型、索引、外键、CHECK 或触发器
- 修改 GORM model、AutoMigrate 或手写 DDL
- 修改查询、分页、锁、事务或 CAS
- 修改 revision、cursor、删除记录或任务持久化

Read:

- [database.md](database.md)
- [backend-modules.md](backend-modules.md)
- [business-flows.md](business-flows.md)，事务语义变化时
- [api.md](api.md)，字段暴露到接口时

After:

- 同步更新 `docs/content/docs/backend/backend-database.mdx`

## HTTP API

When:

- 新增、删除或重命名路由
- 修改鉴权、请求参数、响应字段或错误语义
- 修改 `{code,data,msg}` 响应信封
- 修改文件、流、OAuth、回调或兼容接口

Read:

- [api.md](api.md)
- [backend-modules.md](backend-modules.md)
- [generation.md](generation.md)，修改生成接口时
- [frontend-modules.md](frontend-modules.md)，前端调用合同变化时

After:

- 确认 `router/router.go` 的变更已同步到 [api.md](api.md)

## Business Flows

When:

- 修改冷启动、登录、账号切换或权限失效
- 修改企业、成员、积分划拨或折扣
- 修改 Canvas 保存、删除、同步、导入或导出
- 修改个人素材、企业素材或文件流转
- 修改任一种生成生命周期
- 修改提示词同步、WebDAV 或 Agent 协作
- 排查单个模块无法解释的端到端问题

Read:

- [business-flows.md](business-flows.md)
- 对应模块文档
- [api.md](api.md) 和 [database.md](database.md)，链路经过服务端时

## Runtime and Supporting Systems

When:

- 修改环境变量、配置加载或后台任务
- 修改本地开发、Docker、Caddy 或蓝绿部署
- 修改启动、关闭或健康检查
- 修改 Canvas Agent、Codex 插件或 MCP
- 修改独立 Docs 应用

Read:

- [runtime-supporting-systems.md](runtime-supporting-systems.md)
- [architecture.md](architecture.md)
- [canvas.md](canvas.md)，修改 Agent 与画布契约时
- [api.md](api.md)，修改运行时接口时

## Documentation

When:

- 更新用户功能说明或开发文档
- 更新 AI 上下文、领域词汇或架构决策
- 功能从待办进入待测试或正式说明

Read:

- 根目录 `AGENTS.md`
- 根目录 `CONTEXT.md`
- `docs/index.md`
- 对应的 `.knowledge` 文档
- `docs/content/docs/progress/todo.mdx`
- `docs/content/docs/progress/pending-test.mdx`

After:

- 路由变化更新 [api.md](api.md)
- Schema 变化更新 [database.md](database.md) 和正式数据库文档
- 领域状态、生成合同或持久化边界变化更新对应模块文档
- 用户功能进度遵循 `todo.mdx -> pending-test.mdx -> features.mdx`
