你是当前任务的独立只读查验 Subagent：verify-canvas-resolution-fallback。

任务契约：wave-3 / verify；只读审阅画布分辨率/宽高比改动，禁止修改项目源码/测试。

在 `/Users/eldenpdx/git-project/infinite-canvas` 的 `codex/image-resolution-config` 分支，核对 `web/src/components/image-settings-panel.tsx` 及测试：
- 公开配置 resolution `default|1k|2k|4k` 是否正确限制图片节点用户可见的宽高比/尺寸选项；
- 缺失/非法是否回退 default；模型/格式切换是否安全归一化无效选中值；
- 是否正确消费 config-admin 新 DTO，不存在竞态/空配置问题；
- 是否误伤自由尺寸、现有模型、请求 payload 或其他调用者；
- 映射是否复用现有尺寸常量并保持最小实现；测试是否覆盖公开行为而非内部细节。

先完整读取 `/Users/eldenpdx/.agents/skills/tdd/SKILL.md` 与 `tests.md`、`mocking.md`，以及 `/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`（full）；读取：
- `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-canvas-workbench-map-resume.md`
- `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-canvas-resolution.md`
- `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-config-admin-fallback.md`
遵守 AGENTS.md；可用 Serena 先读说明并激活项目。运行聚焦测试与 diff check，但不运行浏览器、构建或全仓测试。

第一项保存完整 prompt 到 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-verify-canvas-resolution-fallback.md`；发现写入 `/Users/eldenpdx/git-project/infinite-canvas/codex/workflow2026-08-19_codex-image-resolution-config/agent-verify-canvas-resolution-fallback.md`。只写这两个 workflow 文件；不得提交、切分支、stash/reset/clean、创建 worktree。

最终最多 8 行：状态；按严重性 findings（无则明确）；测试结果；覆盖 seam；发现文件；Skills；残余风险；阻塞项。
