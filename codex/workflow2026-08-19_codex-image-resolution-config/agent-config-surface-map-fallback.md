# config-surface-map-fallback 调查记录

## 状态与范围

- 状态：`completed`
- 任务 slug：`config-surface-map-fallback`
- 角色：后端/管理后台配置只读调查
- 执行模式：只读调查
- 并行波次/组：`wave-1` / `map-fallback`
- 分支：`codex/image-resolution-config`
- HEAD / `main` merge-base：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 实际读取 Skill：`/Users/eldenpdx/.codex/skills/subagents-workflow/SKILL.md`
- 未读取或调用：ponytail、tdd、Context7、Web 搜索
- 未运行：测试、构建、格式化、浏览器、服务、数据库

## 结论

1. 图片请求格式不是独立表或独立接口，而是公开设置
   `public.modelChannel.imageRequestFormats` 中的按图片模型数组。
2. 当前单项契约是 `{ model, format, canvasRequestMode }`。最小方案是在同一项增加
   单选字段 `resolution`，不要新增第二份按模型映射，也不要重命名现有类型。
3. 推荐 wire 值固定为 `"default" | "1k" | "2k" | "4k"`。
   缺失、空白或非法值由后端归一为 `"default"`，但不能因此丢弃整项。
4. `"default"` 推荐表示“不增加分辨率过滤，保持现有宽高比集合”；具体 tier 到宽高比的映射
   属于画布/生图消费侧，不应进入设置 service 或管理 API。
5. 现有 public JSON 整体 marshal/upsert 能自然持久化新字段，不需要数据库迁移、新表、
   repository 方法、新 handler 或新路由。
6. 当前“图片请求格式”区域是 `Form.List`，没有局部 Tabs。若需求中的“tab”是字面交互，
   需要由产品确认；无论采用 Select 列还是局部 Tabs，都应编辑同一个
   `imageRequestFormats[n].resolution` 字段。
7. 原始需求同时出现“图片模型”和“视频节点”，而当前代码中图片与视频配置体系独立。
   配置侧应保持图片模型契约，不能复用视频的 `480p/720p/1080p` generation profile 字段。

## 当前后端链路

### 模型与 JSON 路径

`model/setting.go:38-48`

```go
type ImageRequestFormatSetting struct {
    Model             string `json:"model"`
    Format            string `json:"format"`
    CanvasRequestMode string `json:"canvasRequestMode"`
}
```

- `PublicModelChannelSetting.ImageRequestFormats` 的 JSON 键为 `imageRequestFormats`。
- `model.Setting` 以 `key` 为主键，`value` 为整块 JSON。
- `model.Settings` 是管理员接口的完整 `{ public, private }` DTO。

推荐最小后端契约：

```go
type ImageRequestFormatSetting struct {
    Model             string `json:"model"`
    Format            string `json:"format"`
    CanvasRequestMode string `json:"canvasRequestMode"`
    Resolution        string `json:"resolution"`
}
```

### 读取与保存

- 公开读取：`GET /api/settings`
  - `router/router.go:25`
  - `handler.Settings` -> `service.PublicSettings`
  - `repository.GetSettings` -> `normalizeSettings(settings).Public`
  - 无需认证。
- 管理读取：`GET /api/admin/settings`
  - `router/router.go:182,213`
  - `/api/admin` 整组经过 `middleware.AdminAuth`
  - `handler.AdminSettings` -> `service.AdminSettings`
  - 返回归一化设置，并遮盖 private API key/secret。
- 管理保存：`POST /api/admin/settings`
  - `router/router.go:214`
  - `handler.AdminSaveSettings` 解码完整 `model.Settings`
  - `service.SaveSettings` 归一化、保留私密字段、校验 generation bindings 后保存。

成功响应继续使用：

```json
{
  "code": 0,
  "data": {},
  "msg": "ok"
}
```

公开响应中的相关片段应为：

```json
{
  "modelChannel": {
    "imageRequestFormats": [
      {
        "model": "gpt-image-2",
        "format": "default",
        "canvasRequestMode": "split",
        "resolution": "default"
      }
    ]
  }
}
```

### 默认值与校验

`service/settings.go:130-209`

当前 `normalizeImageRequestFormats`：

- trim `model`、`format`、`canvasRequestMode`；
- 只保留 `imageModels` 中存在的模型；
- 同一模型只保留第一项；
- `format` 只接受 `application/json`、`multipart/form-data`、`default`；
- 非法 `format` 会丢弃整项；
- `canvasRequestMode` 只有 `generations` 被保留，其他值回落 `split`；
- nil 输入归一为非 nil 空数组。

新增字段建议沿用 `canvasRequestMode` 的容错方式：

```text
trim(resolution)
允许值：default、1k、2k、4k
缺失/空白/非法：default
```

关键区别：非法 resolution 只回落 `default`，不要像非法 format 一样丢弃整项。
这样旧 JSON 在任何公开或管理读取时都会投影出显式默认值，无需数据迁移。

### 持久化

`repository/setting.go:10-47`

- `GetSettings` 读取 `settings` 表，按 `public/private` key 反序列化。
- `SaveSettings` 分别 marshal public/private，按 key batch upsert。
- 冲突时只更新 `value`、`updated_at`。

因此新增嵌套字段不需要修改：

- `repository/setting.go`
- `repository/db.go`
- `docs/content/docs/backend/backend-database.mdx`

## 当前前端契约与管理页面

### 公开与管理 DTO

`web/src/services/api/settings.ts:4-40`

- `ImageRequestFormatOption`：
  `"application/json" | "multipart/form-data" | "default"`
- `CanvasImageRequestMode`：`"split" | "generations"`
- `ImageRequestFormatSetting` 是 `GET /api/settings` 的公开 DTO。

`web/src/services/api/admin.ts:310-331,385-395`

- `AdminImageRequestFormat` 是管理 DTO。
- `fetchAdminSettings` 调用 `GET /api/admin/settings`。
- `saveAdminSettings` 调用 `POST /api/admin/settings`。

推荐共享类型：

```ts
export type ImageResolutionOption = "default" | "1k" | "2k" | "4k";

export type ImageRequestFormatSetting = {
    model: string;
    format: ImageRequestFormatOption;
    canvasRequestMode: CanvasImageRequestMode;
    resolution: ImageResolutionOption;
};
```

`AdminImageRequestFormat.resolution` 使用同一 `ImageResolutionOption`，避免管理端和公开端
重复写两个 union。

### 公开配置传播

- `ClientRootInit` 在挂载时调用 `useConfigStore.loadPublicSettings`
  （`web/src/components/layout/client-root-init.tsx:41-43`）。
- `useConfigStore` 总是保存完整 `publicSettings`。
- 后台强制远程模式时，`loadPublicSettings` 将整个 `imageRequestFormats` 数组复制到
  `AiConfig.imageRequestFormats`（`web/src/stores/use-config-store.ts:227-279`）。
- 新增嵌套字段可自然透传，因此运行时代码通常不需要修改
  `web/src/stores/use-config-store.ts`。

建议消费侧仍以 `channelMode === "remote"` 为限制门槛，避免本地自定义渠道中同名模型
被后台配置意外约束。

### 管理页面

`web/src/pages/admin/settings/index.tsx`

- `emptySettings.public.modelChannel.imageRequestFormats` 默认为 `[]`。
- `imageRequestFormatOptions` 定义当前协议选项。
- `Form.useWatch` 读取图片模型和已配置项，防止重复选择模型。
- “图片请求格式”是一个 `Form.List`：
  模型 Select、格式 Select、Canvas 调用方式 Select、删除按钮。
- 新增行当前默认：
  `{ model, format: "default", canvasRequestMode: "split" }`。
- `normalizePublicSetting` 同时服务加载、可视化模式、JSON 模式和保存回填。

建议新增行默认：

```ts
{
    model: nextImageRequestModel,
    format: "default",
    canvasRequestMode: "split",
    resolution: "default",
}
```

`normalizePublicSetting` 必须把缺失/非法 resolution 归一为 `default`，否则 JSON 编辑模式
可以绕过可视化控件。

### “tab”解释

当前页面已有两类切换：

- 顶层 `Tabs`：公开配置 / 私有配置；
- `Segmented`：可视化 / JSON。

图片请求格式区域没有局部 Tabs。建议按验收含义二选一：

1. 若“tab”是泛指配置项：在现有模型行增加一个 resolution Select，改动最小。
2. 若必须是字面 Tabs：在该区域增加“请求格式 / 分辨率”局部 Tabs，但两个 pane 必须编辑
   同一个 `imageRequestFormats` 数组，不能创建 `imageResolutionSettings`。

字面 Tabs 只改变 `index.tsx` 内的呈现，不改变后端或 API 契约。

## 最小实现文件边界

### 运行时必改

- `model/setting.go`
- `service/settings.go`
- `web/src/services/api/settings.ts`
- `web/src/services/api/admin.ts`
- `web/src/pages/admin/settings/index.tsx`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`

### 聚焦测试

- `service/settings_test.go`
- `web/test/admin-settings.test.tsx`

推荐采用现有 `billing-rules.ts` 模式增加纯函数 seam 时，再增加：

- `web/src/pages/admin/settings/image-request-formats.ts`
- `web/src/pages/admin/settings/image-request-formats.test.mjs`

可选公开传播回归：

- `web/src/stores/use-config-store.test.ts`

### 不需要修改

- `repository/setting.go`
- `repository/db.go`
- `handler/settings.go`
- `handler/response.go`
- `router/router.go`
- `web/src/services/api/request.ts`
- `web/src/stores/use-config-store.ts`

消费侧文件应留给画布/生图实现边界：

- `web/src/components/image-settings-panel.tsx`
- `web/src/pages/canvas/**`
- `web/src/pages/image/**`
- `web/src/services/api/image.ts`

整合角色可按实际实现更新 `.knowledge/api.md`、todo/pending-test 和 changelog；
新增 JSON 字段本身不需要数据库结构文档变更。

## 现有测试

直接相关：

- `service/settings_test.go`
  - `TestNormalizeSettingsKeepsExplicitImageRequestFormatsOnly`
  - `TestNormalizeSettingsKeepsDefaultImageRequestFormat`
  - `TestNormalizeSettingsKeepsCanvasImageRequestModes`
- `web/test/admin-settings.test.tsx`
  - 当前只有普通视频分辨率 UI 用例，可复用 happy-dom、mock axios 和页面挂载方式。
- `web/src/stores/use-config-store.test.ts`
  - 覆盖公开设置加载和强制远程模型列表。
- `web/src/services/api/async-image-edit-form.test.mjs`
  - 覆盖按模型选择请求格式和 `default` fallback。
- `web/src/services/api/image.test.mjs`
  - 覆盖 Canvas 图片请求消费 `format` 与 `canvasRequestMode`。

当前没有 settings 专用 handler/repository 测试。HTTP + PostgreSQL 测试会修改全局 settings 行，
对单个嵌套 JSON 字段成本和并发风险较高，不建议作为首轮必选。

## 候选公开 TDD seams

### 1. 后端归一化 seam

首选落点：`service/settings_test.go`，通过同 package 的 `normalizeSettings` 或
`normalizeImageRequestFormats` 验证：

- 四个合法值逐个保留；
- missing、空白、非法值回落 `default`；
- resolution 前后空白被 trim；
- unknown model、重复 model、非法 format 的既有行为不回归；
- marshal 后总是显式输出 `"resolution":"default"`。

这是最稳定的 seam，因为公开读取、管理读取和管理保存都经过同一归一化链路。

### 2. 管理端纯函数 seam

项目已有 `web/src/pages/admin/settings/billing-rules.ts` +
`billing-rules.test.mjs` 的公开纯函数模式。可用同一模式导出：

```ts
export const imageResolutionOptions = [
    "default",
    "1k",
    "2k",
    "4k",
] as const;

export function normalizeAdminImageRequestFormats(
    items: Array<Partial<AdminImageRequestFormat>>,
): AdminImageRequestFormat[];
```

页面加载、JSON 解析和保存前统一调用该函数。这样可先写无 DOM 的红测，且不需要导出整个
`normalizePublicSetting` 或挂载大页面验证每个非法输入分支。

### 3. 管理页面公开 seam

`AdminSettingsPage` 的现有 happy-dom 测试可验证：

- 页面显示分辨率配置和四个选项；
- 新增模型默认 `resolution: "default"`；
- 保存 POST body 中字段位于
  `public.modelChannel.imageRequestFormats[n].resolution`；
- mock POST 返回服务端归一化值后，页面按返回值回填。

### 4. 公开配置传播 seam

`useConfigStore.loadPublicSettings` 可验证：

- `publicSettings.modelChannel.imageRequestFormats` 保留 resolution；
- `allowCustomChannel === false` 时，`config.imageRequestFormats` 也保留该字段。

## 风险与阻塞项

- 无技术阻塞。
- 产品歧义 1：`resolution` 是单选还是多选。根据四个互斥选项和 `default` 语义，
  推荐单选；若需同时开放多个 tier，必须改为数组并另行定义空数组、排序、去重及
  `default` 与其他值共存规则。
- 产品歧义 2：“tab”是否要求字面 Tabs。源码无法确认，最小行为实现是同一模型行增加 Select。
- 产品歧义 3：需求中的“视频节点”与图片模型契约冲突。当前代码没有图片模型到视频模型的关联；
  若字面目标确为视频节点，应停止本方案并改查 generation profile 能力契约。
- 现有管理行在 md 栅格上已占满 24 列，增加第四个选择器需要重新分配列宽并检查中英文文本。
- `handler.AdminSaveSettings` 忽略 JSON decode error、`repository.GetSettings` 忽略单行
  unmarshal error，属于既有风险，本任务不应顺手修复。

## 只读验证范围

已核对：

- Git 分支、HEAD、`main` merge-base 和工作区状态；
- model/service/repository/handler/router 的设置读写链路；
- 管理/公开前端 DTO、统一 API envelope、鉴权和设置传播；
- 管理后台入口、表单默认值、可视化/JSON 归一化；
- 现有 Go、管理页面、store 和图片请求相关测试入口；
- 当前工作流中的共享决策与消费侧调查结论。

未执行测试、构建、浏览器、服务或数据库操作。
