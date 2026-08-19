# video-async-api

## 状态

- 状态：completed
- 分支：`codex/align-generation-workbenches`
- 范围：仅视频创作台私有前端文件、同目录测试与本工作流归档/发现文件

## 调用链核对

- 视频创作台原远程链路：兼容 API 创建返回上游任务 ID，页面随后直接轮询 `/api/v1/contents/generations/tasks/:id`；后端 worker 同时观察上游，形成双重轮询。
- 兼容创建响应头 `X-Generation-Task-Id` 是本系统 `generation_tasks` ID；任务详情 API 可返回共享生命周期状态与 metadata。
- 后端成功物化后把远端生成记录的 `fileId` 写入任务 metadata `fileIds`；失败、超时、取消已由 compatibility lifecycle 统一进入终态仲裁。
- 画布 first-party 视频节点同样只观察本系统任务，成功后消费平台 `fileId`；视频创作台现在沿用相同的观察所有权与 Materialized Result 语义。

## 改动

- `web/src/pages/video/video-async-task.ts`
  - 创建远程兼容任务时捕获平台任务 ID，并设置来源为 `video_workbench`。
  - 仅轮询平台任务详情；成功读取任务 metadata 的 `fileIds[0]`，失败/取消读取任务终态错误，360 次观察后按超时失败。
- `web/src/pages/video/index.tsx`
  - 远程生成和恢复改用平台任务 ID；不再调用浏览器上游轮询，也不再用本地日志 ID 回填 metadata。
  - 成功直接解析后端已物化的 `fileId` 和可播放 URL，并持久化到工作台日志；本地模式保留原 provider 轮询与上传。
- `web/src/pages/video/video-async-task.test.mjs`
  - 红-绿覆盖平台任务完成后使用远端任务 `fileId`，且完成阶段没有上游轮询请求。

## 验证

```text
cd web
bun test src/pages/video/video-async-task.test.mjs src/services/api/video.test.mjs src/services/api/generations.test.mjs
```

结果：`27 pass / 0 fail`。

## 边界

- 未修改后端、Canvas、图片工作台、共享配置或共享 API 文件。
- 未运行浏览器、构建或全量测试；未创建分支/worktree，未提交。
- 未读取、修改或清理 `codex/workflow2026-08-19_codex-image-resolution-config/`。
- 本任务没有改变 todo/功能状态；受写入边界限制，未修改项目进度文档。

## 已读 Skills

- `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/SKILL.md`
- `/Users/eldenpdx/.agents/skills/tdd/tests.md`
- `/Users/eldenpdx/.agents/skills/tdd/mocking.md`

## 阻塞项

- 无。
