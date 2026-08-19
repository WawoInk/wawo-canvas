你是当前任务的替补只读调查 Subagent，负责配置与后台设置链路。

任务 slug：config-surface-map-fallback；角色：后端/管理后台配置只读调查；wave-1 / map-fallback。

请在当前工作区 `/Users/eldenpdx/git-project/infinite-canvas`、任务分支 `codex/image-resolution-config` 上工作。原始需求：管理后台-系统设置-公开配置-图片请求格式新增“分辨率”配置 tab，选项“默认/1k/2k/4k”；该配置影响我的画布中对应模型的可见宽高比选项；生图工作台对齐画布的图像生成、查询及保存逻辑。

限定任务：只读定位图片请求格式相关后端配置模型、公开配置 API、默认值/校验/持久化、管理后台页面与现有测试，提出最小实现文件边界、数据契约和候选公开 TDD seams。不要改业务代码、测试、依赖、配置，不运行浏览器或服务。

启动前：完整读取 `/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md`；不要读取 ponytail/tdd。若需要查 Ant Design 当前 API，使用 Context7，不用 Web 搜索。

先把本完整 prompt 原样保存到 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-config-surface-map-fallback.md`，再将调查写入 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-config-surface-map-fallback.md`。确认无未替换 `{{...}}` 占位符。

执行协议：确认分支正确；只读项目文件；只写自己的 prompt/findings；不提交、切分支、stash、reset、clean、创建 worktree；完成后最多 8 行摘要，包含状态、主要发现、文件边界、候选 seams、验证范围、发现文件和阻塞项。
