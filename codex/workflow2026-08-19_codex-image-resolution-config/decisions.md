# Decisions

## D-001 基准与提交边界

- 基准引用：本地 `main`。
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`。
- 任务分支：`codex/image-resolution-config`。
- 最终只提交任务分支，不合并 `main`、不推送、不创建 worktree。

## D-002 配置契约

- 复用 `public.modelChannel.imageRequestFormats`，单项增加 `resolution`。
- wire 值固定为 `default | 1k | 2k | 4k`。
- 缺失、空白或非法值回退 `default`，不丢弃整条模型配置。
- 整块 settings JSON 自然持久化，不新增数据库表、repository、handler 或路由。

## D-003 分辨率消费语义

- `default` 不增加过滤，保留全部现有选项。
- `1k` 使用七个基础比例；`2k` 使用三个现有 2K 预设；`4k` 使用两个现有 4K 预设。
- 只在远程模式消费公开配置，本地自定义渠道不受影响。
- 节点当前 `model` 优先于全局 `imageModel`，配置数组顺序不决定行为。
- 已知但被隐藏的预设按横/竖/方方向归一化；合法自由 `WIDTHxHEIGHT` 不被静默替换。
- Canvas 在 `buildNodeConfig` 真实生成边界再次归一化，避免依赖设置浮层是否挂载。

## D-004 工作台任务身份

- 每个 slot 分开保存 upstream task ID 与 platform task ID。
- 本地 batch ID 只用于工作台日志，不冒充平台任务 ID。
- 刷新恢复只接管 `source === "image_workbench"` 且仍为 pending 的记录。
- 重试覆盖原 slot 的任务身份；删除展开所有唯一 platform task ID。

## D-005 错误与取消

- 明确 provider `status: failed/cancelled` 是终态。
- 网络异常、代理 HTTP 200 `{ code: 1, msg }` 包装错误和结果物化错误是观察/保存错误，保留 pending。
- 连续查询错误达到上限时暂停本轮观察，不取消任务、不写终态失败。
- 显式取消只有在远程返回 `cancelled` 后写本地取消终态；未确认时保留恢复身份。
- 组件卸载只停止观察，不向上游发送取消。

## D-006 测试策略

- 采用已有公开 seam：后端 settings 归一化、管理保存/传播、共享图片设置、`buildNodeConfig`、图片 API 和工作台 helper。
- 每项修复先形成失败测试，再写最小实现。
- 不新增测试框架、依赖、复杂 mock 或页面私有状态抽象。
- 仓库全量 `bun test` 存在既有全局隔离问题，因此最终证据使用可重复的独立/聚焦测试、TypeScript 和 Go 全仓测试。

## D-007 二进制与文档

- `server` 与 settings 源码在同一实现时段更新，保留为任务产物；closer 没有重新构建。
- 实际用户可测试行为写入 `pending-test.mdx`。
- `CHANGELOG.md` 的 Unreleased 只增加版本级摘要。
- `todo.mdx` 无匹配待办，不修改。

## 最终状态

实现、聚焦回归、workflow 文档和任务分支提交均完成。剩余工作只有用户侧真实浏览器/供应商验收。
