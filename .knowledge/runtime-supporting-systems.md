# 运行架构与辅助子系统

本文覆盖 `config/`、Docker/Compose、`deploy/`、`canvas-agent/`、`plugins/` 和 `docs/`。主前后端业务见其他分册。

## 配置模块

- **职责**：加载 API 进程环境变量并生成缺省 JWT secret。
- **输入**：当前目录 `.env`、进程环境。
- **输出**：全局 `config.Cfg`。
- **核心文件**：`config/config.go`、`.env.example`、`.env.production.example`。
- **数据流**：`godotenv.Load` -> `env.Parse` -> `config.Cfg` -> service/repository。
- **依赖关系**：API 端口、管理员、JWT、PostgreSQL、PUBLIC_BASE_URL、Linux.do endpoints 和 S3。
- **常见修改位置**：新增环境变量先改 `Config` struct，再更新示例文件和部署 Compose。

配置矩阵：

| 范围 | 配置 | 说明 |
| --- | --- | --- |
| API | `PORT`, `SHUTDOWN_TIMEOUT` | 默认 `8080/30s`；容器通常覆盖为 `8088` |
| 身份 | `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, `JWT_EXPIRE_HOURS` | 默认或空 JWT 会随机生成且不持久化 |
| 数据库 | `DATABASE_DSN` | 仅 PostgreSQL |
| 公网 | `PUBLIC_BASE_URL` | 公开 reference media 和回调/外部可访问 URL |
| OAuth endpoints | `LINUX_DO_AUTHORIZE_URL`, `LINUX_DO_TOKEN_URL`, `LINUX_DO_USERINFO_URL` | Client ID/Secret 实际来自 private settings |
| S3 | `AMAZON_S3_URL`, `AMAZON_REGION`, `AMAZON_S3_ACCESS_KEY`, `AMAZON_S3_SECRET_KEY` | `AWS_ENDPOINT_URL_S3` 可启用自定义 endpoint/path-style |
| Vite dev | `API_BASE_URL` | 仅开发服务器 `/api` proxy |
| Vite build | `VITE_DOC_URL` | 文档站地址；当前 `.env.example` 仍误写 `NEXT_PUBLIC_DOC_URL` |
| Canvas Agent | `PORT` | 默认 `17371`；与 Go API 的同名变量属于不同进程 |

Go、Compose 和蓝绿脚本默认读取 `.env`，不是 `.env.production`。

## 本地开发

- **职责**：启动 PostgreSQL、Go API 和 Vite Web。
- **输入**：源码、`.env`、Node/Go 依赖。
- **输出**：Web `3000`、API `8088`、PostgreSQL。
- **核心文件**：`docker-compose.local.yml`、`Dockerfile.dev`、`web/vite.config.ts`。
- **数据流**：Vite `/api` -> Go API -> PostgreSQL/S3/upstream。
- **依赖关系**：根目录 Go 模块和 `web/package.json`。
- **常见修改位置**：
  - HMR/volume/ports：local Compose 和 Dockerfile.dev。
  - API proxy：Vite config。

根目录没有一个统一的应用脚本；Web、docs 和 canvas-agent 都有自己的 package scripts。

## 单槽位生产

- **职责**：使用预构建 Web/API 镜像和 PostgreSQL 启动简单生产拓扑。
- **输入**：GHCR 镜像、`.env`、Caddyfile。
- **输出**：宿主机 `:80` 的 Web/API。
- **核心文件**：`docker-compose.prod.yml`、`Dockerfile`、`Dockerfile.api`。
- **数据流**：

```text
Host :80
-> Web Caddy :3000
-> /api proxy
-> API :8088
-> PostgreSQL / S3 / providers
```

- **依赖关系**：`Dockerfile.api` 不编译 Go，而是复制 CI 预生成的 `.docker-build/api-gateway`。
- **常见修改位置**：镜像、volume、Caddy proxy 和 env。

根 `docker-compose.yml` 更接近开发/示例入口，不应默认视为已完整验证的生产部署。

## 蓝绿部署

- **职责**：精确 Git SHA 的配对 Web/API 部署、健康校验、切流、排空和回滚。
- **输入**：镜像 SHA、`.env`、部署 state、Caddy。
- **输出**：blue 或 green 活动槽位。
- **核心文件**：`deploy/docker-compose.prod.yml`、`deploy/blue-green.sh`、`deploy/slot.Caddyfile`、`.github/workflows/cd.yml`。
- **数据流**：

```text
Public 80/443
-> long-lived edge Caddy
-> web-blue -> api-blue
or web-green -> api-green
-> shared PostgreSQL

Both API slots -> shared data/
```

- **依赖关系**：edge、两个 Compose profile、镜像仓库、健康 endpoints 和共享 JWT。
- **常见修改位置**：
  - 验证项目：blue-green script。
  - 槽位 topology：deploy Compose。
  - 切流：edge Caddy state。
- **关键行为**：
  - 先验证非活动槽位，再 reload edge。
  - 公网验证失败恢复旧配置。
  - 成功后排空并停止旧槽位。
  - JWT 轮换必须显式 `reset_sessions`。
  - `API_STOP_GRACE_PERIOD` 应大于 API `SHUTDOWN_TIMEOUT`。

## Canvas Agent

- **职责**：连接网页 Canvas、本机 Codex/Claude 和 MCP。
- **输入**：Canvas snapshot、prompt、图片附件、Codex thread、MCP tool call。
- **输出**：SSE 事件、Canvas tool request、thread 历史和 Agent 流式消息。
- **核心文件**：
  - `canvas-agent/src/index.ts`
  - `http-server.ts`
  - `canvas-session.ts`
  - `agents.ts`
  - `schemas.ts`
  - `mcp-server.ts`
  - `config.ts`
- **依赖关系**：Express、官方 MCP SDK、`@openai/codex`、本地浏览器 Canvas。
- **常见修改位置**：
  - 新工具：schemas -> CanvasSession -> Web Canvas op -> plugin skill。
  - 新 thread 行为：agents/http server。
  - token/origin：config/http server。

两种模式互斥：

- `canvas-agent`：启动只监听 `127.0.0.1` 的 HTTP/SSE Agent。
- `canvas-agent mcp`：启动 stdio MCP Server；它不会启动 HTTP Agent，只会读取本地 config 并 POST 到现有 Agent 的 `/api/tools`。

```text
Browser --HTTP/SSE--> HTTP Agent
HTTP Agent --stdio JSON-RPC--> Codex app-server
Codex/plugin --stdio MCP--> MCP server --HTTP /api/tools--> HTTP Agent
HTTP Agent --tool request--> Browser
```

HTTP Agent 主要 endpoints：

- 公共：`GET /health`、`GET /config`。
- token 保护：`GET /events`、`POST /canvas/state`、`POST /canvas/result`、`POST /api/tools`。
- Codex thread/workspace：`/agent/codex/*`。
- Claude：`POST /agent/claude/turn`，网页当前主要开放 Codex。

Canvas session ownership：

- 浏览器通过现有 `canvasId/projectId` 把 Replica identity 带入 `/events`、`/canvas/state`、`/canvas/result` 和 thread/turn 请求。
- `CanvasSession` 为每个 Canvas Project Replica 独立保存 clients、state 和 pending tool requests；Codex 结构化事件按 thread/turn 映射回对应 Replica，不再广播给全部客户端。
- Codex thread 的 MCP 配置通过 `CANVAS_REPLICA_ID` 把相同 identity 带到 `/api/tools`。
- 未显式携带 identity 的旧 MCP 调用只在恰好一个 Replica 已连接时兼容；多 Replica 时拒绝歧义调用。

安全和持久化：

- token、允许 Origins 和 canvas workspace 写入 `~/.infinite-canvas/canvas-agent.json`。
- `/config` 只返回 URL 和 `hasToken`，不返回 token。
- 每个 Canvas 默认 workspace 为 `~/.infinite-canvas/codex-workspaces/<canvasId>`。
- Agent npm 版本独立于根 `VERSION`。

## Codex 插件

- **职责**：向 Codex app 注册 Canvas skills 和 `infinite-canvas` MCP。
- **输入**：插件安装、自然语言请求。
- **输出**：画布操作策略和 MCP tools。
- **核心文件**：`plugins/infinite-canvas/.codex-plugin/plugin.json`、`.mcp.json`、`skills/canvas/SKILL.md`、`skills/open-canvas/SKILL.md`、根 marketplace。
- **数据流**：Codex loads skill -> starts `npx -y @basketikun/canvas-agent mcp` -> MCP calls existing HTTP Agent。
- **依赖关系**：已安装的 npm canvas-agent 和已运行的 HTTP Agent。
- **常见修改位置**：
  - 工具行为先改 Agent contract。
  - 使用策略改 skill。
  - 名称/图标改 manifest。

当前插件文档存在实现偏差：

- 仍使用 `CANVAS_URL`，但 Canvas Agent 代码不读取该变量。
- 声称 `/config` 可读取 token，实际只返回 `hasToken`。
- 声称 MCP 会自动拉起 HTTP Agent，当前 `mcp-server.ts` 不会。

## Docs 应用

- **职责**：构建用户/开发文档、搜索和 Agent 可读文本。
- **输入**：`docs/content/docs/**`、`docs/index.md`、根 `CHANGELOG.md`、静态资源。
- **输出**：Next standalone 服务、HTML、Orama 搜索、`llms.txt/llms-full.txt`。
- **核心文件**：`docs/source.config.ts`、`docs/src/lib/source.ts`、`docs/src/app/`、`docs/Dockerfile`。
- **数据流**：MDX -> Fumadocs source -> pages/search/LLM routes。
- **依赖关系**：独立 Next.js 16 应用，不是主 Vite Web 的 runtime。
- **常见修改位置**：
  - 内容：`docs/content/docs/`。
  - 导航：`meta.json`、top tabs。
  - 搜索：`search-tokenizer.ts`。
  - 部署：docs Docker/Compose。

主 Web 的旧 Next.js route 文档不能用于当前 Vite 代码。

## 已知限制与偏差

1. `.env.production.example` 建议 `.env.production`，运行时默认读取 `.env`。
2. `.env.example` 的 docs env 名仍是 Next.js 旧名。
3. Web Dockerfile 依赖运行时挂载 Caddyfile；脱离 Compose 直接启动镜像不会自动拥有 proxy config。
4. `Dockerfile.api` 依赖 CI 构建产物，本地直接 `docker build -f Dockerfile.api` 不会编译 Go。
5. Canvas Agent 多 Replica session 已按 identity 隔离，但真实浏览器多画布与 Codex app-server/MCP 端到端仍待验证；进程级 stderr 只归属当前活动 Turn。
6. Agent token 长期复用，Origin 是累积列表；配置目录/文件已显式使用 `0700/0600`。
7. `pinnedThreadIds` 已持久化但当前没有明确消费者。
8. WebDAV 的 Next.js proxy mode 仍在前端类型中，但主 Vite/Go 应用没有对应 route。
9. docs 部分旧内容仍引用 `web/src/app/api`、Next dev 或纯本地数据。
10. 发布 workflow 和镜像命名存在多套路径；部署前必须确认目标 namespace、架构和 tag。
