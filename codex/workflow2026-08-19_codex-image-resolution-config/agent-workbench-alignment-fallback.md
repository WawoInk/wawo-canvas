# workbench-alignment-fallback 完成记录

## 状态

- 结果：`completed`
- 当前分支：`codex/image-resolution-config`
- 写入范围：仅生图工作台 image 页面、页面私有 helper/test，以及本 Subagent 的 prompt/发现文件
- 后端 settings、管理后台、Canvas、共享 `ImageSettingsPanel`、依赖和锁文件：未修改
- 现有 `web/src/services/api/image.ts`：只读取并调用当前分支已有公开异步函数，本 Subagent 未修改

## 实现结果

1. `web/src/pages/image/index.tsx` 不再调用旧同步 `requestGeneration` / `requestEdit`。
2. 每个生成 slot 通过页面私有 helper 创建异步 generation/edit task，并以 5 秒间隔查询到成功、失败或超时。
3. create 响应若已直接包含图片，不再额外查询；直接进入结果物化。
4. data URL 使用 `uploadBlob(..., "results/images")`，远端 URL 使用 `uploadUrlToS3(..., "results/images")`。
5. 结果保存 `fileId`，并用准确的 platform task ID 回写 generation task metadata，不再按最近历史启发式匹配。
6. 本地日志按 slot 保存 `source`、upstream task ID、task model、platform task ID、状态和 fileId；task ID 与终态在继续轮询/结束 slot 前等待 localforage 写入。
7. 刷新后从本地日志恢复同一 pending task，不重新创建；只恢复 `image_workbench` 来源，避免接管其他来源。
8. 批量记录刷新后同时恢复成功图片、失败 slot 和错误信息，不丢失部分失败状态。
9. 显式取消会 best-effort 取消上游；组件卸载只停止观察，并先保存 task ID 供下次刷新继续。
10. 上传引用、素材引用和生成结果转引用均保留 `ReferenceImage.fileId`；已有 fileId 的素材保存直接复用平台文件。
11. sync delta 回调通过 latest ref 调用当前 `refreshLogs`，避免使用首屏旧配置恢复任务。
12. 工作台布局和主要 UI 结构未调整；运行按钮沿用原位置并保持取消可点击。

## 复用的现有能力

- `createAsyncImageTask`
- `createAsyncImageEditTask`
- `pollAsyncImageTask`
- `cancelAsyncImageTask`
- `patchGenerationTaskMetadata`
- `uploadBlob`
- `uploadUrlToS3`
- `resolveFileUrls`
- `useAssetStore.addAsset`

## TDD 红绿切片

1. **create 即时完成**
   - Red：create 已返回图片时 helper 仍调用 poll。
   - Green：优先物化 `upstreamTask.images[0]`，并准确回写 fileId。
2. **恢复来源隔离**
   - Red：`canvas` 来源的 pending 记录也会被工作台恢复。
   - Green：仅恢复 `IMAGE_WORKBENCH_SOURCE`。
3. **即时结果取消**
   - Red：AbortSignal 已取消时仍物化 create 的即时图片。
   - Green：物化前先执行取消检查和 best-effort cancel。
4. **批量成功/失败恢复**
   - Red：刷新预览只恢复成功图片，失败 slot 消失。
   - Green：按 slotIndex 合并 task 状态和物化图片。
5. **等待阶段取消**
   - Red：pending 后等待下一次 poll 时取消不会调用上游 cancel。
   - Green：使用 Canvas 同形的 AbortSignal-aware delay，并在等待异常时执行 cancel。

## 修改文件

- `web/src/pages/image/index.tsx`
- `web/src/pages/image/image-async-task.ts`
- `web/src/pages/image/image-async-task.test.mjs`
- `codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-workbench-alignment-fallback.md`
- `codex/workflow2026-08-19_codex-image-resolution-config/agent-workbench-alignment-fallback.md`

## 聚焦验证

执行：

```text
bun test src/pages/image/image-async-task.test.mjs src/services/api/image.test.mjs
```

结果：

- `24 pass`
- `0 fail`
- 覆盖 create generation/edit source、upstream/platform task 身份、即时完成、pending -> succeeded、provider failed、metadata patch 容错、超时、轮询/等待取消、task 恢复、批量状态恢复和引用 fileId。

附加检查：

- `git diff --check`（限定本任务目标文件）：无输出。
- image 页面目录扫描 `requestGeneration|requestEdit`：无输出。
- 当前分支：`codex/image-resolution-config`。
- prompt 未替换占位符扫描：无输出。
- 未运行浏览器、构建、全仓测试或全仓格式化。

## 手动浏览器验收清单

1. 无引用生成 1 张图，确认先显示 pending，完成后显示 S3 图片且保存素材复用同一 fileId。
2. 从“我的素材”加入带 fileId 的图片引用，确认走异步 edit 并成功完成。
3. 批量生成时刷新页面，确认已保存 task ID 的 pending slot 继续查询且不会重复创建。
4. 构造一张成功、一张失败，刷新并打开历史记录，确认成功图与失败卡都保留。
5. pending 等待期间点击取消，确认按钮可点击、结果显示已取消且不继续轮询。
6. 生成过程中离开页面再返回，确认只恢复观察原 task，不创建新任务。

## 实际 Skills / 工具

- `ponytail`（full）
- `tdd`（含 `tests.md`、`mocking.md`）
- `context7-mcp`
- `vercel-react-best-practices`
- Serena：已读取 `initial_instructions` 并激活项目
- Context7：已按顺序 resolve/query React effect cleanup 与 Ant Design Button loading/click 行为

## 未覆盖与风险

- 当前后端 `ImageHistoryItem` 不返回 upstream task ID，因此本实现支持同浏览器 localforage 刷新恢复；跨设备 pending task 恢复仍需要后端 DTO 扩展，超出本 Subagent 写入边界。
- 未执行真实供应商请求、浏览器交互或构建；按任务约束留给用户和 integration/closer。
- 共享工作区存在其他 Subagent 的并行改动；本 Subagent 未回滚、覆盖或整理这些文件。

## 阻塞项

- 分配范围内无阻塞。
