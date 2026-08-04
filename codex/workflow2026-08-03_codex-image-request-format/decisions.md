# 设计决策

- 复用现有 `AdminSettings` 完整保存接口与公开配置表单，不新增接口、依赖或独立状态层。
- 仅保存管理员显式添加的模型协议映射；空列表表示全部模型继续使用后端默认协议。
- 协议枚举仅包含 `application/json` 与 `multipart/form-data`。
- 公开字段使用 `modelChannel.imageRequestFormats: Array<{ model, format }>`，管理端 DTO 单独声明 `AdminImageRequestFormat`。
- 模型选项直接读取公开配置中的 `imageModels`，不重复维护模型来源。
- 新增行默认选择首个尚未配置的图片模型和 `application/json`；已配置模型在其他行中禁用，删除行即撤销显式协议。
- 公开配置归一化为缺失字段补 `[]`，并过滤模型或协议不完整的行，避免保存空配置。
- 未修改 `web/src/services/api/settings.ts`，该公开读取 DTO 由主线负责的配置 Store/请求构建改动统一协调。

## 主线补充

- 公开读取 DTO、Zustand `AiConfig` 和图片请求层统一消费 `imageRequestFormats`。
- 该公开配置只覆盖平台远程渠道；本地自定义渠道继续使用原有请求行为。
- 未配置模型按操作保留默认值：图片生成使用 JSON，图片编辑使用 multipart。
- JSON 图片编辑将浏览器图片转换为 data URL 字符串；单图发送字符串，多图发送字符串数组。

## URL 结果修复

- 不为 `gpt-image-2-open-1-edit` 增加专属响应分支；异步生成和编辑已经使用同一 `data.images[].url` 解析逻辑。
- 在共享后端代理下载入口处理瞬时网络故障，避免把供应商 URL 无 CORS 的问题重新交给浏览器。
- 重试范围限定为传输错误、读取中断、408、429 和 5xx；其他 4xx 立即返回，最多 3 次并受原有 5 分钟总超时约束。
