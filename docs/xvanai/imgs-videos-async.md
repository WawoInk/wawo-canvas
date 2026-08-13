## 异步图片生成

对于处理时间较长的图片生成任务，支持异步模式：提交后立即返回 `id`，通过轮询接口查询结果。

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
  "id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "object": "task",
  "status": "queued"
}
```

| 字段      | 类型   | 说明                  |
| --------- | ------ | --------------------- |
| `id` | string | 任务 ID，用于后续查询 |
| `object` | string | 对象类型，固定为 `task` |
| `status`  | string | 初始状态 `queued`     |

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
  "id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "object": "task",
  "status": "completed",
  "result": {
    "created": 1786343538,
    "data": [
      {
        "b64_json": "<base64>"
      }
    ],
    "background": "auto",
    "output_format": "png",
    "quality": "auto",
    "size": "1024x1024",
    "model": "gpt-image-2"
  }
}
```

**失败响应：**

```json
{
  "id": "task_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "object": "task",
  "status": "failed",
  "error": {
    "code": "FAILURE",
    "message": "错误描述信息"
  }
}
```

**任务状态说明：**

| 状态         | 说明                          |
| ------------ | ----------------------------- |
| `queued`     | 已提交，等待处理              |
| `processing` | 正在处理中                    |
| `completed`  | 成功，结果在 `result.data` 字段 |
| `failed`     | 失败，错误信息在 `error` 字段 |
| `cancelled`  | 已取消                        |

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

1. **提交**：`POST /v1/async/images/generations` → 获取 `id`
2. **轮询**：前 3 次间隔 1 秒，后续间隔 2-3 秒
3. **结束**：`status` 为 `completed` / `failed` / `cancelled` 时停止
4. **超时**：建议 120 秒超时，超时后调用 `cancel`
