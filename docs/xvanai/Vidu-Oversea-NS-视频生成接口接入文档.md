# Vidu-Oversea NS 视频生成接口接入文档

> 文档版本：2026-07-20  
> 适用平台：XVAN AI API Gateway  
> 上游服务：Vidu Oversea（`https://api.vidu.com`）

## 1. 接口概述

平台通过统一的异步视频生成接口接入 Vidu-Oversea NS 模型。调用流程为：

1. 提交视频生成任务；
2. 使用返回的任务 ID 查询任务状态；
3. 任务成功后，从查询响应读取视频 URL，或使用内容接口获取视频。

### 统一接口

| 操作 | 方法 | 路径 |
|---|---|---|
| 创建任务 | `POST` | `/v1/contents/generations/tasks` |
| 查询任务 | `GET` | `/v1/contents/generations/tasks/{task_id}` |
| 获取视频内容 | `GET` | `/v1/contents/generations/tasks/{task_id}/content` |

## 2. 鉴权

请求使用 Bearer Token：

```http
Authorization: Bearer sk-xxxxx
Content-Type: application/json
```

请勿在客户端代码、日志或代码仓库中保存真实 API Key。

## 3. 模型与上游映射

### 3.1 推荐兼容模型

以下模型名用于平台接入，由网关自动转换为最新的 Vidu NS 上游接口。

| 平台模型 | 场景 | 实际上游接口 | 实际上游参数 |
|---|---|---|---|
| `vidu_hq_t2v-oversea` | 文生视频 | `/ent/v2/text2video` | `model: viduq3-ns` |
| `vidu_hq_i2v-oversea` | 首帧图生视频 | `/ent/v2/template` | `template: vidu_i2v_new_ns` |
| `vidu_hq_r2v-oversea` | 参考图生成、视频编辑 | `/ent/v2/template` | `template: vidu_r2v_new_ns` |
| `vidu_hq_headtail-oversea` | 首尾帧生视频 | `/ent/v2/template` | `template: vidu_r2v_new_ns` |

调用方只需传平台模型名，不需要传上游 `model` 或 `template`。网关会自动完成映射。

### 3.2 直接 NS 模型

以下直接模型已被适配器支持。模型能否调用仍取决于平台是否已完成模型创建、计价和渠道绑定。

| 平台模型 | 支持的上游接口 | 上游模型/模板 |
|---|---|---|
| `viduq3-ns-oversea` | `text2video`、`img2video`、`reference2video` | `viduq3-ns` |
| `viduq3-ns-flash-oversea` | `img2video`、`reference2video` | `viduq3-ns-flash` |
| `viduq2-ns-oversea` | `img2video` | `viduq2-ns` |
| `vidu_i2v_new_ns-oversea` | `template` | `vidu_i2v_new_ns` |
| `vidu_r2v_new_ns-oversea` | `template` | `vidu_r2v_new_ns` |

## 4. 创建任务

```http
POST /v1/contents/generations/tasks
```

### 4.1 通用请求参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `model` | string | 是 | 平台模型名 |
| `prompt` | string | 视模型而定 | 视频生成提示词 |
| `images` | string[] | 视模型而定 | 图片 URL 或带 MIME 前缀的 Base64 Data URI |
| `duration` | int | 否 | 生成视频时长，单位秒 |
| `resolution` | string | 否 | `720p` 或 `1080p` |
| `aspect_ratio` | string | 否 | `16:9`、`9:16`、`1:1`、`4:3`、`3:4` |
| `metadata` | object | 否 | Vidu 特有参数 |
| `metadata.video_urls` | string[] | 否 | R2V 参考视频，最多 1 个 |
| `metadata.extra_params` | object | 否 | NS 模板扩展参数 |
| `metadata.extra_params.negative_prompt` | string | 否 | 负向提示词，最长 500 字符 |
| `metadata.action` | string | 否 | 直接 NS 模型可显式指定动作，例如 `reference2video`；兼容模型无需指定 |
| `metadata.callback_url` | string | 否 | 上游任务状态回调地址 |

> `video_urls`、`extra_params`、`action` 等供应商特有参数应放在 `metadata` 中。网关会将其展开为 Vidu 上游请求字段。

## 5. 各模型接入示例

以下示例中的 `BASE_URL` 为平台 API 地址，例如 `https://xvan.ai`。

### 5.1 文生视频

平台模型 `vidu_hq_t2v-oversea` 会自动映射为上游 `viduq3-ns`。

```bash
curl -X POST "$BASE_URL/v1/contents/generations/tasks" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "vidu_hq_t2v-oversea",
    "prompt": "夜晚的星空草原，微风吹动草地，电影感镜头",
    "duration": 5,
    "resolution": "720p",
    "aspect_ratio": "16:9"
  }'
```

约束：

- `prompt` 必填；
- 不应传入图片；
- NS 文生视频时长通常为 2–15 秒；
- 上游 NS 文生视频提示词最长 1500 字符。

### 5.2 首帧图生视频

```bash
curl -X POST "$BASE_URL/v1/contents/generations/tasks" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "vidu_hq_i2v-oversea",
    "prompt": "人物缓慢转身看向镜头，镜头自然推进",
    "images": [
      "https://example.com/first-frame.jpg"
    ],
    "duration": 5,
    "resolution": "1080p",
    "metadata": {
      "extra_params": {
        "negative_prompt": "低质量，模糊，畸形"
      }
    }
  }'
```

约束：

- 必须且只能传 1 张图片；
- 实际上游模板为 `vidu_i2v_new_ns`；
- 时长为 2–15 秒；
- 分辨率支持 `720p`、`1080p`。

### 5.3 参考图生成视频（R2V）

以下是已通过真实任务验证的请求形式。

```bash
curl -X POST "$BASE_URL/v1/contents/generations/tasks" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "vidu_hq_r2v-oversea",
    "prompt": "将背景替换成夜晚星空草原",
    "images": [
      "https://img0.baidu.com/it/u=2748646213,1457922654&fm=253&app=138&f=JPEG?w=800&h=1200"
    ],
    "duration": 5,
    "resolution": "720p",
    "aspect_ratio": "16:9",
    "metadata": {
      "extra_params": {
        "negative_prompt": "低质量，模糊，畸形"
      }
    }
  }'
```

约束：

- 至少传 1 张图片；
- 图片与参考视频合计不能超过 5 个；
- 最多传 1 个参考视频；
- 未传参考视频时，输出时长为 2–15 秒；
- 实际上游模板为 `vidu_r2v_new_ns`。

### 5.4 参考视频编辑

```bash
curl -X POST "$BASE_URL/v1/contents/generations/tasks" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "vidu_hq_r2v-oversea",
    "prompt": "使用图片中的人物，按照参考视频的动作生成视频",
    "images": [
      "https://example.com/character.jpg"
    ],
    "duration": 5,
    "resolution": "720p",
    "aspect_ratio": "16:9",
    "metadata": {
      "video_urls": [
        "https://example.com/reference.mp4"
      ],
      "extra_params": {
        "negative_prompt": "低质量，模糊，动作异常"
      }
    }
  }'
```

约束：

- 必须至少传 1 张图片，不支持仅传视频；
- `metadata.video_urls` 最多 1 个；
- 图片与视频总数不超过 5；
- 有参考视频时，生成时长为 2–10 秒；
- 参考视频支持 MP4、MOV；上游限制为 1–30 秒、文件不超过 100 MB。

### 5.5 首尾帧生视频

```bash
curl -X POST "$BASE_URL/v1/contents/generations/tasks" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "vidu_hq_headtail-oversea",
    "prompt": "从白天平滑过渡到夜晚，灯光逐渐亮起",
    "images": [
      "https://example.com/start-frame.jpg",
      "https://example.com/end-frame.jpg"
    ],
    "duration": 8,
    "resolution": "1080p",
    "aspect_ratio": "16:9",
    "metadata": {
      "extra_params": {
        "negative_prompt": "低质量，画面闪烁"
      }
    }
  }'
```

约束：

- 必须恰好传 2 张图片；
- 第 1 张为首帧，第 2 张为尾帧；
- 实际上游模板为 `vidu_r2v_new_ns`。

### 5.6 直接 NS 参考生视频

直接模型使用 `reference2video` 时，应显式指定 action。

```bash
curl -X POST "$BASE_URL/v1/contents/generations/tasks" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "viduq3-ns-flash-oversea",
    "prompt": "人物在霓虹城市街道中行走",
    "images": [
      "https://example.com/character.jpg",
      "https://example.com/scene.jpg"
    ],
    "duration": 5,
    "resolution": "720p",
    "aspect_ratio": "3:4",
    "metadata": {
      "action": "reference2video",
      "audio": false
    }
  }'
```

约束：

- 图片数量为 1–5 张；
- `prompt` 必填；
- `audio: false` 仅上游 `viduq3-ns-flash` 支持；
- 如果不显式传 `metadata.action: reference2video`，多图请求可能按图片数量被推导为其他动作。

## 6. 创建任务响应

创建成功时，平台返回 HTTP `200`：

```json
{
  "id": "task_xxxxxxxxxxxxxxxxxxxxxxxx",
  "model": "vidu_hq_r2v-oversea",
  "status": "queued"
}
```

不同兼容版本中也可能出现 `task_id`。调用方应优先读取 `id`，并可兼容读取 `task_id`。

## 7. 查询任务

```bash
curl -X GET "$BASE_URL/v1/contents/generations/tasks/task_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Authorization: Bearer $API_KEY"
```

### 7.1 平台任务状态

| 状态 | 说明 |
|---|---|
| `queued` | 任务已创建或正在排队 |
| `running` | 任务正在生成 |
| `succeeded` | 任务成功 |
| `failed` | 任务失败 |
| `cancelled` | 任务已取消 |
| `unknown` | 无法识别的任务状态 |

### 7.2 成功响应

```json
{
  "id": "task_xxxxxxxxxxxxxxxxxxxxxxxx",
  "model": "vidu_hq_r2v-oversea",
  "status": "succeeded",
  "content": {
    "video_url": "https://video.cf.vidu.com/.../video.mp4?..."
  },
  "created_at": 1784519891,
  "updated_at": 1784519938
}
```

`content.video_url` 通常是有有效期的签名 URL。业务系统应及时下载或转存，不应长期保存后直接使用。

## 8. 获取视频内容

任务成功后可请求：

```bash
curl -L "$BASE_URL/v1/contents/generations/tasks/task_xxxxxxxxxxxxxxxxxxxxxxxx/content" \
  -H "Authorization: Bearer $API_KEY" \
  -o result.mp4
```

## 9. 错误响应

### 9.1 网关错误格式

```json
{
  "error": {
    "code": "model_not_found",
    "message": "model xxx not found",
    "type": "xvanai_error"
  }
}
```

或任务参数校验错误：

```json
{
  "code": "invalid_vidu_oversea_request",
  "message": "vidu_r2v_new_ns supports up to 5 image and video references",
  "data": null
}
```

### 9.2 常见错误

| HTTP 状态 | 错误码/场景 | 处理建议 |
|---|---|---|
| `400` | `invalid_vidu_oversea_request` | 检查图片数量、视频数量和模型要求 |
| `401` | 鉴权失败 | 检查 Bearer Token |
| `404` | `model_not_found` | 确认平台已配置该模型；推荐使用已配置的兼容模型名 |
| `429` | 限流或余额不足 | 降低请求频率并检查账户余额 |
| `5xx` | 网关或上游服务异常 | 记录 request ID，稍后重试 |

任务进入 `failed` 状态时，查询响应会携带错误信息。业务方应停止轮询并记录完整响应。

## 10. 图片与视频素材要求

### 图片

- 支持 URL 或 Base64 Data URI；
- 格式：PNG、JPEG、JPG、WebP；
- 模板图片单文件不超过 50 MB；
- 图片宽高比应在约 `1:4` 至 `4:1` 范围内；
- Base64 必须包含 MIME 前缀，例如：

```text
data:image/png;base64,<base64_data>
```

### 参考视频

- 仅 `vidu_r2v_new_ns` 场景支持；
- 格式：MP4、MOV；
- 上游素材时长：1–30 秒；
- 宽高分别为 240–4096 像素；
- 宽高比为 `1:8` 至 `8:1`；
- 文件不超过 100 MB。

### 请求体

- NS Template 请求体不超过 20 MB；
- 使用 Base64 时，应特别关注编码后体积增长。

## 11. 轮询建议

- 建议每 3–5 秒查询一次；
- 建议设置 10–15 分钟总超时；
- `queued`、`running` 状态继续轮询；
- `succeeded`、`failed`、`cancelled` 为终态；
- 不应高频轮询，以免触发接口限流。

Python 伪代码：

```python
while time.monotonic() < deadline:
    task = get_task(task_id)
    if task["status"] == "succeeded":
        return task["content"]["video_url"]
    if task["status"] in {"failed", "cancelled"}:
        raise RuntimeError(task)
    time.sleep(5)
```

## 12. 已验证场景

以下请求已在本地网关环境通过真实上游生成测试：

- 平台模型：`vidu_hq_r2v-oversea`；
- 实际上游模板：`vidu_r2v_new_ns`；
- 输入：1 张公网图片；
- 提示词：`将背景替换成夜晚星空草原`；
- 输出：5 秒、720p、16:9；
- 两次测试均成功，完成耗时分别约 49 秒和 39 秒。

## 13. 安全与生产建议

- API Key 仅通过环境变量或密钥管理服务注入；
- 不要把 Bearer Token 写入日志；
- 记录平台任务 ID 和响应中的 request ID，便于排查；
- 签名视频 URL 可能过期，任务成功后应及时转存；
- 自动重试仅适用于网络异常、限流和部分 5xx 错误；参数错误不应自动重试；
- 相同参数重复提交会创建新的生成任务并产生新的计费。
