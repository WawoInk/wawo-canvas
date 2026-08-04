# Canvas i18n 集成验证

## 验证范围

- 代码：`web/src/pages/canvas/**`
- 资源：`zh-CN.json`、`en-US.json` 顶层 `canvas` 节点
- 覆盖 Canvas 项目列表、编辑器、节点、生成配置、素材选择、在线助手和本地 Agent
- 未修改路由、API 合同、工具 schema、协议枚举、业务流程或其他模块

## 发现与修复

1. Canvas 项目列表及卡片的一组调用误用了不存在的 `canvas.catalog.*`，而已合并资源使用 `canvas.library.*`。
   - 已统一回 `canvas.library.*`。

2. `use-canvas-store.ts` 已引用 `canvas.editor.project.imported`，但合并后的两份 locale 缺少该 key。
   - 已在中英文 `canvas.editor.project` 中补齐 `imported`。

3. `constants.ts` 的节点默认标题仍包含中英文硬编码，并会被 Agent 新建节点流程使用。
   - 已移除尺寸配置中的用户可见标题。
   - Agent 新建节点改为按当前语言读取 `canvas.nodeTypes.*`。

4. Canvas 资源引用只有文本标签接入 i18n，图片、视频、音频仍依赖共享中文标签 helper；同时引用列表的 memo 不会因语言切换重算。
   - 四类资源统一使用 `canvas.resources.labels.*`。
   - 资源构建函数接收当前 `t`，相关 memo 增加 `t` 依赖，切换语言后即时更新。

## Key 审计

- 扫描 `web/src/pages/canvas` 下 56 个 TypeScript/TSX 文件。
- 收集到 840 个 `canvas.*` 字面量引用，去重后 665 个 key。
- 静态 key、变量 key 定义和复数 base key 在 `zh-CN`、`en-US` 中缺失均为 0。
- 两份 `canvas` 资源各 729 个叶子 key，key 集合完全对称。
- 已单独枚举并验证以下动态家族：
  - 五种节点类型
  - 文本、图片、视频、音频资源标签
  - 短剧素材角色
  - 遮罩编辑错误
  - 总览状态
  - 媒体上传、替换、下载动作
  - 节点状态
  - 在线助手生成模式
  - 在线/本地 Agent 模式及工具状态

## 硬编码审计

未发现直接渲染的中英文 UI 硬编码。以下内容按要求保留并明确豁免：

- `ONLINE_AGENT_PROMPT`、工具描述和画布上下文序列化文本：属于 AI system prompt 和 tool schema 行为合同。
- 中文/英文状态正则：用于识别历史记录、服务端原始消息和旧 Agent 消息，不直接渲染。
- 用户输入、项目名、节点内容、素材标题和服务端 `error/msg`：保持原文。
- 节点类型值、任务状态、MIME、URL protocol、工具名和操作枚举：属于协议值。
- `Ctrl / Cmd`、`Delete / Backspace` 等：物理快捷键名称。
- `missing projects.json`、`invalid protocol`：内部控制流错误，均被立即捕获并转换为本地化提示。
- 测试夹具中的中文内容与一条中文代码注释：不属于用户界面。

## 测试结果

分组运行全部 10 个 Canvas 测试文件：

```text
canvas-prompt-chip-editor-expand.test.tsx    2 pass
canvas-node-generation.test.mjs             7 pass
asset-picker.test.mjs                       3 pass
generation/background/config/chips group   11 pass
overview/replica/image-edit-source group    7 pass
```

合计：`30 pass / 0 fail`。

## 构建结果

执行：

```text
cd web
bun run build
```

结果：成功。

- `tsc --noEmit` 成功。
- Vite production build 成功。
- 仅保留项目既有的动态/静态 import 混用警告和大 chunk 警告。
- `jq empty`、中英文 key 对称检查和 `git diff --check` 均通过。
- 未提交 Git。

## 本轮必要修复文件

- `web/src/pages/canvas/index.tsx`
- `web/src/pages/canvas/project/index.tsx`
- `web/src/pages/canvas/constants.ts`
- `web/src/pages/canvas/components/canvas-project-card.tsx`
- `web/src/pages/canvas/components/canvas-delete-projects-dialog.tsx`
- `web/src/pages/canvas/utils/canvas-agent-ops.ts`
- `web/src/pages/canvas/utils/canvas-resource-references.ts`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`
