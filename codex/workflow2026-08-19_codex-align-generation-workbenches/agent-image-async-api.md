# image-async-api

## 状态

- 状态：completed
- 分支：`codex/align-generation-workbenches`
- 范围：仅生图工作台私有前端文件、同目录测试与本工作流归档/发现文件

## 改动

- `web/src/pages/image/image-async-task.ts`
  - 复用现有 `createAsyncImageTask`、`createAsyncImageEditTask`、`pollAsyncImageTask`。
  - 工作台提交时覆盖来源为 `image_workbench`，并从兼容 API 响应头捕获平台 `generation_tasks` ID。
  - 最多轮询 360 次；成功后物化结果，并按精确平台任务 ID 回写单个最终 `fileId`。
- `web/src/pages/image/index.tsx`
  - 每个生成 slot 改为异步提交、轮询、物化。
  - data URL 使用 `uploadBlob`，远端 URL 使用 `uploadUrlToS3`。
  - 删除批次结束时的重复上传，以及按模型/时间查询最近任务的 metadata 回写。
- `web/src/pages/image/image-async-task.test.mjs`
  - 红-绿覆盖响应头远端任务 ID 被用于最终 file metadata 回写，而不是本地临时日志 ID。

## 验证

```text
cd web
bun test src/pages/image/image-async-task.test.mjs src/services/api/image.test.mjs src/services/api/async-image-edit-form.test.mjs
```

结果：`15 pass / 0 fail`。

## 边界确认

- 未修改后端、Canvas、视频工作台或共享配置/API 文件。
- 未运行浏览器、构建或全量测试。
- 未创建分支/worktree，未提交。
- 未读取、修改或清理 `codex/workflow2026-08-19_codex-image-resolution-config/`。
- 本任务没有改变 todo/功能状态；受写入边界限制，未修改项目进度文档。

## 已读 Skills

- `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/tests.md`
- `/Users/eldenpdx/.agents/skills/tdd/mocking.md`

## 阻塞项

- 无。
