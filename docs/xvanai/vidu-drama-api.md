# Video Generation — Vidu Drama (Short Drama)

> Vidu overseas short drama final-product generation (api.vidu.com). Create complete short drama videos from a script + character/scene/prop assets.

---

## Endpoints

Use the standard OpenAI-compatible API:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/contents/generations/tasks` | Create a short drama generation task |
| GET | `/v1/contents/generations/tasks/{task_id}` | Query task status and result |

Or use the native Vidu-Oversea API directly:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/vidu-oversea/ent/v1/short-play/tasks` | Submit short drama task |
| GET | `/vidu-oversea/ent/v1/short-play/tasks/{id}` | Query short drama task |

---

## Models

| Model Name | Description |
|------------|-------------|
| `viduq3-drama-oversea` | Short drama final-product generation. Supports auto duration (0) or fixed 8–12 seconds. Recommended 3–10 assets, up to 14. |

---

## Request Parameters

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | string | **Yes** | — | `viduq3-drama-oversea` |
| `action` | string | No | — | Set to `"short-play"` to force drama routing. Auto-detected from model name containing `drama` |
| `content` | array | **Yes** | — | Content array. Must contain at least one `{"type": "text", "text": "..."}` item — the script content (≥20 characters). Chinese ≤2000 characters, English ≤5000 |
| `script_name` | string | **Yes** | — | Episode name, ≤20 characters |
| `assets` | array[object] | **Yes** | — | Asset list. Each item must have `id`, `type`, `name`, `image_uri`. Up to 14 items, recommended 3–10 |
| `duration` | int | No | `0` | `0` = auto-plan (model decides), or an integer between 8–12 seconds |
| `ratio` | string | No | `9:16` | `16:9` or `9:16` |
| `resolution` | string | No | `1080p` | Output resolution |
| `placement` | string | No | `upload` | `upload` (fastest) / `panorama` / `step` |
| `quality` | string | No | `high` | `standard` or `high` (recommended) |
| `style` | string | No | Realistic Portrait | Video style, ≤30 characters, no punctuation |
| `callback_url` | string | No | — | Callback URL for status change notifications. Vidu POSTs task status updates to this address |
| `upload_image_url` | string | No | — | User-uploaded stationing reference image. Required for `panorama`/`step` placement modes |

### Asset Object Fields

Each item in `assets[]`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **Yes** | Identifier, e.g. `"01"`, `"02"` |
| `type` | string | **Yes** | `character`, `scene`, or `tool` |
| `name` | string | **Yes** | Asset name, ≤30 characters |
| `image_uri` | string | **Yes** | Reference image. Supports HTTPS URL or `data:image/png;base64,...`. png / jpeg / jpg / webp. ≥128×128 pixels, preferably ≤2K. Max body size 20MB |
| `description` | string | No | Asset description (identity, appearance, age, etc.) |

---

## Examples

### Minimal

```bash
curl -X POST https://xvan.ai/v1/contents/generations/tasks \
  -H "Authorization: Bearer sk-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "viduq3-drama-oversea",
    "content": [
      {
        "type": "text",
        "text": "人物：林尘、未婚妻。分镜1-1：林尘在典当行擦拭柜台，神情淡然。未婚妻推门进入，将戒指拍在柜台上提出退婚。"
      }
    ],
    "script_name": "典当行退婚",
    "assets": [
      {"id": "1", "type": "character", "name": "林尘", "image_uri": "https://example.com/linchen.png"},
      {"id": "2", "type": "character", "name": "未婚妻", "image_uri": "https://example.com/fiancee.png"},
      {"id": "3", "type": "scene", "name": "典当行", "image_uri": "https://example.com/pawnshop.png"}
    ]
  }'
```

### Full

```bash
curl -X POST https://xvan.ai/v1/contents/generations/tasks \
  -H "Authorization: Bearer sk-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "viduq3-drama-oversea",
    "action": "short-play",
    "script_name": "典当行退婚",
    "content": [
      {
        "type": "text",
        "text": "人物：林尘、未婚妻、富二代\n【画面风格：现代都市写实，暖黄室内光，典当行内部陈旧拥挤。】\n\n分镜1-1：\n@林尘在擦拭柜台，神情淡然。（3秒 中景 平拍固定 现代都市破旧典当行内部光线昏暗，货架拥挤，@林尘站在柜台后用抹布擦拭玻璃台面）\n@林尘：（平静低语）三年了，也该结束了。\n\n分镜1-2：\n@未婚妻满脸嫌弃走进典当行。（2秒 中景 平拍固定，典当行大门被推开，@未婚妻打扮艳丽走进来，身后跟着@富二代）\n@未婚妻：（嫌恶语气）这破地方，多待一秒都嫌脏！"
      }
    ],
    "assets": [
      {"id": "1", "type": "character", "name": "林尘", "image_uri": "https://example.com/linchen.png", "description": "男主角，穿白色衬衫，神情沉稳"},
      {"id": "2", "type": "character", "name": "未婚妻", "image_uri": "https://example.com/fiancee.png", "description": "年轻女性，穿着艳丽，表情傲慢"},
      {"id": "3", "type": "character", "name": "富二代", "image_uri": "https://example.com/rich.png", "description": "年轻男性，穿红色西装，表情嚣张"},
      {"id": "4", "type": "scene", "name": "典当行内", "image_uri": "https://example.com/pawnshop.png", "description": "破旧拥挤的典当行内部"},
      {"id": "5", "type": "tool", "name": "订婚戒指", "image_uri": "https://example.com/ring.png", "description": "一枚普通的订婚戒指"},
      {"id": "6", "type": "tool", "name": "破旧的陶瓷碗", "image_uri": "https://example.com/bowl.png", "description": "表面有裂纹的老旧陶瓷碗"}
    ],
    "duration": 0,
    "ratio": "9:16",
    "resolution": "1080p",
    "placement": "panorama",
    "quality": "high",
    "style": "真人写实"
  }'
```

### Minimal (Simplest)

```bash
curl -X POST https://xvan.ai/v1/contents/generations/tasks \
  -H "Authorization: Bearer sk-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "viduq3-drama-oversea",
    "content": [
      {
        "type": "text",
        "text": "人物：林尘。分镜1-1：林尘在典当行擦拭柜台，神情淡然。"
      }
    ],
    "script_name": "测试短剧",
    "assets": [
      {"id": "1", "type": "character", "name": "林尘", "image_uri": "https://example.com/linchen.png"},
      {"id": "2", "type": "scene", "name": "典当行", "image_uri": "https://example.com/pawnshop.png"}
    ]
  }'
```

---

## Query Task Progress

**Request:**

```bash
curl -X GET https://xvan.ai/v1/contents/generations/tasks/{task_id} \
  -H "Authorization: Bearer sk-xxxxx"
```

**Response (processing):**

```json
{
  "id": "task_xxxxx",
  "object": "video",
  "status": "running",
  "model": "viduq3-drama-oversea",
  "created_at": 1784014559,
  "updated_at": 1784014559
}
```

**Response (completed):**

```json
{
  "id": "task_xxxxx",
  "object": "video",
  "status": "succeeded",
  "model": "viduq3-drama-oversea",
  "content": {
    "video_url": "https://signed-url.example.com/final_video.mp4"
  },
  "created_at": 1784014559,
  "updated_at": 1784014800
}
```

**Response (failed):**

```json
{
  "id": "task_xxxxx",
  "object": "video",
  "status": "failed",
  "model": "viduq3-drama-oversea",
  "error": {
    "code": "E001",
    "message": "content too long"
  },
  "created_at": 1784014559,
  "updated_at": 1784014600
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Platform task ID |
| `object` | string | `"video"` |
| `status` | string | `queued` → `running` → `succeeded` / `failed` / `cancelled` |
| `model` | string | Model name used for this task |
| `content.video_url` | string | Signed download link (available on success) |
| `error.code` | string | Error code (on failure) |
| `error.message` | string | Error message (on failure) |
| `metadata.url` | string | Alias for `content.video_url` (backward-compatible) |
| `created_at` | int | Creation timestamp (Unix seconds) |
| `updated_at` | int | Last update timestamp (Unix seconds) |

### Upstream Response Fields (Raw)

Query response from Vidu upstream, stored internally as `task.data`:

| Field | Type | Description |
|-------|------|-------------|
| `task.meta.id` | string | Upstream task ID |
| `task.meta.state` | string | `created` / `queueing` / `processing` / `success` / `failed` |
| `task.meta.err_code` | string | Error code (empty on success) |
| `task.meta.err_msg` | string | Error message (empty on success) |
| `task.derived_data.signed_final_video_url` | string | Signed download link for the final video |
| `task.derived_data.signed_final_watermarked_video_url` | string | Signed download link for the watermarked video |
| `task.derived_data.deducted_credits` | int | Credits consumed for this task |
| `task.derived_data.shots` | array[object] | Shot list: per-shot video URLs, prompts, duration, and status |
| `credits` | int | Credits consumed (top-level, fallback for billing) |

---

## Billing

Short drama uses **token pricing** with completion-time credits settlement:

- At submit time, the task precharges based on the token pricing rule (typically zero for async video tasks).
- When the task reaches a terminal state (`success`/`failed`), the upstream `deducted_credits` is read from the poll result and used to adjust the final `balance_units` — overcharge is refunded, undercharge is billed.
- The model should be bound to a channel of type Vidu-Oversea (62) and configured with `BillingType = token` in PricingRule.

---

## Notes

- The model name must contain `drama` for automatic short-play action detection. Set `"action": "short-play"` explicitly if your configured upstream model name does not include `drama`
- Images in `assets[].image_uri` can be **HTTPS URLs** or **base64 data URIs** (e.g. `data:image/png;base64,...`). The request body must not exceed 20MB
- `duration: 0` enables auto-planning — the model decides the appropriate length. For fixed-length output, pass 8–12
- `content[].text` must be ≥20 characters. Chinese scripts support up to 2000 characters; English up to 5000
- Poll `/v1/contents/generations/tasks/{task_id}` periodically for status updates. The status transitions: `queued` → `running` → `succeeded`/`failed`
- On success, the video is available via the signed URL in `content.video_url` or `metadata.url`. The signed URL is time-limited — download promptly
- Callback: set `callback_url` to receive a POST with the task status object when state changes (retries up to 3 times on failure)
- Video download proxy: use `GET /v1/contents/generations/tasks/{task_id}/content` as an alternative download path
