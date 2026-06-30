# 视频生成标准化接口文档

## 概述

本文档描述通过标准化入口 `/v1/contents/generations/tasks` 调用 Vidu、AIDrama (Seedance)、Kuaizi (Seedance) 视频生成服务的 API 规范。

该入口通过统一的中间件链路（TaskInputConvert → Distribute → RelayTask）自动完成渠道分发、请求转换、计费结算和任务持久化，外部调用者无需关心后端厂商差异。

---

## 基础信息

### 基础 URL

```
https://<gateway-host>
```

### 认证方式

所有接口使用 **API Key (Bearer Token)** 认证：

```
Authorization: Bearer <api_key>
```

---

## 路由总览

| 路径 | 方法 | 用途 |
|------|------|------|
| `/v1/contents/generations/tasks` | POST | 创建视频生成任务 |
| `/v1/contents/generations/tasks/:task_id` | GET | 查询任务状态 |
| `/v1/contents/generations/tasks/:task_id` | DELETE | 取消任务 |
| `/v1/contents/generations/tasks/:task_id/remix` | POST | 基于原任务二次创作 |

---

## 一、创建视频生成任务

### POST /v1/contents/generations/tasks

该接口兼容**两种请求体格式**，系统自动识别并转换。

#### 格式 A：扁平格式（推荐，通用）

```json
{
  "model": "<模型名称>",
  "prompt": "<提示词>",
  "image": "<单张图片 URL>",
  "images": ["<图片 URL 数组>"],
  "size": "<分辨率/比例>",
  "duration": 5,
  "seconds": "5",
  "input_reference": "<参考图片 URL>",
  "metadata": {
    "<厂商自定义参数>": "<值>"
  }
}
```

**通用参数说明：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名称（见各厂商模型列表） |
| `prompt` | string | 是（文生视频） | 文本提示词 |
| `image` | string | 否 | 单张图片 URL（图生视频时使用） |
| `images` | string[] | 否 | 多张图片 URL 列表（首尾帧、参考图生视频时使用） |
| `input_reference` | string | 否 | 参考图片（同 `image`，兼容字段） |
| `size` | string | 否 | 分辨率或比例，如 `720p`、`1080p`、`1920x1080`、`9:16` |
| `duration` | int | 否 | 视频时长（秒），范围 4-15 |
| `seconds` | string | 否 | 时长字符串形式（优先级低于 `duration`） |
| `mode` | string | 否 | 模式，如 `fast`、`pro`（Kuaizi） |
| `metadata` | object | 否 | 厂商自定义参数（核心扩展点） |

#### 格式 B：Ark content[] 格式（Seedance 兼容）

此格式在请求体中包含 `content` 数组字段。`TaskInputConvert` 中间件自动将其转换为内部扁平格式。原始 content 保留在 `metadata.content` 中供适配器使用。

```json
{
  "model": "<模型名称>",
  "content": [
    {
      "type": "text",
      "text": "<文本提示词>"
    },
    {
      "type": "image_url",
      "image_url": { "url": "<图片 URL>" },
      "role": "reference_image"
    },
    {
      "type": "video_url",
      "video_url": { "url": "<视频 URL>" },
      "role": "reference_video"
    },
    {
      "type": "audio_url",
      "audio_url": { "url": "<音频 URL>" },
      "role": "reference_audio"
    },
    {
      "type": "draft_task",
      "draft_task": { "id": "<草稿任务 ID>" }
    }
  ],
  "resolution": "<分辨率>",
  "ratio": "<画面比例>",
  "duration": 5,
  "frames": 120,
  "seed": 12345,
  "callback_url": "https://...",
  "return_last_frame": true,
  "generate_audio": true,
  "watermark": false,
  "camera_fixed": false,
  "draft": false,
  "priority": 1,
  "service_tier": "standard",
  "safety_identifier": "<安全标识>",
  "execution_expires_after": 3600,
  "tools": [{ "type": "web_search" }]
}
```

**ContentItem 参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `type` | string | 内容类型：`text` / `image_url` / `video_url` / `audio_url` / `draft_task` |
| `text` | string | type 为 `text` 时的文本内容 |
| `image_url.url` | string | type 为 `image_url` 时的图片 URL |
| `video_url.url` | string | type 为 `video_url` 时的视频 URL |
| `audio_url.url` | string | type 为 `audio_url` 时的音频 URL |
| `draft_task.id` | string | type 为 `draft_task` 时的草稿任务 ID |
| `role` | string | 媒体角色：`first_frame` / `last_frame` / `reference_image` / `reference_video` / `reference_audio` |

#### 提交响应

**HTTP 200：**

```json
{
  "id": "pub_xxxxxxxxxxxx",
  "task_id": "pub_xxxxxxxxxxxx",
  "object": "video",
  "model": "<模型名称>",
  "status": "queued",
  "progress": 0,
  "created_at": 1719123456,
  "metadata": {}
}
```

**响应字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 网关侧公共任务 ID，用于后续查询和取消 |
| `task_id` | string | 同 `id`，兼容旧接口 |
| `object` | string | 固定为 `"video"` |
| `model` | string | 请求时的模型名称 |
| `status` | string | 任务状态：`queued` / `in_progress` / `completed` / `failed` / `cancelled` |
| `progress` | int | 进度百分比（0-100） |
| `created_at` | int64 | 创建时间戳（Unix 秒） |

---

## 二、厂商详情

### 2.1 Vidu（国内版）

> 路由匹配：通过 `model` 字段选择 `vidu` 渠道适配器，请求自动转换为 Vidu API 格式并发送至 `{baseURL}/ent/v2/{action}`。

#### 模型列表

| 模型名 | 说明 |
|--------|------|
| `viduq3-ns` | Q3 NS |
| `viduq3-ns-flash` | Q3 NS Flash |
| `viduq2-ns` | Q2 NS |
| `viduq3-turbo` | Q3 Turbo |
| `viduq3-pro` | Q3 Pro |
| `viduq3-pro-fast` | Q3 Pro Fast |
| `viduq3` | Q3 |
| `viduq3-mix` | Q3 Mix |
| `viduq2-pro-fast` | Q2 Pro Fast |
| `viduq2-pro` | Q2 Pro |
| `viduq2-turbo` | Q2 Turbo |
| `viduq2` | Q2 |
| `viduq1` | Q1 |
| `viduq1-classic` | Q1 Classic |
| `vidu2.0` | V2.0 |
| `vidu_i2v_new_ns` | 新一代图生视频（NS） |
| `vidu_i2v_high_quality` | 新一代高清图生视频 |
| `vidu_hq_t2v` | HQ 文生视频 |
| `vidu_hq_i2v` | HQ 图生视频 |
| `vidu_hq_r2v` | HQ 参考图生视频 |
| `vidu_hq_headtail` | HQ 首尾帧生视频 |

#### 动作（Action）机制

适配器根据 `metadata.action` 或 `metadata.vidu_action` 确定动作类型；未指定时根据图片数量自动推断。

**动作推断规则：**

| 条件 | 默认动作 |
|------|---------|
| 模型名为 `vidu_i2v_new_ns` 或 `vidu_hq_*` | `template`（强制） |
| 无图片 | `text2video` |
| 1 张图片 | `img2video` |
| 多张图片 | `reference2video` |

**通过 `metadata` 主动指定动作：**

```json
{
  "metadata": {
    "action": "text2video"
  }
}
```

**支持的动作列表：**

| 动作 | 说明 | 关键参数 |
|------|------|---------|
| `text2video` | 文生视频 | `prompt` 必填 |
| `img2video` | 图生视频 | `images` 1 张必填 |
| `start-end2video` | 首尾帧生视频 | `images` 至少 2 张 |
| `reference2video` | 参考图生视频 | `prompt` 必填，`images` 1-5 张 或 `videos` / `subjects` |
| `multiframe` | 多帧生视频 | `metadata.start_image` + `metadata.image_settings` 必填 |
| `template` | 高清模板 | 根据 HQ 类型验证（见下） |
| `template-story` | 模板故事 | `metadata.story` + images 必填 |
| `image2dance` | 图片跳舞 | `metadata.image_url` + `metadata.video_url` 必填 |
| `extend` | 视频延长 | `metadata.video_creation_id` 或 `metadata.video_url` 必填 |
| `lip-sync` | 唇形同步 | `metadata.video_url` 必填，`metadata.audio_url` 或 `prompt` 必填 |
| `digital-human` | 数字人 | `metadata.image` 必填 |
| `upscale-new` | 视频增强 | `metadata.video_creation_id` 或 `metadata.video_url` 必填 |
| `one-click-general` | 一键通用 | `images` + `duration` 必填 |
| `ad-one-click` | 一键广告 | `images` 必填 |
| `one-click-mv` | 一键 MV | `images` + `metadata.audio_url` 必填 |
| `one-click-mv-edit` | 一键 MV 编辑 | `metadata.id` + `metadata.job_id` + `prompt` 必填 |
| `one-click-mv-compose` | 一键 MV 合成 | `metadata.id` + `metadata.job_ids` 必填 |
| `trending-replicate` | 热门视频复刻 | `images` + `metadata.video_url` 必填 |

**HQ 模板验证规则（`template` 动作）：**

适配器根据模型名推断 HQ 类型：

| 模型名 | 映射为 | 验证规则 |
|--------|--------|---------|
| `vidu_hq_t2v` | `t2v_high_quality` | prompt 必填，images 不可传 |
| `vidu_hq_i2v` / `vidu_i2v_high_quality` | `i2v_high_quality` | prompt + 1 image 必填 |
| `vidu_hq_r2v` | `r2v_high_quality` | prompt + 1-9 images 必填 |
| `vidu_hq_headtail` | `headtail_high_quality` | prompt + 2 images 必填 |
| `vidu_i2v_new_ns`（legacy） | — | 1 image 必填 |

#### 透传参数（Passthrough）

以下参数可通过 `metadata` 传递，会原样发送至 Vidu 上游 API：

```
aspect_ratio, audio, audio_type, audio_urls, callback_url, duration,
is_rec, meta_data, moderation, movement_amplitude, off_peak, payload,
resolution, seed, video_urls, voice_id, watermark, wm_position, wm_url
```

#### 请求示例

**Vidu Q3 文生视频：**

```json
{
  "model": "viduq3-turbo",
  "prompt": "A cinematic shot of a futuristic city at night, neon lights reflecting on wet streets",
  "size": "1080p",
  "duration": 5,
  "metadata": {
    "aspect_ratio": "9:16",
    "seed": 12345
  }
}
```

**Vidu 图生视频：**

```json
{
  "model": "viduq3-pro",
  "prompt": "A flower blooming in slow motion, cinematic lighting",
  "image": "https://example.com/flower.jpg",
  "size": "720p",
  "duration": 5
}
```

**Vidu 首尾帧：**

```json
{
  "model": "viduq3-turbo",
  "prompt": "Time lapse of a building construction",
  "images": [
    "https://example.com/empty_lot.jpg",
    "https://example.com/finished_building.jpg"
  ],
  "metadata": {
    "action": "start-end2video",
    "duration": 5
  }
}
```

**Vidu HQ 文生视频（高清模板）：**

```json
{
  "model": "vidu_hq_t2v",
  "prompt": "Cinematic shot of waves crashing on a rocky shore at sunset",
  "size": "1080p",
  "duration": 5,
  "metadata": {
    "aspect_ratio": "16:9"
  }
}
```

**Vidu 唇形同步：**

```json
{
  "model": "viduq3-pro",
  "prompt": "Hello, welcome to our channel",
  "metadata": {
    "action": "lip-sync",
    "video_url": "https://example.com/speaker.mp4"
  }
}
```

**Vidu 一键 MV：**

```json
{
  "model": "viduq3-pro",
  "images": ["https://example.com/image1.jpg", "https://example.com/image2.jpg"],
  "metadata": {
    "action": "one-click-mv",
    "audio_url": "https://example.com/bgm.mp3",
    "duration": 10
  }
}
```

---

### 2.2 Vidu Oversea（海外版）

> 路由匹配：模型名带 `-oversea` 后缀时自动选择 `vidu-oversea` 适配器。

#### 模型列表

| 模型名 | 说明 |
|--------|------|
| `viduq3-turbo-oversea` | Q3 Turbo 海外版 |
| `viduq3-pro-oversea` | Q3 Pro 海外版 |
| `viduq3-pro-fast-oversea` | Q3 Pro Fast 海外版 |
| `viduq2-pro-fast-oversea` | Q2 Pro Fast 海外版 |
| `viduq2-pro-oversea` | Q2 Pro 海外版 |
| `viduq2-turbo-oversea` | Q2 Turbo 海外版 |
| `viduq2-oversea` | Q2 海外版 |
| `viduq1-oversea` | Q1 海外版 |
| `viduq1-classic-oversea` | Q1 Classic 海外版 |
| `vidu2.0-oversea` | V2.0 海外版 |
| `vidu_hq_t2v-oversea` | HQ 文生视频海外版 |
| `vidu_hq_i2v-oversea` | HQ 图生视频海外版 |
| `vidu_hq_r2v-oversea` | HQ 参考图生视频海外版 |
| `vidu_hq_headtail-oversea` | HQ 首尾帧海外版 |

#### 差异说明

域外版与国内版 Vidu 的核心差异：

1. **模型名自动剥离 `-oversea` 后缀**后发送给上游
2. **自动应用海外内容审核**（`viducommon.ApplyOverseaModeration`）
3. **支持的 action 较少**：仅 `text2video`、`img2video`、`start-end2video`、`template`
4. **自动推断默认 action**：多张图片时默认 `start-end2video`（国内版为 `reference2video`）

#### 请求示例

```json
{
  "model": "viduq3-turbo-oversea",
  "prompt": "A cat walking on the moon, cinematic lighting",
  "size": "1080p",
  "duration": 5,
  "metadata": {
    "aspect_ratio": "9:16",
    "seed": 42
  }
}
```

```json
{
  "model": "vidu_hq_i2v-oversea",
  "prompt": "Sunlight through autumn leaves, cinematic",
  "image": "https://example.com/leaf.jpg",
  "size": "1080p"
}
```

---

### 2.3 Vidu CN（国内版 /vidu-cn）

> 路由匹配：模型名带 `-cn` 后缀时自动选择 `vidu-cn` 适配器。能力与国内版 `vidu` 一致，通过不同渠道配置连接不同上游端点。

---

### 2.4 AIDrama / Seedance（videodemo）

> 路由匹配：模型名为 `seedance-2.0` 或 `seedance-2.0-fast` 时选择 `aidrama` 适配器。

#### 模型列表

默认模型列表可通过环境变量 `AIDRAMA_MODELS` 或 `VIDEO_DEMO_MODELS` 配置：

```
seedance-2.0（默认）
seedance-2.0-fast
```

#### 请求示例

**AIDrama 文生视频：**

```json
{
  "model": "seedance-2.0",
  "prompt": "A short cinematic video of a peaceful mountain landscape",
  "size": "1080p",
  "duration": 5,
  "metadata": {
    "aspect_ratio": "16:9",
    "generate_audio": true,
    "watermark": false
  }
}
```

**AIDrama 图生视频（使用 `asset_url`）：**

```json
{
  "model": "seedance-2.0",
  "prompt": "Extend this image into a motion video",
  "duration": 5,
  "metadata": {
    "asset_url": "https://example.com/scene.jpg",
    "ratio": "9:16",
    "generate_audio": true
  }
}
```

**AIDrama 多素材（使用 `asset_urls`）：**

```json
{
  "model": "seedance-2.0",
  "prompt": "Create a video from these images",
  "metadata": {
    "asset_urls": [
      "https://example.com/img1.jpg",
      "https://example.com/img2.jpg"
    ],
    "ratio": "16:9",
    "duration": 5,
    "resolution": "720p"
  }
}
```

**Ark content[] 格式：**

```json
{
  "model": "seedance-2.0",
  "content": [
    { "type": "text", "text": "A cinematic shot of a futuristic city at night" },
    {
      "type": "image_url",
      "image_url": { "url": "https://example.com/skyline.jpg" },
      "role": "reference_image"
    }
  ],
  "ratio": "16:9",
  "duration": 5,
  "generate_audio": true,
  "callback_url": "https://callback.example.com/done"
}
```

**AIDrama 使用 `image`/`images` 字段：**

```json
{
  "model": "seedance-2.0",
  "prompt": "Animate this image",
  "image": "https://example.com/cat.jpg",
  "duration": 5
}
```

---

### 2.5 Kuaizi Seedance 2.0

> 路由匹配：模型名为 `kuaizi-seedance-2.0` 时选择 `kuaizi` 适配器。

#### 模型列表

| 模型名 | 说明 |
|--------|------|
| `kuaizi-seedance-2.0` | Kuaizi Seedance 2.0 视频生成 |

**注：** Kuaizi 管理类 API（素材管理、资产查询等）通过 `/kuaizi/*` 独立路由透传。

#### 请求参数

Kuaizi 适配器将通用参数映射为其原生 `KuaiziCreateRequest` 格式：

| 参数路径 | 映射到 | 说明 |
|---------|--------|------|
| `prompt` | `prompt` | 提示词 |
| `mode` | `mode` | 模式：`fast`（默认）/ `pro` |
| `size` | `resolution` + `ratio` | 根据 size 自动推断分辨率和比例 |
| `duration` | `duration` | 时长（秒），默认 5，范围 4-15，-1=自动 |
| `image` / `images` | `images[].url` | 图片输入数组 |
| `metadata.mode` | `mode` | 覆盖模式 |
| `metadata.resolution` | `resolution` | 分辨率：`480p` / `720p` / `1080p` |
| `metadata.ratio` | `ratio` | 比例：`16:9` / `4:3` / `1:1` / `3:4` / `9:16` / `21:9` / `adaptive` |
| `metadata.duration` | `duration` | 时长覆盖 |
| `metadata.seed` | `seed` | 随机种子 |
| `metadata.input_type` | `input_type` | 输入类型：`reference`（默认）/ `first_last_frame` |
| `metadata.generate_audio` | `generate_audio` | 是否生成音频 |
| `metadata.watermark` | `watermark` | 是否添加水印 |
| `metadata.web_search` | `web_search` | 是否启用联网搜索 |
| `metadata.videos` | `videos[].url` | 视频输入数组 |
| `metadata.audios` | `audios[].url` | 音频输入数组 |
| `metadata.ips` | `ips` | IP 白名单列表 |
| `metadata.super_resolution_config` | `super_resolution_config` | 超分辨率配置（对象） |

**超分辨率配置（`super_resolution_config`）：**

```json
{
  "super_resolution_config": {
    "resolution": "4k",
    "resolution_limit": 4096,
    "scene": "aigc",
    "tool_version": "standard",
    "fps": 30
  }
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `resolution` | string | 目标分辨率 |
| `resolution_limit` | int | 分辨率上限 |
| `scene` | string | 场景：`aigc` / `short_series` / `ugc` / `old_film` |
| `tool_version` | string | 版本：`standard` / `professional` |
| `fps` | int | 目标帧率 |

#### 请求示例

**Kuaizi 文生视频（扁平格式）：**

```json
{
  "model": "kuaizi-seedance-2.0",
  "prompt": "A peaceful sunset over the ocean with waves gently rolling",
  "size": "1920x1080",
  "duration": 5,
  "mode": "fast",
  "metadata": {
    "generate_audio": true,
    "seed": 42
  }
}
```

**Kuaizi 图生视频：**

```json
{
  "model": "kuaizi-seedance-2.0",
  "prompt": "Animate this scene with gentle motion",
  "image": "https://example.com/scene.jpg",
  "size": "1080p",
  "duration": 5,
  "metadata": {
    "mode": "pro",
    "generate_audio": true,
    "watermark": false
  }
}
```

**Kuaizi 首尾帧 + 音频 + 超分辨率：**

```json
{
  "model": "kuaizi-seedance-2.0",
  "prompt": "Smooth transition between these two frames",
  "images": [
    "https://example.com/start.jpg",
    "https://example.com/end.jpg"
  ],
  "duration": 5,
  "metadata": {
    "input_type": "first_last_frame",
    "generate_audio": true,
    "audios": [{ "url": "https://example.com/bgm.mp3" }],
    "super_resolution_config": {
      "resolution": "4k",
      "scene": "aigc",
      "tool_version": "professional"
    }
  }
}
```

**Kuaizi Ark content[] 格式：**

```json
{
  "model": "kuaizi-seedance-2.0",
  "content": [
    { "type": "text", "text": "Transform this image into a living scene" },
    {
      "type": "image_url",
      "image_url": { "url": "https://example.com/skyline.jpg" },
      "role": "reference_image"
    },
    {
      "type": "audio_url",
      "audio_url": { "url": "https://example.com/music.mp3" },
      "role": "reference_audio"
    }
  ],
  "resolution": "1080p",
  "ratio": "16:9",
  "duration": 5,
  "generate_audio": true
}
```

---

## 三、查询任务状态

### GET /v1/contents/generations/tasks/:task_id

查询时返回 **Ark 格式**响应（由各适配器的 `ConvertToArkResponse` 生成）。

#### 响应格式

```json
{
  "id": "pub_xxxxxxxxxxxx",
  "model": "<模型名称>",
  "status": "succeeded",
  "content": {
    "video_url": "https://cdn.example.com/output.mp4",
    "last_frame_url": "https://cdn.example.com/last_frame.jpg"
  },
  "duration": 5,
  "seed": 12345,
  "resolution": "1080p",
  "ratio": "16:9",
  "generate_audio": true,
  "created_at": 1719123456,
  "updated_at": 1719123500
}
```

**状态枚举：**

| 状态 | 说明 |
|------|------|
| `queued` | 排队中 |
| `running` | 生成中 |
| `succeeded` | 已完成 |
| `failed` | 失败 |
| `cancelled` | 已取消 |
| `unknown` | 未知 |

**失败时响应：**

```json
{
  "id": "pub_xxxxxxxxxxxx",
  "model": "<模型名称>",
  "status": "failed",
  "error": {
    "code": "error_code",
    "message": "错误描述"
  },
  "created_at": 1719123456,
  "updated_at": 1719123500
}
```

**实时拉取机制：**

当任务尚未进入终端状态（`succeeded` / `failed`）时，网关会尝试从上游厂商 API 实时拉取最新状态并更新本地数据库记录。

---

## 四、取消任务

### DELETE /v1/contents/generations/tasks/:task_id

#### 响应格式

```json
{
  "id": "pub_xxxxxxxxxxxx",
  "model": "<模型名称>",
  "status": "cancelled",
  "created_at": 1719123456,
  "updated_at": 1719123500
}
```

**注意：** 并非所有厂商都支持任务取消。若不支持，将返回 `task_cancel_not_supported` 错误。**Vidu 全系列支持取消**（调用上游 `POST /ent/v2/tasks/{task_id}/cancel`）。

---

## 五、二次创作（Remix）

### POST /v1/contents/generations/tasks/:task_id/remix

基于已有任务重新生成视频。请求体会自动继承原始任务的模型、渠道和计费参数。

```json
{
  "prompt": "New prompt for the remixed video",
  "duration": 5
}
```

---

## 六、错误处理

### 错误响应格式

```json
{
  "success": false,
  "error": "错误描述信息"
}
```

### 公共错误码

| Code | HTTP 状态码 | 说明 |
|------|-------------|------|
| `invalid_request` | 400 | 请求参数错误 |
| `model_not_found` | 404 | 模型不存在 |
| `model_offline` | 403 | 模型已下线 |
| `pricing_rule_missing` | 400 | 模型未配置定价规则 |
| `channel_binding_missing` | 503 | 模型无可用渠道绑定 |
| `get_channel_failed` | 503 | 无可用的上游渠道 |
| `insufficient_user_balance` | 400 | 余额不足 |
| `preconsume_balance_failed` | 400 | 预扣费失败 |
| `duration_usage_missing` | 400 | 无法确定计费时长 |
| `task_not_exist` | 400 | 任务不存在 |
| `task_cancel_not_supported` | 400 | 该厂商不支持取消 |
| `task_cancel_failed` | 400 | 取消任务失败 |
| `invalid_vidu_action` | 400 | Vidu 动作类型无效 |
| `invalid_vidu_request` | 400 | Vidu 请求参数验证失败 |
| `model_price_error` | 400 | 模型价格计算失败 |
| `invalid_endpoint_type` | 400 | 该模型不支持视频生成 |

### 错误处理建议

1. 提交任务时遇到 `insufficient_user_balance`：提示用户充值
2. 提交任务时遇到 `get_channel_failed`：稍后重试
3. 查询任务时遇到 `task_not_exist`：检查 task_id 是否正确
4. 查询任务时返回 `failed` 状态：检查 `error.message` 获取失败原因

---

## 七、云厂商配置参考

### 请求头

| 厂商 | 认证头 | 值格式 |
|------|--------|--------|
| Vidu | `Authorization` | `Token <api_key>` |
| AIDrama (Seedance) | `Authorization` | `Bearer <api_key>` |
| Kuaizi | `ApiKey` | `<api_key>` |

### 认证方式

所有标准化入口统一使用 **API Key（Bearer Token）** 认证：

```
Authorization: Bearer <api_key>
```

网关内部自动根据渠道类型转换为各厂商所需的认证格式。
