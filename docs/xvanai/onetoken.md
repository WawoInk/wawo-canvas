# 图片生成 — gpt-image-2

> 使用 OpenAI 兼容格式的 `gpt-image-*` 系列模型生成图片。

---

## 端点

```
POST /v1/images/generations
```

## 认证

```
Authorization: Bearer sk-xxxxx
```

## 模型名

`gpt-image-2` 是平台提供的图片生成模型，使用 `gpt-image-*` 命名系列，例如：

| 模型 | 说明 |
|------|------|
| `gpt-image-1` | GPT-4o 原生图片生成 |
| `gpt-image-2` | 新一代图片生成模型 |

具体可用的模型名请在管理后台渠道配置中查看。

## 请求示例

### 文生图

```bash
curl https://xvan.ai/v1/images/generations \
  -H "Authorization: Bearer sk-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只白色的柯基犬在开满野花的草地上奔跑，阳光明媚",
    "n": 2,
    "size": "1024x1024",
    "quality": "auto"
  }'
```

### 带扩展参数

```bash
curl https://xvan.ai/v1/images/generations \
  -H "Authorization: Bearer sk-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "海边的日落，暖色调，摄影风格",
    "n": 1,
    "size": "1792x1024",
    "quality": "auto"
    "style": "自然摄影"
  }'
```

## 请求参数说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | string | **是** | - | 模型名（如 `gpt-image-2`） |
| `prompt` | string | **是** | - | 图片描述文本 |
| `n` | uint | 否 | `1` | 生成数量 |
| `size` | string | 否 | `1024x1024` | 图片尺寸 |
| `quality` | string | 否 | `auto` | 推荐设为 `auto` |
| `style` | string | 否 | - | 图片风格描述 |

## 响应格式

```json
{
  "data": [
    {
      "url": "https://storage.example.com/images/xxx.png",
      "b64_json": null,
      "revised_prompt": "优化后的提示词"
    }
  ],
  "created": 1718467200
}
```

## 图片编辑

```
POST /v1/images/edits
```

支持基于已有图片进行编辑修改，使用与其他图片生成相同的 `gpt-image-*` 模型。可通过 JSON 或 multipart/form-data 格式提交。

### JSON 格式

```json
{
  "model": "gpt-image-2",
  "prompt": "将背景替换为星空",
  "image": "https://example.com/original.png",
  "size": "1024x1024",
  "n": 1
}
```

```bash
curl https://xvan.ai/v1/images/edits \
  -H "Authorization: Bearer sk-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "将背景替换为星空",
    "image": "https://example.com/original.png",
    "size": "1024x1024",
    "n": 1
  }'
```

### multipart 格式

```bash
curl https://xvan.ai/v1/images/edits \
  -H "Authorization: Bearer sk-xxxxx" \
  -F "image=@original.png" \
  -F "prompt=将背景替换为星空" \
  -F "model=gpt-image-2" \
  -F "n=1" \
  -F "size=1024x1024"
```

### 编辑参数说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | **是** | 模型名（如 `gpt-image-2`） |
| `prompt` | string | **是** | 编辑描述 |
| `image` | string | **是** | 源图片 URL（JSON）或本地文件（multipart） |
| `n` | uint | 否 | 生成数量 |
| `size` | string | 否 | 图片尺寸 |

## 注意事项

- `quality` 参数推荐设为 `"auto"`，由系统自动选择最佳质量
- 部分模型支持 SSE 流式输出，可通过添加 `"stream": true` 启用
- 图片编辑的端点与文生图不同：`/v1/images/edits`
- JSON 格式的 `image` 字段传入图片 URL，multipart 格式则上传本地图片文件

---

## 异步图片生成

对于处理时间较长的图片生成任务，支持异步模式：提交后立即返回 `task_id`，通过轮询接口查询结果。

---

### 异步提交

```
POST /v1/async/images/generations
```

请求参数与同步接口相同。

```bash
curl https://xvan.ai/v1/async/images/generations \
  -H "Authorization: Bearer sk-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "a cute cat sitting on a couch, digital art",
    "n": 1,
    "size": "1024x1024"
  }'
```

**响应：**

```json
{
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "queued"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 任务 ID，用于后续查询 |
| `status` | string | 初始状态 `queued` |

---

### 异步编辑提交

```
POST /v1/async/images/edits
```

基于已有图片进行异步编辑修改，请求体使用 JSON 格式（不支持 multipart）。

```bash
curl https://xvan.ai/v1/async/images/edits \
  -H "Authorization: Bearer sk-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "将背景替换为星空",
    "image": "https://example.com/original.png",
    "size": "1024x1024",
    "n": 1
  }'
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | **是** | 模型名（如 `gpt-image-2`） |
| `prompt` | string | **是** | 编辑描述 |
| `image` | string | **是** | 源图片 URL |
| `n` | uint | 否 | 生成数量 |
| `size` | string | 否 | 图片尺寸 |

> **注意：** 异步编辑仅支持 JSON 格式，`image` 字段传入图片 URL。不支持 multipart/form-data 格式。

**响应：**

```json
{
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "queued"
}
```

查询结果时 `type` 字段为 `"image_edit"`，其余字段与生成任务相同。

---

### 查询任务状态

```
GET /v1/tasks/{task_id}
```

```bash
curl https://xvan.ai/v1/tasks/task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  -H "Authorization: Bearer sk-xxxxx"
```

**成功响应：**

```json
{
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "succeeded",
  "type": "image_generation",
  "model": "gpt-image-2",
  "created_at": 1782354218,
  "completed_at": 1782354300,
  "data": {
    "images": [
      {
        "url": "https://storage.example.com/images/xxx.png",
        "b64_json": null,
        "revised_prompt": "优化后的提示词"
      }
    ]
  }
}
```

**失败响应：**

```json
{
  "task_id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "failed",
  "type": "image_generation",
  "model": "gpt-image-2",
  "created_at": 1782354218,
  "completed_at": 1782354218,
  "error": {
    "code": "FAILURE",
    "message": "错误描述信息"
  }
}
```

**任务状态说明：**

| 状态 | 说明 |
|------|------|
| `queued` | 已提交，等待处理 |
| `processing` | 正在处理中 |
| `succeeded` | 成功，结果在 `data` 字段 |
| `failed` | 失败，错误信息在 `error` 字段 |
| `cancelled` | 已取消 |

---

### 取消任务

```
POST /v1/tasks/{task_id}/cancel
```

```bash
curl -X POST https://xvan.ai/v1/tasks/task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/cancel \
  -H "Authorization: Bearer sk-xxxxx"
```

**响应：**

```json
{
  "code": "success",
  "data": {
    "task_id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "status": "cancelled",
    "type": "image_generation",
    "model": "gpt-image-2",
    "created_at": 1782354218,
    "completed_at": 1782354250
  }
}
```

---

### 轮询策略建议

1. **提交**：`POST /v1/async/images/generations` 或 `POST /v1/async/images/edits` → 获取 `task_id`
2. **轮询**：前 3 次间隔 1 秒，后续间隔 2-3 秒
3. **结束**：`status` 为 `succeeded` / `failed` / `cancelled` 时停止
4. **超时**：建议 120 秒超时，超时后调用 `cancel`
