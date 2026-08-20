# Acceptance

## 功能验收

- [x] 管理后台图片请求配置支持 `default`、`1k`、`2k`、`4k`。
- [x] 配置沿用 `public.modelChannel.imageRequestFormats`，没有新增表、接口或重复映射。
- [x] 后端与管理端对缺失/非法分辨率统一回退 `default`。
- [x] 远程模式按当前图片模型过滤共享图片尺寸选项；本地自定义渠道保持原行为。
- [x] `default` 保留全部已有选项，1K/2K/4K 复用既有预设和顺序。
- [x] 模型切换后的隐藏预设会按方向归一化，设置浮层关闭时生成也不能绕过。
- [x] 节点自身模型优先于全局图片模型，合法自由尺寸保持不变。
- [x] 生图工作台文生图/图生图统一异步 create、query、terminal 和结果物化。
- [x] source、upstream task ID、platform task ID、模型、slot 状态和 `fileId` 可持久化并刷新恢复。
- [x] 临时查询、代理包装错误和结果上传错误保留 pending；明确 provider `failed/cancelled` 才进入失败终态。
- [x] 重试写回新任务身份，刷新后不会重新 create。
- [x] 远程取消发送真实 upstream task ID 与模型；未确认取消时保留恢复身份。
- [x] 删除批次展开全部唯一 platform task ID，旧日志才回退本地 log ID。
- [x] `pending-test.mdx` 和 `CHANGELOG.md` 已更新；`todo.mdx` 已检查且无需修改。

## 自动验证

```text
cd web
bun test src/pages/image/image-async-task.test.mjs src/services/api/image.test.mjs
```

结果：`32 pass / 0 fail`。

```text
cd web
bun test \
  src/components/image-settings-panel.test.tsx \
  src/pages/canvas/components/canvas-node-config.test.ts \
  src/components/video-settings-panel.test.tsx \
  src/pages/admin/settings/image-request-formats.test.mjs \
  src/stores/use-config-store.test.ts
```

结果：`21 pass / 0 fail`。

```text
cd web
bun test test/admin-settings.test.tsx
```

结果：`3 pass / 0 fail`；仅有既有 Ant Design deprecated warning。

其他结果：

- `bunx tsc --noEmit`：通过。
- `go test ./...`：通过。
- locale JSON 解析：通过。
- `git diff --check`：通过。
- 当前分支：`codex/image-resolution-config`。
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`，`main` 是当前提交祖先。

## 全量前端测试说明

`cd web && bun test` 不是当前仓库可用的聚合入口。它会让多个 `GlobalRegistrator.register()`、i18n 语言状态和 `node:test` 文件共享同一 Bun 进程，并出现嵌套 `test()` 不支持、重复 Happy DOM 注册及无关语言断言失败。实际结果为 `31 pass / 37 fail / 26 errors`；本任务相关文件按现有独立/聚焦方式运行全部通过。

## Git 与范围

- [x] 未 stash、reset、clean、删除分支或创建 worktree。
- [x] 未覆盖调用前用户改动；任务开始前记录的工作区为 clean。
- [x] `server` 二进制与 settings 源码在同一实现时段生成，作为本任务配置实现产物保留。
- [x] Workflow prompt 中的 `{{...}}` 命中均为字面说明，没有未替换模板字段。
- [x] 最终提交只在任务分支完成，不合并 `main`、不推送。

## 人工浏览器验收

- [ ] 管理后台四档配置保存/刷新。
- [ ] Canvas 不打开设置浮层直接切模型生成。
- [ ] 自由宽高输入在受限档位下保持。
- [ ] 工作台刷新恢复、失败重试、远程取消、删除不回流。

人工浏览器验收按 workflow 契约交给用户，不阻塞本次代码与提交收尾。
