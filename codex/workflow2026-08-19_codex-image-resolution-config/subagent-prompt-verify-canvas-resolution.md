你是当前任务的独立只读查验 Subagent。

任务 slug：verify-canvas-resolution；角色：画布分辨率/宽高比契约查验；wave-3-early / verify；执行模式：只读验证。

在 `/Users/eldenpdx/git-project/infinite-canvas` 的 `codex/image-resolution-config` 分支，独立审阅当前未提交的画布相关改动，仅聚焦：`web/src/components/image-settings-panel.tsx` 与对应测试。核对需求与调查：公开配置 `resolution = default|1k|2k|4k` 是否正确约束图片节点可见宽高比/尺寸选项；缺失/非法是否回退；模型/格式切换后是否避免无效选中值；是否复用现有常量、无不必要抽象；是否误伤自由尺寸/其他模型。运行允许的聚焦测试，但不修改任何项目源码/测试，不跑浏览器、构建或全仓测试。

开始前完整读取 `/Users/eldenpdx/.agents/skills/tdd/SKILL.md` 及其 `tests.md`、`mocking.md`，并读取 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`（full）用于最小性审查；读调查文件 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-canvas-workbench-map-resume.md` 与实现发现 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-canvas-resolution.md`。遵守 AGENTS.md；可用 Serena 时先读说明并激活项目。

第一项将完整 prompt 原样保存到 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-verify-canvas-resolution.md`，发现写入 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-verify-canvas-resolution.md`。只写这两个 workflow 文件；不得提交、切分支、stash/reset/clean、创建 worktree。

最终最多 8 行：状态、按严重性列出 findings（无则明确无）、测试结果、覆盖 seam、发现文件、Skills、残余风险/阻塞。
