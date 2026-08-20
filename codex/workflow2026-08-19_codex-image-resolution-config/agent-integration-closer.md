# integration/closer 收尾记录

## 状态

- 结果：`completed`
- 分支：`codex/image-resolution-config`
- 基准：`main` / `a13233e4649ed39f220b11b0c865a2e4997f581f`
- 模式：`ponytail full` + TDD

## 开始检查

- 已先读取 `agent-workbench-state-fix.md`、当前工作区 diff、所有实现/查验记录和全局 workflow 文档。
- 工作台四项查验 finding 已在现有改动中实现并通过原有 `31` 项测试。
- 继续发现并闭合：
  1. 代理 HTTP 200 `{ code: 1, msg }` 查询错误仍被 service 映射为终态失败。
  2. Canvas 设置浮层未挂载时旧分辨率预设可绕过。
  3. 受限档位会误改合法自由尺寸。
  4. 节点模型与全局图片模型并存时，配置数组顺序会选错分辨率。
  5. 新增 store 测试夹具因空数组/字面量推断导致 TypeScript 检查失败。

## 最小修复

- `pollAsyncImageTask` 仅把明确 task `failed/cancelled` 作为终态；包装查询错误改为抛出。
- `normalizeImageSizeForResolution` 保留非预设的合法 `WIDTHxHEIGHT`。
- `buildNodeConfig` 在 Canvas 图片生成配置边界复用同一归一化逻辑。
- 分辨率查找按当前 `model`、再按 `imageModel`，不依赖配置数组顺序。
- store 测试夹具补现有 DTO 类型，无运行时变化。
- 更新 `pending-test.mdx`、`CHANGELOG.md` 和 workflow 全局文档。

## TDD 红绿

1. 自由尺寸测试：红为 `1504x1504 -> 2048x2048`；绿为原值保留。
2. 浮层关闭测试：红为 `3840x2160` 原样进入 Canvas config；绿为 `2048x1152`。
3. 节点模型优先测试：全局 4K 配置排在节点 2K 前时先红；按模型优先查找后绿。
4. 查询包装错误测试：先得到正常 resolved `failed` 状态而非 rejection；修改 service 后绿。

## 验证

- 工作台 helper + 图片 API：`32 pass / 0 fail`。
- 图片设置 + Canvas config + 视频设置 + 管理纯函数 + public store：`21 pass / 0 fail`。
- 管理设置页面：`3 pass / 0 fail`。
- `bunx tsc --noEmit`：通过。
- `go test ./...`：通过。
- locale JSON：通过。
- `git diff --check`：通过。

全量 `cd web && bun test` 结果为 `31 pass / 37 fail / 26 errors`，原因包括重复 Happy DOM 注册、共享 i18n 状态和 Bun 不支持嵌套 `node:test`；这些是仓库现有聚合 runner 限制。本任务相关测试文件独立/聚焦运行全部通过。

## 范围与风险

- 未运行真实浏览器、真实供应商请求或前端 production build。
- `server` 二进制与 settings 源码同一实现时段产生，随任务保留；closer 未重建。
- 未 stash、reset、clean、切换分支、创建 worktree、合并 `main` 或推送。
- 真实浏览器验收清单已写入 `acceptance.md` 和 `progress.md`。
