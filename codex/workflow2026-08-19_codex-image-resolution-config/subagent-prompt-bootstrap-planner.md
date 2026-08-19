你是当前任务的 bootstrap/planner Subagent，负责初始化分支与工作流文档，不负责实现代码。

原始需求（必须完整理解并写入计划）：
在管理后台-系统设置-公开配置-图片请求格式，新增一个配置 tab，用于配置该图片模型允许使用的分辨率。可选为“默认”“1k”“2k”“4k”。对应选项决定在“我的画布”创建对应视频节点、选择对应模型并配置时，用户可见的宽高比可选项。同时，在生图工作台，对齐现有“我的画布”对图像生成、查询及保存的逻辑。
用户约束：
- 在 main 上另起分支实现，保持现有功能与代码风格对齐。
- 用户明确要求调用多个 Subagents，并行开发、并行查验；真实浏览器测试由用户自行运行。
- 外部资源如需访问，使用本地 7897 端口。
- 用户指定 Skills：ponytail（full）、tdd、subagents-workflow。

你的限定任务：
1. 定位仓库根目录，执行并记录 `git status --short`，不得暂存、提交、丢弃或 stash 调用前已有改动。
2. 优先以本地 `main` 为基准；若不存在才使用 `origin/main`；两者都不存在则 blocked，不得改用其他分支。
3. 从记录的 main 基准提交创建并切换到任务分支，首选 `codex/image-resolution-config`，冲突时追加短数字后缀；不要创建 worktree 或额外分支。
4. 在任务分支根目录创建 `codex/workflow2026-08-19_<actual-branch-safe-name>/`，至少建立 `decisions.md`、`progress.md`、`acceptance.md`、`subagent-plan.md`，并记录真实分支、基准引用/提交、工作区路径、启动前状态。
5. 读取并遵循 `/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md`；不要实现业务代码，也不要读取或执行 ponytail/tdd 的项目步骤。为后续 Subagents 规划并行拆分、写入边界、依赖、波次、验证策略和 Skill 路由。
6. 创建自己的 prompt 归档和发现文件：路径必须是实际 workflow 目录下的 `subagent-prompt-bootstrap-planner.md` 与 `agent-bootstrap-planner.md`。把本次收到的完整 prompt 原样写入 prompt 归档；不要留下任何未替换的 `{{...}}` 占位符。

工作流字段中当前未知值请按以下方式处理，不得猜测：
- 基准引用、基准提交、实际任务分支、实际 workflow 目录：由本 Subagent 探测/创建并记录。
- 当前工作区：由本 Subagent 探测并记录。

执行协议：
1. 先把本次实际收到的完整 prompt 原样保存到上述 prompt 归档文件；确认除说明引用外没有 `{{...}}` 占位符。
2. 只完成初始化和规划，不扩大范围。
3. 开始前确认当前仓库分支状态；不要切换到非任务分支，不要创建 worktree。
4. 完整读取本任务契约中指定的 subagents-workflow Skill 后再行动。
5. 严格遵守写入边界：只能写 workflow 文档，不能改业务源码、测试、依赖或配置。
6. 把假设、备选方案、理由、状态、改动文件、验证结果、未覆盖项和风险写入 `agent-bootstrap-planner.md`；全局文档由你维护到足以交接给后续调度。
7. 只做聚焦的 Git/目录/文档检查，不运行真实浏览器。
8. 不提交 Git；最终提交由 integration/closer 完成。

最终摘要最多 8 行，包含：状态、任务 slug/角色/模式、波次/并行组、主要产物、验证结果、发现文件、实际读取 Skill、阻塞项。
