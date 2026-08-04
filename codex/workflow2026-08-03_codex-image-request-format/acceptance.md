# 验证结果

## 红灯复现

在管理员登录后打开 `http://localhost:3000/admin/settings`，运行：

```bash
if "$PWCLI" snapshot | rg -q '图片请求格式'; then
  echo 'GREEN: 管理端已显示图片请求格式配置'
else
  echo 'RED: 管理端公开配置缺少图片请求格式配置'
  exit 1
fi
```

改动前结果：

```text
RED: 管理端公开配置缺少图片请求格式配置
```

## 改动后验证

- 同一浏览器断言返回 `GREEN: 管理端已显示图片请求格式配置`。
- 页面加载出已有映射 `gpt-image-2-open-1-edit -> application/json`。
- 可视化模式切换到 JSON 模式后，编辑器包含：

```json
"imageRequestFormats": [
  {
    "model": "gpt-image-2-open-1-edit",
    "format": "application/json"
  }
]
```

- 点击“添加模型”后新增 `gpt-image-2 -> application/json` 行。
- 协议下拉仅显示 `application/json` 和 `multipart/form-data`。
- `git diff --check` 通过。
- `npx prettier --check src/services/api/admin.ts src/pages/admin/settings/index.tsx` 在格式化后通过。

## 未执行

- 未点击“保存设置”，避免修改本地数据库。
- 未运行构建、全量测试或全量类型检查。
- 页面控制台仍有两条既有 Ant Design `InputNumber addonBefore/addonAfter` 弃用警告，与本次改动无关。

## 主线验证记录

- 最小回归用例确认显式 JSON 图片编辑会产生 `Content-Type: application/json`，并保留 `image` 字符串。
- 后端设置归一化用例确认未知模型、重复模型和非法格式不会进入公开配置。
- 管理端实际保存链路已在 `application/json` 与 `multipart/form-data` 间往返验证，最终公开配置恢复为：

```json
[
  {
    "model": "gpt-image-2-open-1-edit",
    "format": "application/json"
  }
]
```

- 浏览器持久化的远程 `AiConfig.imageRequestFormats` 已读取到同一映射。
- 用户将在后续自行完成其余业务测试，本任务不再追加测试执行。

## URL 结果修复诊断

- 失败任务 `task_CfwTkYqN5UHcuMjwe4jCdr1bfxgL9WzC` 查询结果为 `succeeded`，包含一个 `https://mule-router-assets.muleusercontent.com/...` 图片 URL。
- 同一 URL 在失败后可从宿主机和 API 容器返回 HTTP 200，排除固定无效地址。
- API 容器在实际失败时间记录 `TLS handshake timeout`；另一编辑任务记录 `unexpected EOF`，确认问题是一次性下载遇到瞬时网络错误。
- 已完成 `gofmt` 和 `git diff --check` 静态检查。
- 按用户要求，本轮未执行 Go/Node 测试、构建或重新部署；功能验证由用户后续完成。
