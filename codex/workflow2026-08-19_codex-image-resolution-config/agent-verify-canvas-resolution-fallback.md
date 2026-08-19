# verify-canvas-resolution-fallback

## 状态

- 结果：发现 2 个需要修复的行为问题；未修改业务源码、测试、依赖或配置。
- 分支：`codex/image-resolution-config`
- 查验范围：共享 `ImageSettingsPanel`、Canvas 图片节点调用链、config-admin DTO/归一化、图片请求尺寸解析及相关测试。

## Findings

### [P1] Canvas 关闭设置弹层时，模型切换不会归一化旧尺寸，仍可把受限尺寸送进请求

- 位置：`web/src/pages/canvas/components/canvas-image-settings-popover.tsx:64`、`web/src/components/image-settings-panel.tsx:93-95`、`web/src/pages/canvas/project/index.tsx:2191`、`web/src/services/api/image.ts:201-207`。
- `ImageSettingsPanel` 只在 `open && buttonRect` 时挂载；因此用户在 Canvas 先从 4K 模型切到 2K 模型、未打开设置弹层就直接生成时，归一化 effect 不会执行。
- `buildNodeConfig` 仍从节点 metadata/global config 取得旧的 `3840x2160`，`createAsyncImageTask` 的 `resolveRequestSize` 直接保留该显式尺寸并放入请求 payload。设置按钮也会继续显示旧尺寸，直到弹层被打开。
- 这违反了“模型切换安全归一化无效选中值”，并使公开 resolution 限制只停留在可见 UI，容易绕过。
- 建议把同一纯归一化逻辑接到 Canvas 模型/生成配置的实际边界，或保证模型切换时面板始终执行并持久化；不要在请求调用者复制另一套映射。

### [P1] 受限 resolution 会误伤合法自由尺寸

- 位置：`web/src/components/image-settings-panel.tsx:53-61`、`web/src/components/image-settings-panel.tsx:89-105`。
- 对 `1k/2k/4k`，resolver 只接受预设 `aspectOptions`；任意合法的 `<width>x<height>` 若不等于预设值，就按方向替换。只读探针结果：`normalizeImageSizeForResolution("2k", "1504x1504")` 得到 `2048x2048`，`("1k", "1200x800")` 得到 `3:2`。
- 面板挂载后 effect 会把该替换值写回配置，导致用户已经输入的自由宽高丢失；这与现有自由尺寸入口不兼容。若 resolution 只限制“用户可见预设项”，自由尺寸应保留；若产品要强制上限，应单独定义并校验，而不是静默改成另一尺寸。

## 正常项

- `default`、缺失、非法 resolution 都回落为完整现有选项；`1k/2k/4k` 映射复用同一 `aspectOptions` 常量，顺序与预设尺寸一致。
- 后端 `normalizeImageRequestFormats` 和管理端 `normalizeAdminImageRequestFormats` 将非法/缺失值归一为 `default`；公开 DTO 类型已贯通到 `AiConfig`。
- 远程模式才消费公开限制，本地自定义渠道保持原行为；空 `imageRequestFormats` 不会崩溃并回落完整选项。
- 当前请求 API 的已有模型、格式、source、upstream/platform task ID 测试未见由本分辨率改动造成的稳定回归。

## 测试与 seam

- 通过：`bun test src/components/image-settings-panel.test.tsx`（9 pass）；`bun test src/services/api/image.test.mjs`（10 pass）；Canvas 配置/恢复与 config store 聚焦测试（12 pass）；管理端聚焦测试（3 pass）；Go settings 聚焦测试通过；`git diff --check` 通过。
- 合并运行时 `image.test.mjs` 曾出现 1 次本地 HTTP/CORS 抖动，单独重跑全通过。
- 现有测试主要验证导出的 resolver 和服务端静态 markup；缺少“Canvas 弹层关闭时切换模型后立即生成”的公开流程，以及自由尺寸保留/请求 payload 的行为测试。个别 HTML 正则也偏内部 markup，而非可访问用户行为。

## 残余风险 / 阻塞

- `quality` 仍可独立把比例解析成不同像素预算，resolution 目前不是请求级硬上限；是否需要强约束需产品明确。
- 未运行浏览器、构建、类型检查或全仓测试，符合任务契约；无外部阻塞。

## Skills

- 已完整读取并遵守 `tdd`（含 `tests.md`、`mocking.md`）与 `ponytail`（full）。
- 已调用 Serena `initial_instructions` 并激活项目；已读取 `AGENTS.md`、`CONTEXT.md`、`docs/agents/domain.md` 及指定 workflow 记录。
