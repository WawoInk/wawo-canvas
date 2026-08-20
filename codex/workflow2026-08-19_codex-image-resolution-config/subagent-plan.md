# Subagent Plan

## 最终执行结果

- 状态：`completed`。
- wave-0 bootstrap/planner：完成。
- wave-1 配置面与 Canvas/工作台只读调查：在分支竞争恢复后由 resume/fallback 角色完成。
- wave-2 config-admin、canvas-resolution、workbench-alignment：完成。
- wave-3 Canvas/工作台独立查验：完成并产生 P1/P2 findings。
- wave-3-fix workbench-state-fix：完成。
- wave-4 integration/closer：完成剩余 Canvas P1、查询包装错误、最终回归、文档和提交。
- 实际任务产物集中在当前工作区与 `codex/image-resolution-config`，没有创建额外 worktree。
- 真实浏览器测试按原计划交给用户。

以下内容保留为原始调度审计记录。

## 原始计划概览（已执行）

本任务不是单文件修补，涉及后台公开配置、配置契约/持久化、画布视频节点和生图工作台四个相互关联的行为面，并且用户明确要求并行开发与并行查验。采用“先并行只读调查，再并行实现，再并行查验，最后单点整合”的依赖感知调度。

- 当前已启用：1 个 `bootstrap/planner`（本 Subagent，`wave-0`）。
- 计划后续启用：8 个 Subagents。
- 计划总数：9 个（含本 Subagent）。
- 当前并行开发组：`impl-config`、`impl-canvas`、`impl-workbench`。
- 当前并行查验组：`verify-contract`、`verify-regression`。
- 真实浏览器测试：由用户执行，不启动浏览器 Subagent。
- 所有后续 Subagents 使用同一当前工作区和同一任务分支，不创建 worktree 或额外分支。

## 全局约束

- 任务分支：`codex/image-resolution-config`。
- 基准引用：`main`。
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`。
- 工作区：`/Users/eldenpdx/git-project/infinite-canvas`。
- Workflow 目录：`codex/workflow2026-08-19_codex-image-resolution-config/`。
- 外部资源访问（只有确有必要时）：使用本地端口 `7897`，并记录访问原因和结果。
- 业务文件必须遵循项目既有 Go/Gin/GORM 与 React/TypeScript/Ant Design/Tailwind/Zustand 结构。
- 共享工作区可能同时存在其他任务；每个波次边界必须复核当前分支为
  `codex/image-resolution-config`，并按路径忽略外部未跟踪 workflow 目录，不得清理或纳入本任务。
- 除 `integration/closer` 外，所有 Subagents 提交权限均为“无”；不得提交、合并、推送、stash、reset、删除分支或操作 worktree。
- 每个 Subagent 启动第一项工作：把实际收到的完整 prompt 保存到自己的归档文件，并检查未替换占位符。
- 每个 Subagent 可写自己的 `subagent-prompt-<task-slug>.md` 和 `agent-<task-slug>.md`；除此之外严格遵守下表的项目文件边界。

## Skill 路由

| Skill | 负责角色 | 读取时机 | 适用范围 |
| --- | --- | --- | --- |
| `subagents-workflow` (`/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md`) | `bootstrap/planner`（本角色） | 已完整读取，初始化前 | 分支、workflow 文档、波次和写入边界 |
| `ponytail`（full） (`/Users/eldenpdx/.codex/skills/ponytail/SKILL.md`) | `config-admin`、`canvas-resolution`、`workbench-alignment`、`integration/closer` | 各角色开始项目前 | 控制抽象、依赖和变更规模 |
| `tdd` (`/Users/eldenpdx/.agents/skills/tdd/SKILL.md`) | `config-admin`、`canvas-resolution`、`workbench-alignment`、`verify-contract`、`verify-regression`、`integration/closer` | 各角色开始测试设计/实现前 | 聚焦测试、红绿验证、回归风险 |

本角色按契约没有读取 ponytail/tdd；它们只路由给真正负责实现或验证的后续角色。

## 波次与并行组

### wave-0：初始化与规划（已完成）

**角色：** `bootstrap/planner`
**模式：** 只读探测 + workflow 文档写入
**并行组：** `bootstrap`
**输出：** 任务分支、六份 workflow 文档、基准/状态记录、后续调度契约。
**写入边界：** 仅 `codex/workflow2026-08-19_codex-image-resolution-config/`。
**验证：** Git 基准/分支/目录/文档检查；不运行业务测试和浏览器。

### wave-1：只读调查（并行）

启动条件：wave-0 文档存在，当前分支仍为任务分支。

#### `config-surface-map`

- **角色/模式：** backend + admin 配置契约调查，`read-only investigation`。
- **限定任务：** 定位公开配置“图片请求格式”的真实后端模型、枚举、repository/service/handler/API、前端管理设置入口、权限/默认值和已有测试。
- **预期输出：** 真实文件清单、数据流、可复用字段/API、潜在共享文件冲突和建议的 `config-admin` 写入边界。
- **范围外：** 不改源码、不改测试、不设计新接口、不提交。
- **完成定义：** 所有相关入口由代码/测试引用支撑，未确认的内容明确标为未知；发现写入专属 `agent-config-surface-map.md`。
- **依赖：** 可立即开始。
- **并行波次/组：** `wave-1` / `map`。
- **验证范围：** 配置读写、默认值、鉴权、持久化、响应结构。
- **共享资源约束：** 只读；不启动服务、不写生成物；仅写自己的 prompt/发现文件。
- **指定 Skills：** 无额外 Skill；不得读取 ponytail/tdd。
- **项目文件写入边界：** 无。
- **提交权限：** 无。
- **Prompt 归档：** `codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-config-surface-map.md`。

#### `canvas-workbench-map`

- **角色/模式：** frontend 画布与生图工作台调查，`read-only investigation`。
- **限定任务：** 定位视频节点创建/选模/分辨率/宽高比 UI、画布现有图像生成/查询/保存逻辑、生图工作台对应实现和测试入口。
- **预期输出：** 真实组件/状态/API 文件清单、复用关系、行为差异、最小改动建议、`canvas-resolution` 与 `workbench-alignment` 的互不重叠写入边界。
- **范围外：** 不改源码、不改测试、不运行浏览器、不启动服务、不提交。
- **完成定义：** 给出从模型选择到用户可见比例选项的调用链，以及工作台三类动作的现有逻辑对照；未知项明确列出。
- **依赖：** 可立即开始。
- **并行波次/组：** `wave-1` / `map`。
- **验证范围：** 前端状态、组件入口、API service 调用、保存/轮询/错误状态。
- **共享资源约束：** 只读；不写除自己的 prompt/发现文件外的项目文件，不占用服务端口。
- **指定 Skills：** 无额外 Skill；不得读取 ponytail/tdd。
- **项目文件写入边界：** 无。
- **提交权限：** 无。
- **Prompt 归档：** `codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-canvas-workbench-map.md`。

wave-1 扇入门槛：两个调查均完成或明确阻塞；配置契约、前端调用链和文件所有权已写入发现文件；没有未归属的业务文件改动。若调查发现实现边界重叠，先更新本计划再进入 wave-2。

### wave-2：实现（并行）

启动条件：wave-1 扇入完成；真实文件边界已确认；各实现角色分别读取 `ponytail（full）` 与 `tdd`；无共享生成物、锁文件或服务端口竞争。

#### `config-admin`

- **角色/模式：** 配置契约与后台设置实现，`write implementation`。
- **限定任务：** 按调查确认的现有模式，增加图片模型允许分辨率配置 tab及其后端读写/默认值/校验/持久化所需最小变更。
- **预期输出：** 后端和管理设置界面代码、必要的聚焦测试、验证摘要。
- **范围外：** 不修改画布或生图工作台；不改公共 API 响应风格；不引入新状态管理/依赖；不改无关配置。
- **完成定义：** 四个选项可按现有配置流保存、读取、校验并在管理 UI正确呈现；测试覆盖有效值、默认值和非法值路径。
- **依赖：** `config-surface-map` 完成。
- **并行波次/组：** `wave-2` / `impl-config`。
- **启动条件：** 调查已确认真实字段/接口和项目文件所有权。
- **验证范围：** 后端契约、权限、持久化、管理 UI 读写和错误反馈。
- **共享资源约束：** 只写调查分配的 backend 配置与 admin 设置文件；若需共享 API 类型，先在发现文件标记，不越界改画布/工作台文件；不占用共享服务端口。
- **指定 Skills：** `ponytail（full）`、`tdd`。
- **项目文件写入边界：** 仅由 `config-surface-map` 明确列出的后端配置/管理设置文件及其对应聚焦测试。
- **提交权限：** 无。
- **Prompt 归档：** `codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-config-admin.md`。

#### `canvas-resolution`

- **角色/模式：** 我的画布视频节点分辨率/宽高比实现，`write implementation`。
- **限定任务：** 使对应视频节点在选模型并配置时，根据允许分辨率决定用户可见宽高比选项；沿用现有画布主题、状态和比例逻辑。
- **预期输出：** 画布相关代码、必要的聚焦测试、验证摘要。
- **范围外：** 不修改后台配置存储和管理设置页面；不重写视频生成流程；不支持需求外分辨率或比例。
- **完成定义：** 配置变化能正确影响目标节点可见选项；默认/1k/2k/4k边界和无配置行为与既有约定一致；不破坏已有模型。
- **依赖：** `canvas-workbench-map` 与 `config-surface-map` 完成，且配置契约已确认。
- **并行波次/组：** `wave-2` / `impl-canvas`。
- **启动条件：** 已确认目标节点的真实文件边界和输入来源；与其他实现角色无重叠。
- **验证范围：** 节点创建、选模、配置、比例过滤/展示、默认和异常状态。
- **共享资源约束：** 只写画布目录内被分配的文件及对应测试；不得改共享 API/service 文件或工作台文件；不运行需要共享端口的服务。
- **指定 Skills：** `ponytail（full）`、`tdd`。
- **项目文件写入边界：** 仅由 `canvas-workbench-map` 明确列出的画布视频节点/相关选择器文件及其测试。
- **提交权限：** 无。
- **Prompt 归档：** `codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-canvas-resolution.md`。

#### `workbench-alignment`

- **角色/模式：** 生图工作台逻辑对齐，`write implementation`。
- **限定任务：** 对齐“我的画布”已有图像生成、查询和保存逻辑，复用现有 service/hook/store 契约并保持工作台交互。
- **预期输出：** 生图工作台代码、必要的聚焦测试、验证摘要。
- **范围外：** 不修改后台设置和画布视频节点；不引入新的轮询/持久化体系；不改无关生成类型。
- **完成定义：** 生成请求、查询/轮询、成功/失败状态和保存结果与画布现有逻辑一致；工作台原有入口不回归。
- **依赖：** `canvas-workbench-map` 完成，并确认可复用的画布逻辑和文件所有权。
- **并行波次/组：** `wave-2` / `impl-workbench`。
- **启动条件：** 已确认不需要修改 `config-admin` 或 `canvas-resolution` 的同一文件；如需要共享抽象，先由 closer 重新分配。
- **验证范围：** 请求参数、查询状态、错误处理、结果保存/本地持久化和 UI 状态。
- **共享资源约束：** 只写工作台目录和其专属测试；不得改画布目录、后台配置文件、依赖锁文件或共享生成物；不占用共享端口。
- **指定 Skills：** `ponytail（full）`、`tdd`。
- **项目文件写入边界：** 仅由 `canvas-workbench-map` 明确列出的生图工作台文件及其测试。
- **提交权限：** 无。
- **Prompt 归档：** `codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-workbench-alignment.md`。

wave-2 扇入门槛：三个实现角色均完成或明确阻塞；每个专属发现文件记录改动文件和验证；`git status --short` 中无未归属业务改动；未出现共享文件冲突。若失败，只为受影响边界安排聚焦修复，不阻塞无关验证。

### wave-3：并行查验

启动条件：wave-2 目标实现完成，且各实现角色已提供变更文件清单。

#### `verify-contract`

- **角色/模式：** 后端/前端配置契约查验，`read-only verification`。
- **限定任务：** 查验分辨率四值、默认值、响应结构、管理配置读写和画布消费契约的一致性；运行允许的聚焦测试/静态检查。
- **预期输出：** 失败位置、严重性、复现命令和通过项，写入专属发现文件。
- **范围外：** 不直接修复、不运行真实浏览器、不提交。
- **完成定义：** 能明确区分真实代码失败、环境失败和未覆盖项。
- **依赖：** `config-admin` 与 `canvas-resolution` 完成。
- **并行波次/组：** `wave-3` / `verify`。
- **启动条件：** 变更文件边界已锁定；使用隔离临时输出和端口。
- **验证范围：** API/类型/单元或集成测试、静态契约、默认和非法输入。
- **共享资源约束：** 默认只读；不写业务文件，不占用其他验证角色的输出路径/端口；可写自己的 prompt/发现文件。
- **指定 Skills：** `tdd`。
- **项目文件写入边界：** 无。
- **提交权限：** 无。
- **Prompt 归档：** `codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-verify-contract.md`。

#### `verify-regression`

- **角色/模式：** 画布/工作台回归与测试覆盖查验，`read-only verification`。
- **限定任务：** 查验图像生成、查询、保存及视频节点比例展示的行为一致性，检查测试覆盖和手动浏览器验收步骤；不启动真实浏览器。
- **预期输出：** 回归风险、缺失测试、可由用户执行的浏览器检查清单，写入专属发现文件。
- **范围外：** 不直接修复、不提交、不替用户操作浏览器。
- **完成定义：** 对既有画布和工作台路径给出通过/失败/未覆盖分类，并列出最小复现步骤。
- **依赖：** `canvas-resolution` 与 `workbench-alignment` 完成。
- **并行波次/组：** `wave-3` / `verify`。
- **启动条件：** 两个实现角色的变更文件和测试结果已提供。
- **验证范围：** 前端类型/单元测试、状态流、保存行为、回归风险和手动验收说明。
- **共享资源约束：** 默认只读；不运行浏览器，不共享服务端口，不写业务文件；仅写自己的 prompt/发现文件。
- **指定 Skills：** `tdd`。
- **项目文件写入边界：** 无。
- **提交权限：** 无。
- **Prompt 归档：** `codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-verify-regression.md`。

wave-3 扇入门槛：两个查验角色均完成或明确阻塞；结果已分类且未覆盖项清楚；若有失败，先启动最小范围修复并重新查验受影响角色。

### wave-4：整合与收尾（串行）

#### `integration/closer`

- **角色/模式：** 整合、最终验证、workflow 收尾和提交，`write integration`。
- **限定任务：** 阅读所有发现文件和摘要，检查任务分支改动、整合非重叠成果、处理必要冲突、运行最终聚焦验证、更新全局 workflow 文档，并在契约允许时提交。
- **预期输出：** 完整实现、更新后的 `decisions.md`/`progress.md`/`acceptance.md`/`subagent-plan.md`、最终验证结果和任务分支提交。
- **范围外：** 不合并回 `main`、不推送、不删除分支、不创建 worktree；不替用户运行真实浏览器。
- **完成定义：** 所有验收标准有证据；基准祖先关系、分支、prompt 占位符、写入边界和工作区状态检查通过；失败和残余风险已记录。
- **依赖：** wave-3 扇入完成，所有失败已修复或明确阻塞。
- **并行波次/组：** `wave-4` / `closer`，串行。
- **启动条件：** 所有上游 Subagent 摘要和专属发现文件可读，当前分支仍为任务分支。
- **验证范围：** 端到端可执行的聚焦测试、静态检查、契约回归、文档一致性和 Git 状态。
- **共享资源约束：** 独占最终整合阶段；不要覆盖调用前用户改动；不运行真实浏览器；外部资源需要时使用本地 `7897`。
- **指定 Skills：** `ponytail（full）`、`tdd`。
- **项目文件写入边界：** 所有已分配实现文件、对应测试和 workflow 目录；不得修改无关文件。
- **提交权限：** 仅允许在所有验证和文档收尾完成后提交当前任务分支。
- **Prompt 归档：** `codex/workflow2026-08-19_codex-image-resolution-config/subagent-prompt-integration-closer.md`。

## 调度与健康检查要求

- 每个 Subagent 启动后先回报已接收任务、角色、波次、并行组、依赖和 Skill 路由。
- wave-1、wave-2、wave-3 结束前做扇入检查：完成/阻塞状态、健康状态、无未归属改动、下一波启动条件。
- 不忙轮询；依赖阶段结束或状态变化时检查。
- 发现文件冲突、越权写入、无进展或验证失败时，只重新分配受影响边界。
- 用户确认项只限产品语义无法从代码/文档/测试判断的情况；问题和选项写入对应发现文件。

## 手动浏览器验收交接

由 `verify-regression` 和 `integration/closer` 产出最终清单，至少覆盖：

- 管理后台 tab 是否显示四个分辨率选项，保存后刷新/重新读取是否保持。
- 选择不同图片模型和分辨率时，画布目标视频节点的宽高比选项是否按配置变化。
- 默认值、未配置模型、非法/缺失配置的用户可见行为。
- 生图工作台生成、查询/轮询、成功结果保存和失败提示是否与我的画布一致。
- 既有模型和既有画布/工作台路径是否不回归。
