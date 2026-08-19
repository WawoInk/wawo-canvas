# Decisions

## Initialization

- 任务分支：`codex/align-generation-workbenches`
- 基准引用：本地 `main`
- 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 工作区：`/Users/eldenpdx/git-project/infinite-canvas`
- 启动前工作区状态：干净，`git status --short` 无输出
- 不创建额外 worktree、子分支、stash 或提交

## Scope and Assumptions

- 本 Subagent 只负责初始化与规划，不实现图片/视频生成业务。
- 后续 Subagents 共用当前工作区和同一任务分支；不得创建额外 worktree 或分支。
- 真实浏览器测试由用户执行；后续查验 Subagents 不执行真实浏览器测试。
- 外部资源访问统一保留用户指定的本地 `7897` 端口约束，具体接入方式由实现 Subagents 根据现有代码确认。
- 画布节点逻辑是对齐基准；图片工作台、视频创作台、系统设置模型配置、日志落库和积分记账分别由专责 Subagents 调查与实现，再由整合角色统一验收。

## Alternatives and Rationale

- 优先使用本地 `main`，因为它存在且与 `origin/main` 同指；这样基准确定、无需网络同步，也符合用户的基准优先级。
- 采用按领域拆分的执行角色，而不是按文件随意拆分：生成任务通常横跨前端请求、后端服务、轮询/存储和账务日志，按业务边界更易保持行为一致。
- 将只读调查置于实现波次之前，并让两个工作台调查并行；调查结果作为实现边界和共享契约，降低并行写入冲突。
- 模型配置、日志和积分属于跨工作台的共享契约，单独安排调查/契约角色并在后续串行整合，避免两个实现角色各自发明规则。
- 任务规模足够大，规划为多 Subagent、多波次；写入边界按目录和文件清单收敛，整合与最终提交只交给 `integration/closer`。

## Open Decisions for Later Agents

- 画布图片节点和视频节点的具体代码入口、生成供应商协议、轮询终态、存储介质、失败退款/积分规则，必须以仓库现状和现有测试为准。
- 系统设置模型配置的单一读取入口及前后端传递方式，由模型配置调查角色确认；不得在工作台内新增第二套配置来源。
- 日志字段、落库时机、积分扣除/返还与幂等键，由日志积分调查角色确认并形成可执行验收项。

## Final Integration Decisions

- 保留现有 compatibility task 作为图片/视频工作台远程生成契约，不新增第二套 Profile、Adapter 或轮询服务。
- 图片上游成功先进入 `pending`，前端物化到 `results/images` 后用平台 task ID 回写 `fileIds`；服务端只接受当前用户拥有的有效图片文件并据此转为成功。
- 图片任务提交后由服务端超时观察器覆盖 `running` 和等待物化的 `pending`，超时通过共享终态事务失败并幂等退款。
- 视频工作台只轮询平台 task detail；取消 compatibility task 时继续使用上游 task ID，平台 task ID 仅用于平台状态观察。
- Canvas、图片工作台和视频工作台均使用 `useEffectiveConfig` 的系统设置投影；未新增工作台私有模型来源。
- 日志创建失败立即终止代理请求；失败、取消、超时统一使用任务级终态仲裁和唯一 credit log，重复轮询或回调不会重复退款。
- tracked `server` 是测试/构建副产物，已恢复到基准提交内容，不纳入任务。
