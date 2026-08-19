# config-surface-map-resume 调查记录

## 状态

- 结果：completed
- 任务 slug：`config-surface-map-resume`
- 角色：后端/管理后台配置只读调查
- 执行模式：只读调查
- 并行波次/组：`wave-1` / `map-resume`
- 当前分支：`codex/image-resolution-config`
- 当前 HEAD / 基准提交：`a13233e4649ed39f220b11b0c865a2e4997f581f`
- 阻塞项：无硬阻塞；“分辨率”是单选还是多选、以及需求中“视频节点”的准确含义仍是产品/消费侧不确定项，本文给出最小合理建议。

## 结论摘要

1. 图片请求格式不是独立表或独立接口，而是公开配置
   `public.modelChannel.imageRequestFormats` 中的按图片模型数组。
2. 当前每项结构为
   `{ model, format, canvasRequestMode }`，已经同时承载协议和 Canvas 行为；
   最小方案是在同一项内增加 `resolution`，不要再建立第二份按模型映射，也不要重命名现有类型。
3. 推荐 wire 值为 `"default" | "1k" | "2k" | "4k"`，推荐单选字段
   `resolution`。缺失、空白或非法值归一为 `"default"`；未配置模型也由消费侧按
   `"default"` 处理。
4. 为保持现有功能，推荐 `"default"` 表示“不新增分辨率过滤，沿用当前可见宽高比集合”，
   而不是默认只显示一个新子集。具体宽高比映射属于画布/工作台消费侧。
5. 该字段沿现有 public JSON 流自动持久化并公开读取，不需要新增数据库列、数据表、路由、
   handler 或 repository 方法。
6. 当前“图片请求格式”区域是一个 `Form.List` 行列表，并没有局部 Ant Design `Tabs`。
   最小管理 UI 是给每行增加一个分辨率选择控件；若“tab”必须指字面上的 Tabs 交互，
   需要产品确认，不能从现有实现推导。

## 当前数据结构

### 后端模型

`model/setting.go`

- `SettingKeyPublic = "public"`、`SettingKeyPrivate = "private"`：数据库中的两行配置键。
- `ImageRequestFormatSetting`（38-42）：

```go
type ImageRequestFormatSetting struct {
	Model             string `json:"model"`
	Format            string `json:"format"`
	CanvasRequestMode string `json:"canvasRequestMode"`
}
```

- `PublicModelChannelSetting.ImageRequestFormats`
  （44-60）：公开配置数组，JSON 键为 `imageRequestFormats`。
- `Setting`（136-142）：`Key` 为主键，`Value` 是
  `json.RawMessage`，通过 GORM JSON serializer 保存。
- `Settings`（144-148）：管理员接口读写完整 `{ public, private }`。

### 前端 DTO

`web/src/services/api/settings.ts`

- `ImageRequestFormatOption`：
  `"application/json" | "multipart/form-data" | "default"`。
- `CanvasImageRequestMode`：`"split" | "generations"`。
- `ImageRequestFormatSetting`：公开读取 DTO。
- `PublicModelChannelSettings.imageRequestFormats`：`GET /api/settings`
  的公开字段。

`web/src/services/api/admin.ts`

- `AdminImageRequestFormat`：管理端 DTO。
- `AdminPublicModelChannelSettings.imageRequestFormats`：管理员 GET/POST 字段。
- `fetchAdminSettings`：`GET /api/admin/settings`。
- `saveAdminSettings`：`POST /api/admin/settings`。

### 推荐新增字段

最小契约：

```go
type ImageRequestFormatSetting struct {
	Model             string `json:"model"`
	Format            string `json:"format"`
	CanvasRequestMode string `json:"canvasRequestMode"`
	Resolution        string `json:"resolution"`
}
```

```ts
export type ImageResolutionOption = "default" | "1k" | "2k" | "4k";

export type ImageRequestFormatSetting = {
    model: string;
    format: ImageRequestFormatOption;
    canvasRequestMode: CanvasImageRequestMode;
    resolution: ImageResolutionOption;
};
```

选择单数 `resolution` 的理由：

- 原始需求给出四个互斥“选项”，并说“对应选项决定”可见宽高比。
- `"default"` 最适合作为无过滤 fallback；若与其他值同时多选，语义会冲突。
- 单字段可直接沿用 `CanvasRequestMode` 的默认化模式，变更和测试最少。

备选方案是 `resolutions: ImageResolutionOption[]`。只有产品明确要求一个模型同时开放多个
分辨率组时才应使用该方案；届时必须定义 `"default"` 与其他值共存是否合法、空数组语义、
排序和去重规则。

## 端到端调用链

### 管理员读取

1. 前端入口：
   `web/src/router.tsx` 的 `admin/settings` 路由加载
   `web/src/pages/admin/settings/index.tsx`。
2. 管理菜单：
   `web/src/layouts/admin-layout.tsx` 的 `/admin/settings` 菜单项。
3. 页面 `loadSettings`：
   `fetchAdminSettings(token)` -> `apiGet("/api/admin/settings")`。
4. HTTP：
   `web/src/services/api/request.ts` 添加 Bearer token，并从
   `{ code, data, msg }` 中解包 `data`。
5. 后端路由：
   `router/router.go` 的 `/api/admin` group 使用
   `middleware.AdminAuth`，再进入 `GET /settings`。
6. `handler.AdminSettings`：
   调用 `service.AdminSettings()`，成功后 `OK(w, settings)`。
7. `service.AdminSettings`：
   `repository.GetSettings()` -> `normalizeSettings()` ->
   `hidePrivateAPIKeys()`。
8. `repository.GetSettings`：
   读取 `settings` 表所有行，按 `public/private` key 分别
   `json.Unmarshal` 到 `model.Settings`。

### 管理员保存

1. 页面 `saveSettings`：
   `collectSettings` 合并可视化表单和 JSON 编辑模式，
   再调用 `saveAdminSettings(token, values)`。
2. `POST /api/admin/settings`：
   同样经过 `middleware.AdminAuth`。
3. `handler.AdminSaveSettings`：
   JSON decode 到 `model.Settings`，调用 `service.SaveSettings`。
4. `service.SaveSettings`：
   - 先读取已保存设置。
   - 对提交值和旧值执行 `normalizeSettings`。
   - 保留未重新提交的私有 API key、OAuth secret 和历史计费值。
   - 执行 generation binding 校验。
   - 调用 `repository.SaveSettings(settings, now())`。
5. `repository.SaveSettings`：
   分别 marshal `settings.Public`、`settings.Private`，按 key
   batch upsert；冲突时只更新 `value`、`updated_at`。
6. 返回值再次隐藏私有 secret，并通过 `{ code: 0, data, msg: "ok" }`
   返回页面。

### 公开读取

1. `router/router.go` 暴露无需登录的 `GET /api/settings`。
2. `handler.Settings` -> `service.PublicSettings`。
3. `service.PublicSettings`：
   `repository.GetSettings()` -> `normalizeSettings(settings).Public`。
4. `handler.OK` 返回统一 envelope。
5. 前端 `ClientRootInit` 首次挂载调用
   `useConfigStore.loadPublicSettings()`。
6. `fetchPublicSettings` 读取 `/api/settings`；
   `publicSettings` 总是保存在 Zustand。
7. 当前只有后台强制远程模式
   (`allowCustomChannel === false`) 才把整个
   `imageRequestFormats` 数组复制进 `AiConfig.imageRequestFormats`。
   嵌套增加 `resolution` 时，这条赋值无需额外转换即可保留字段。

## 当前默认值与校验

`service/settings.go`

- `normalizePublicSettingWithChannels`：
  - nil 的 `availableModels`、`modelCosts`、能力模型数组会变成空数组。
  - `allowCustomChannel` 缺失时默认为 `true`。
  - `allowRegister` 缺失时默认为 `true`。
  - `imageModels` 先去重，再用于归一化图片模型配置。
- `normalizeImageRequestFormats`：
  - trim `model`、`format`、`canvasRequestMode`。
  - 只保留 `imageModels` 中存在的模型。
  - 同一模型只保留第一项。
  - 非法 `format` 会丢弃整项。
  - `canvasRequestMode` 只有 `"generations"` 被保留；其他值统一为
    `"split"`。
  - nil 输入返回非 nil 空数组，因此公开 JSON 为 `[]`，不是 `null`。

推荐对新增 `resolution` 复用 `canvasRequestMode` 的模式：

- trim 后仅接受 `"default"`、`"1k"`、`"2k"`、`"4k"`。
- 缺失、空白、大小写不符或其他非法值统一为 `"default"`。
- 不要因为单个 resolution 非法而丢掉整条图片请求格式配置。
- 不新增旧字段迁移或兼容分支；仓库规则明确项目尚未上线。

管理前端 `web/src/pages/admin/settings/index.tsx`

- `emptySettings.public.modelChannel.imageRequestFormats` 默认为 `[]`。
- `imageRequestFormatOptions` 提供请求格式枚举。
- `Form.useWatch` 读取 `imageModels` 和 `imageRequestFormats`。
- `configuredImageRequestModels` 防止 UI 中重复选择同一模型。
- 新增一行当前默认：
  `{ model: nextImageRequestModel, format: "default", canvasRequestMode: "split" }`。
- `normalizePublicSetting` 会过滤非法 format，并把非法/缺失
  `canvasRequestMode` 归一为 `"split"`。
- 可视化/JSON 两种编辑模式最后都经过同一个
  `normalizePublicSetting`，新增字段也必须在这里归一为 `"default"`。

推荐新增行默认变为：

```ts
{
    model: nextImageRequestModel,
    format: "default",
    canvasRequestMode: "split",
    resolution: "default",
}
```

## API 响应

当前公开接口成功 envelope：

```json
{
  "code": 0,
  "data": {
    "modelChannel": {
      "imageRequestFormats": []
    },
    "auth": {}
  },
  "msg": "ok"
}
```

推荐新增后的相关片段：

```json
{
  "code": 0,
  "data": {
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
  },
  "msg": "ok"
}
```

管理员 GET/POST 的 `data` 是完整：

```json
{
  "public": {
    "modelChannel": {
      "imageRequestFormats": []
    }
  },
  "private": {}
}
```

管理员响应中的渠道 `apiKey` 和 LinuxDo `clientSecret` 会被清空；
公开接口根本不返回 private 设置。

四个选项只扩展配置 JSON，不应改变：

- endpoint 路径；
- `{ code, data, msg }` envelope；
- request format 的现有 fallback；
- AI 生成请求 body。是否把 tier 转成尺寸/比例由消费侧完成。

## 管理后台现有模式与复用建议

入口文件：`web/src/pages/admin/settings/index.tsx`

- 页面顶层 `Tabs` 仅用于“公开配置 / 私有配置”。
- “图片请求格式”区域是 `Form.List`，每个模型一行：
  模型 Select、格式 Select、Canvas 调用方式 Select、删除按钮。
- 新增模型按钮自动选择下一个尚未配置的 `imageModels` 项。
- 页面支持“可视化 / JSON” `Segmented` 切换，二者共享 DTO 和归一化。
- 保存后使用服务端返回值重新填表，因而服务端默认化结果会立即反映到 UI。

最小复用：

1. 增加一个类型安全的
   `imageResolutionOptions` 常量，值由
   `AdminImageRequestFormat["resolution"]` 约束。
2. 在现有 `Form.List` 行中增加单选 `Select`，required 规则和
   placeholder 跟随 format/canvas mode 现有写法。
3. 继续使用同一模型唯一性、add/remove、可视化/JSON 切换和保存流程。
4. 在 `normalizePublicSetting` 中默认 resolution，不增加页面级 state。
5. 在中英文 locale 的
   `admin.settings.public.imageRequestFormats` 下补充 label、required、
   placeholder 和四个 option 文案。

不建议：

- 创建独立 `imageResolutionSettings` 数组；会重复 model key、增加同步和冲突处理。
- 重命名 `ImageRequestFormatSetting`；虽然名称已偏窄，但重命名会扩大 diff。
- 复用视频 `GenerationLimitOverrides.ResolutionValues` 或
  `ModelCost.ResolutionCredits`；它们分别是视频能力限制和计费，值域为
  `480p/720p/1080p`，语义不同。
- 为该字段新增数据库迁移、repository 方法或专用 endpoint。
- 仅在可视化表单加控件而忘记 JSON 模式归一化。

## 建议的项目文件写入边界

### `config-admin` 应拥有

必需：

- `model/setting.go`
- `service/settings.go`
- `service/settings_test.go`
- `web/src/services/api/admin.ts`
- `web/src/services/api/settings.ts`
- `web/src/pages/admin/settings/index.tsx`
- `web/src/i18n/locales/zh-CN.json`
- `web/src/i18n/locales/en-US.json`
- `web/test/admin-settings.test.tsx`

可选但仅用于公开传播回归：

- `web/src/stores/use-config-store.test.ts`

### 不需要修改

- `repository/setting.go`
- `repository/db.go`
- `handler/settings.go`
- `handler/response.go`
- `router/router.go`
- `web/src/stores/use-config-store.ts`

原因：嵌套字段由现有 JSON marshal/unmarshal 和数组赋值自然透传。

### 应留给其他边界

- `web/src/components/image-settings-panel.tsx`
- `web/src/pages/canvas/**`
- `web/src/pages/image/**`
- `web/src/services/api/image.ts`
- 图片生成/画布/工作台对应测试

这些文件负责把 `"default" | "1k" | "2k" | "4k"` 映射为用户可见
宽高比和实际请求尺寸，不属于本配置实现边界。

共享文件提醒：

- `web/src/services/api/settings.ts` 是配置实现与画布消费的共享契约文件，
  建议由 `config-admin` 单点修改，其他 Subagent只消费新类型。
- 项目进度文档和 `CHANGELOG.md` 由最终整合角色统一处理，避免并行冲突。
- 新增嵌套 JSON 字段不属于“新增数据表”，无需更新数据库结构文档。

## 候选 TDD 公开 seams

用户尚未确认写测试，以下仅为候选，不写入测试源码。

### 后端首选：`service.normalizeSettings`

落点：`service/settings_test.go`

1. 四个有效值逐个保留：
   `"default"`、`"1k"`、`"2k"`、`"4k"`。
2. 缺失、空白、非法值统一为 `"default"`。
3. model/format/resolution 前后空白被 trim。
4. unknown image model 仍丢弃整项。
5. 重复 model 仍只保留第一项，并保留第一项归一后的 resolution。
6. marshal 后公开 JSON 明确包含 `"resolution":"default"`，防止零值泄漏。

这组 seam 最稳定，因为管理员读取、保存和公开读取都经过
`normalizeSettings`。

### 管理 UI：`AdminSettingsPage`

落点：`web/test/admin-settings.test.tsx`

沿用现有 happy-dom + mocked axios：

1. mock GET 返回一个图片模型和四种 resolution 中的一个，断言管理页显示
   分辨率控件与四个选项。
2. 断言服务端缺失/非法 resolution 后页面显示 `"default"`。
3. 点击“新增模型”后，新增项的 resolution 默认 `"default"`。
4. 修改 resolution、点击保存，捕获 `/api/admin/settings` POST body，
   断言值位于
   `public.modelChannel.imageRequestFormats[n].resolution`。
5. mock POST 返回归一化值，断言页面回填服务端结果。

不建议为了测试单独 export `normalizePublicSetting`；现有页面公开 seam 足够。

### 公开传播：`useConfigStore.loadPublicSettings`

落点：`web/src/stores/use-config-store.test.ts`

1. mock public settings 的 `imageRequestFormats` 带 resolution。
2. 断言 `publicSettings` 保留字段。
3. `allowCustomChannel === false` 时，断言
   `config.imageRequestFormats` 也保留字段。

### 可选 HTTP/持久化 seam

- `GET /api/settings` HTTP 集成测试可验证 envelope 和字段公开。
- repository round-trip 可验证 JSON upsert。

当前仓库没有 settings 专用 handler/repository 测试，HTTP 集成测试依赖真实
PostgreSQL，并会修改全局 settings 行。对一个嵌套 JSON 字段而言成本和并发风险较高，
不建议作为首轮 TDD 必选项。

## 已有测试与本次只读验证

已有直接相关测试：

- `service/settings_test.go`
  - `TestNormalizeSettingsKeepsExplicitImageRequestFormatsOnly`
  - `TestNormalizeSettingsKeepsDefaultImageRequestFormat`
  - `TestNormalizeSettingsKeepsCanvasImageRequestModes`
- `web/test/admin-settings.test.tsx`
  - 当前只有视频能力分辨率 UI 用例，可复用其 happy-dom/axios mock 结构。
- `web/src/stores/use-config-store.test.ts`
  - 覆盖公开配置加载和强制远程模型列表。
- `web/src/services/api/async-image-edit-form.test.mjs`
  - 覆盖按模型请求格式 fallback。
- `web/src/services/api/image.test.mjs`
  - 覆盖 `imageRequestFormats` 对 Canvas 图片请求的消费。

本次执行：

```text
go test ./service -run 'TestNormalizeSettings(KeepsExplicitImageRequestFormatsOnly|KeepsDefaultImageRequestFormat|KeepsCanvasImageRequestModes)$' -count=1
```

结果：通过。

```text
bun test test/admin-settings.test.tsx
```

结果：1 pass；只有现有 Ant Design `InputNumber` addon deprecation warnings。

```text
bun test src/stores/use-config-store.test.ts
```

结果：2 pass；只有测试环境不可用持久化 storage 的现有 warning。

未启动服务，未运行真实浏览器。

## 风险与不确定项

1. **单选/多选语义**：本文推荐单选 `resolution`。若产品要求同时允许多个 tier，
   必须在实现前改为数组契约并确认 `"default"` 共存规则。
2. **默认语义**：为保持现有功能，建议 missing/`"default"` 不过滤当前宽高比。
   若产品希望“默认”只显示某一组，消费侧必须给出明确映射和回退测试。
3. **节点描述不一致**：原始需求写“图片模型”却说创建“视频节点”；当前代码中图片模型设置
   由 `ImageSettingsPanel` 消费，视频分辨率另有 `480p/720p/1080p` 能力体系。
   后端不要据此复用视频字段。
4. **本地渠道同名模型**：公开配置按原始 model string 匹配。消费侧应只对远程/后台模型
   应用该限制，避免本地自定义渠道中同名模型被意外约束。
5. **管理行宽度**：现有 md 栅格正好占满 24 列；增加第四个选择器需要重新分配列宽，
   并检查中英文长文案。不要为此引入第二套配置列表。
6. **后端是最终权威**：前端 normalization 只改善表单体验；JSON 模式可提交任意值，
   因而服务端必须默认化非法 resolution。
7. **现有错误处理较宽松**：
   `handler.AdminSaveSettings` 忽略 JSON decode error，
   `repository.GetSettings` 忽略单行 unmarshal error。它们是既有风险，
   本任务不应顺手扩大范围修复。
8. **无 DB schema 迁移**：字段存于 public JSON。项目尚未上线，按仓库规则不写旧数据
   迁移或兼容清理逻辑。

## 未覆盖项

- 未实现任何源码或测试。
- 未调查/决定 Canvas 和生图工作台的具体宽高比映射。
- 未决定原始需求中的“视频节点”是否为笔误。
- 未运行 HTTP + PostgreSQL settings 集成测试。
- 未运行真实浏览器。
- 未读取 Ant Design 外部文档；现有项目用法足以完成只读调查，因此未调用 Context7。
