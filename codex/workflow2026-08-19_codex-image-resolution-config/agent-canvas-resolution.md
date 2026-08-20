# canvas-resolution 实现记录

## 状态

- 结果：`completed`
- 任务 slug：`canvas-resolution`
- 分支：`codex/image-resolution-config`
- 写入范围：共享 `ImageSettingsPanel`、同目录测试、Prompt 归档与本专属发现文件
- 未提交、未切换分支、未操作 worktree

## 产物

- `web/src/components/image-settings-panel.tsx`
  - 新增公开纯 resolver：`visibleImageAspectOptions`
  - 新增公开纯归一化：`normalizeImageSizeForResolution`
  - 远程模式按当前 `model` / `imageModel` 匹配公开 `imageRequestFormats`
  - 兼容渠道前缀模型名，缺失/非法 `resolution` 回落 `default`
  - 面板只渲染当前档位选项
  - 当前尺寸失效时，面板先使用安全归一值渲染，再通过既有 `onConfigChange` 写回
- `web/src/components/image-settings-panel.test.tsx`
  - 覆盖四档映射、非法回退、合法值保持、方向归一化、组件可见项与模型切换写回
- `subagent-prompt-canvas-resolution.md`
  - 已原样归档任务 prompt
  - 占位符扫描无未替换模板变量；协议正文中的 `{{...}}` 仅为字面示例

## 映射依据

完全复用现有 `aspectOptions`，没有新增尺寸体系：

| resolution | 可见选项 |
| --- | --- |
| `default`、缺失、非法 | 现有全部 13 项，顺序不变 |
| `1k` | `1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`16:9`、`9:16` |
| `2k` | `2048x2048`、`2048x1152`、`1152x2048` |
| `4k` | `3840x2160`、`2160x3840` |

归一化规则：

- 当前值仍在允许列表时原样保留。
- 受限档位下，隐藏旧值优先映射到同方向的现有尺寸。
- 没有同方向项时回退该档第一项，例如方形切到仅含横/竖选项的 `4k`。
- `default`、缺失或非法档位保留已有自定义尺寸。
- 只对 `channelMode === "remote"` 应用公开配置，本地自定义渠道保持原行为。

## TDD 红绿切片

1. `default`：红灯为 resolver 未导出；最小实现返回现有完整常量；`1 pass`。
2. `1k`：红灯显示多出 2K/4K/auto；最小实现取七个基础项；`2 pass`。
3. `2k`：红灯显示仍返回全部；最小实现取三个现有 2K 项；`3 pass`。
4. `4k`：红灯显示仍返回全部；最小实现取两个现有 4K 项；`4 pass`。
5. 缺失/非法回退：加入回归断言，已有最小 default 分支直接通过；`5 pass`。
6. 合法值保持：红灯为归一化 helper 未导出；最小实现先保持当前值；`6 pass`。
7. 隐藏值归一化：红灯实际值仍为 `3840x2160`；加入方向匹配后得到 `2048x1152`；`7 pass`。
8. 组件接线：红灯为 4K 配置仍渲染 `1:1(2k)`；接入配置解析和可见列表后；`8 pass`。
9. 交互回归：模型从 4K 切到 2K 时只写回一次 `size=2048x1152`；`9 pass`。

## 聚焦验证

执行：

```text
bun test \
  src/components/image-settings-panel.test.tsx \
  src/pages/canvas/components/canvas-node-config.test.ts \
  src/components/video-settings-panel.test.tsx
```

结果：

- `15 pass`
- `0 fail`
- 未运行真实浏览器、服务、全仓测试、构建、类型检查或格式化

## 并行协作

- 开始实现时 `ImageRequestFormatSetting` 尚无 `resolution`，消费端使用最小结构兼容读取。
- 收尾时观察到 config-admin 已在同一工作区加入正式 `ImageResolutionOption` 与 `resolution` 字段。
- 未修改或回滚其 DTO、管理后台、后端、API 和测试文件。
- workbench-alignment 的图片 API/helper 改动同样保持不动。

## Skills 与资料

- `ponytail`：full
- `tdd`，并完整读取 `tests.md`、`mocking.md`
- Serena：`initial_instructions`、项目激活、符号与引用调查
- Context7：
  - React 19.2.7：受控值与 effect/派生值指导
  - Ant Design 6.5.0：受控 `Switch` 与 `ConfigProvider` 主题 API
- 已读取 `AGENTS.md`、`CONTEXT.md`、`agent-canvas-workbench-map-resume.md`
- 仓库当前没有 `docs/adr/` 目录，无相关 ADR 可读

## 未覆盖项与风险

- 自由宽高输入仍可产生任意尺寸；本任务只约束用户可见比例/尺寸选项及档位切换归一化。
- 未增加请求级分辨率校验，真实 API 强约束属于明确范围外事项。
- Canvas 弹出面板未挂载时不会运行组件 effect；面板挂载后会立即以归一值渲染并写回。若后续要求模型切换瞬间即持久化，应在模型选择动作的共享上游接入同一纯 helper。
