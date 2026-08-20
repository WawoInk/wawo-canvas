# workbench-state-fix 修复记录

## 状态

- 结果：`completed`
- 任务 slug：`workbench-state-fix`
- 并行波次：`wave-3-fix`
- 写入范围：生图工作台页面、页面私有异步任务 helper、同目录聚焦测试，以及本记录和 prompt 归档。
- 未修改：后端、settings、管理后台、Canvas、共享 `ImageSettingsPanel`、其他 services、依赖和锁文件；未提交、切分支、stash、reset、clean 或创建 worktree。

## 修复内容

### P1：查询/上传暂时性错误

- `completeImageWorkbenchTask` 新增 `ImageWorkbenchTaskRetryableError`。
- 查询错误按连续错误计数重试；达到 20 次后暂停本地观察并抛出可恢复错误，不调用取消、不写 `failed`。
- 结果物化/上传错误也标记为可恢复错误；页面把 slot 保持为 `pending`，保存原 upstream/platform task identity，刷新后可重新查询或物化。
- 明确的 provider `status: "failed"` 仍保持终态失败。

### P1：重试刷新恢复

- 页面保存当前批次 `activeLogIdRef`，重试使用原 log ID。
- 重试先清除旧 slot 的 task identity 并持久化 pending，再创建新任务；创建完成后通过 `upsertImageWorkbenchTaskRecord` 写入新的 upstream ID、platform ID 和 model。
- 重试现在进入 running/cancel 状态；刷新时 `resumableImageWorkbenchTasks` 可重建同一新任务，不会重新 create。

### P1：远程取消

- 页面私有 `cancelImageWorkbenchTask` 在 remote 模式调用 `/api/v1/tasks/{upstreamTaskId}/cancel`，请求体发送 `{ model }`，并要求响应状态为 `cancelled`。
- 本地模式继续复用现有 `cancelAsyncImageTask`。
- 取消 callback 接收完整 task identity；取消未被远程确认时 slot 保持 `pending`，确认后写入本地 `cancelled` 终态。

### P2：删除 ID

- `imageWorkbenchDeletionIds` 展开每个 slot 的唯一 `platformTaskId`；没有 task identity 的旧记录回退使用 log ID。
- 页面删除本地批次缓存的同时，按上述服务端记录 ID 调用删除 API。

## TDD 红绿过程

初始聚焦测试：`bun test src/pages/image/image-async-task.test.mjs`，基线 `14 pass / 0 fail`。

1. 先加入四项 finding 回归测试，测试加载阶段因新 seam 未实现而红：`0 pass / 1 error`。
2. 实现可恢复错误、upsert、取消 identity 和删除 ID 后，短暂错误/取消/删除测试转绿；修正一次 `error: undefined` 对象形状后为 `18 pass / 0 fail`。
3. 加入远程取消未确认保持 pending 的回归后为 `19 pass / 0 fail`。
4. 加入真实 remote cancel HTTP 请求体/路径测试后为 `20 pass / 0 fail`。
5. 补充单次查询抖动后继续轮询成功的测试后为 `21 pass / 0 fail`。
6. 最终聚焦验证：

   ```text
   cd web
   bun test src/pages/image/image-async-task.test.mjs src/services/api/image.test.mjs
   ```

   结果：`31 pass / 0 fail`（工作台 helper 21 项，图片 API 10 项）。

## 其他验证

- `git diff --check -- web/src/pages/image/index.tsx web/src/pages/image/image-async-task.ts web/src/pages/image/image-async-task.test.mjs`：通过，无输出。
- prompt 归档文件已写入 `subagent-prompt-workbench-state-fix.md`。
- 占位符检查：没有替换样式的 `{{name}}` 等占位符；prompt 中要求检查的字面量 `{{...}}` 按原文保留。
- 未运行浏览器、构建、类型构建、全仓测试或全仓格式化。

## 实际读取 Skills / 工具

- `ponytail`（full）
- `tdd`、`tests.md`、`mocking.md`
- `diagnosing-bugs`
- `context7-mcp`
- `vercel-react-best-practices`
- Serena `initial_instructions`，并激活项目
- 未调用 Context7 文档查询：本次没有新增或询问库/框架 API；只核对仓库现有契约。

## 未覆盖风险

- 未做浏览器级交互验证；页面级 React 测试仍未建立，当前覆盖集中在页面私有 helper 和现有图片 API seam。
- `pollAsyncImageTask` 服务层把部分上游 envelope 错误映射成 `status: "failed"`；本次写入边界禁止修改该 service，因此明确 provider failure 与抛出的 observer/network error 已区分，但该服务层映射仍需后续契约调整才能完全区分。
- 远程取消依赖上游返回明确 `cancelled`；未确认时保留 pending，用户刷新后继续恢复，这是刻意保留的安全语义。

## 阻塞项

- 无。
