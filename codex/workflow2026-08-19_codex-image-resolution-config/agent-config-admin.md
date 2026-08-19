# config-admin 实现记录

## 状态

- 任务：`config-admin`
- 波次/并行组：`wave-2` / `impl-parallel`
- 状态：`in_progress`
- 分支：`codex/image-resolution-config`
- 写入边界检查：开始时目标业务文件无其他改动；保留 workflow 目录中的并行产物。

## TDD 切片

### 1. 后端配置归一化与公开输出

- Seam：`service.normalizeSettings` 返回的公开 `imageRequestFormats`。
- RED：新增 `TestNormalizeSettingsNormalizesImageRequestResolutions`，运行
  `go test ./service -run '^TestNormalizeSettingsNormalizesImageRequestResolutions$' -count=1`。
- RED 结果：失败；marshal 结果没有 `resolution` 字段。
- 最小实现：在 `ImageRequestFormatSetting` 增加 `resolution`；trim 后仅保留
  `1k | 2k | 4k`，其他值（含缺失、空白、非法和显式 `default`）统一为 `default`。
- 取舍：复用现有整块 JSON 持久化和共同归一化入口，不新增枚举层、接口、表或迁移。

## 修改文件

- `model/setting.go`
- `service/settings.go`
- `service/settings_test.go`
- `codex/workflow2026-08-19_codex-image-resolution-config/agent-config-admin.md`

## 假设与风险

- `default` 表示保持消费侧现有尺寸集合；tier 到比例的映射不属于本任务。
- 当前无阻塞；后续仍需完成管理端和公开配置传播 seam。
