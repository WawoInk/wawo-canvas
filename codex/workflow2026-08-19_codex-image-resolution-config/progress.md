# Progress

## 当前状态

`completed`

## 工作流字段

| 字段 | 最终值 |
| --- | --- |
| 仓库根目录 | `/Users/eldenpdx/git-project/infinite-canvas` |
| 基准引用 | `main` |
| 基准提交 | `a13233e4649ed39f220b11b0c865a2e4997f581f` |
| 任务分支 | `codex/image-resolution-config` |
| Workflow 目录 | `codex/workflow2026-08-19_codex-image-resolution-config/` |
| 最终角色 | `integration/closer` |
| 日期 | `2026-08-19` |

## 完成结果

- [x] 公开图片请求配置新增按模型的 `default | 1k | 2k | 4k` 分辨率字段。
- [x] 后端、管理端可视化/JSON 编辑和公开配置传播统一归一化缺失或非法分辨率为 `default`。
- [x] Canvas 与生图工作台共享图片设置按模型档位显示现有尺寸选项。
- [x] Canvas 在设置浮层未挂载时也会在 `buildNodeConfig` 边界归一化失效预设。
- [x] 节点模型优先于全局 `imageModel`；合法自由宽高不会被静默替换。
- [x] 生图工作台统一异步 create/query/terminal、S3/fileId 物化、任务身份持久化和刷新恢复。
- [x] 工作台重试、远程取消、批量删除和临时查询/上传错误恢复完成。
- [x] 代理 `{ code: 1, msg }` 查询错误改为可重试异常，明确 task `failed/cancelled` 仍保持终态。
- [x] `pending-test.mdx` 与 `CHANGELOG.md` 已按实际变更更新；`todo.mdx` 无对应待办，无需修改。
- [x] Workflow 全局文档和 integration closer 记录已收尾。
- [x] 当前任务分支由 closer 提交；不合并 `main`、不推送、不删除分支。

## TDD 收尾切片

1. 自由尺寸保留：先新增 `1504x1504` / `1200x800` 失败断言，再仅对已知隐藏预设做方向归一化。
2. 浮层关闭生成：先新增 `buildNodeConfig` 失败测试，再在 Canvas 图片配置边界复用现有归一化函数。
3. 节点模型优先：把测试改为全局 4K、节点 2K 且 4K 配置排在前面，确认红灯后按模型优先级查找。
4. 查询包装错误：先断言 `pollAsyncImageTask` 对 `{ code: 1 }` 必须 reject，再把明确 task 终态与查询错误分开。
5. TypeScript 测试夹具：只补现有 `PublicSettings` / `ImageRequestFormatSetting` 类型，未改变运行时行为。

## 最终验证

| 验证 | 结果 |
| --- | --- |
| 工作台 helper + 图片 API 聚焦测试 | `32 pass / 0 fail` |
| 图片设置、Canvas 配置、视频设置、管理纯函数、公开 store | `21 pass / 0 fail` |
| 管理设置页面测试 | `3 pass / 0 fail` |
| `bunx tsc --noEmit` | 通过 |
| `go test ./...` | 全部包通过 |
| zh-CN / en-US JSON 解析 | 通过 |
| `git diff --check` | 通过 |
| 分支与祖先关系 | 当前分支正确，`main` 是祖先 |

`cd web && bun test` 的单命令全量聚合不通过：仓库测试共享 Happy DOM/i18n 全局状态，并触发 Bun 对嵌套 `node:test` 的限制；输出为 `31 pass / 37 fail / 26 errors`。本任务涉及的测试文件按仓库现有方式分组或单独运行全部通过。

## 手动验收交接

- 管理后台保存四种分辨率后刷新，确认值保持。
- Canvas 切换 1K/2K/4K 模型，确认可见预设与实际生成请求一致；自由宽高保持。
- 工作台生成期间刷新，确认继续观察原任务且不重复创建。
- 验证失败重试、远程取消未确认、部分成功/失败批次和删除后不回流。

未运行真实浏览器或真实供应商请求。
