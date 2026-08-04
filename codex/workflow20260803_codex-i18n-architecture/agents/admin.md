# 管理后台国际化

## 限定范围

- 代码：`web/src/pages/admin/**`
- 资源：本代理未修改 `web/src/i18n/locales/*.json`
- 服务端 `error.message` / `json.msg` 保持原文，仅前端 fallback、校验与 UI 文案使用 i18n
- hooks 中的“未登录 / 权限不足 / 登录状态无效”仅用于匹配既有服务端消息，不是前端展示文案

## 修改文件

- `web/src/pages/admin/assets/index.tsx`
- `web/src/pages/admin/assets/use-admin-assets.ts`
- `web/src/pages/admin/credit-logs/index.tsx`
- `web/src/pages/admin/credit-logs/use-admin-credit-logs.ts`
- `web/src/pages/admin/enterprises/index.tsx`
- `web/src/pages/admin/enterprises/use-admin-enterprises.ts`
- `web/src/pages/admin/generation-tasks/generation-task-status.test.mjs`
- `web/src/pages/admin/generation-tasks/generation-task-status.ts`
- `web/src/pages/admin/generation-tasks/index.tsx`
- `web/src/pages/admin/generation-tasks/use-admin-generation-tasks.ts`
- `web/src/pages/admin/prompts/index.tsx`
- `web/src/pages/admin/prompts/use-admin-prompts.ts`
- `web/src/pages/admin/settings/index.tsx`
- `web/src/pages/admin/users/index.tsx`
- `web/src/pages/admin/users/use-admin-users.ts`

`web/src/pages/admin/dashboard/index.tsx` 仅做路由跳转，无用户可见文案，未修改。

## zh-CN 资源

将以下 `admin` 对象合并到 `zh-CN.json`：

```json
{
  "admin": {
    "common": {
      "actions": {
        "add": "新增",
        "adjust": "调整",
        "cancel": "取消",
        "close": "关闭",
        "confirm": "确定",
        "create": "创建",
        "delete": "删除",
        "details": "详情",
        "edit": "编辑",
        "enlarge": "放大",
        "query": "查询",
        "refresh": "刷新",
        "reset": "重置",
        "save": "保存",
        "sync": "同步",
        "test": "测试",
        "viewDetails": "查看详情"
      },
      "counts": {
        "companies_one": "{{value}} 家",
        "companies_other": "{{value}} 家",
        "people_one": "{{value}} 人",
        "people_other": "{{value}} 人",
        "records_one": "{{value}} 条",
        "records_other": "{{value}} 条"
      },
      "filters": {
        "all": "全部",
        "keyword": "关键词"
      },
      "messages": {
        "adjustFailed": "调整失败",
        "deleteFailed": "删除失败",
        "operationFailed": "操作失败",
        "saveFailed": "保存失败",
        "syncFailed": "同步失败"
      },
      "pagination": {
        "companies_one": "共 {{value}} 家",
        "companies_other": "共 {{value}} 家",
        "people_one": "共 {{value}} 人",
        "people_other": "共 {{value}} 人",
        "records_one": "共 {{value}} 条",
        "records_other": "共 {{value}} 条"
      },
      "statuses": {
        "disabled": "已停用",
        "enable": "启用",
        "enabled": "已启用"
      },
      "table": {
        "actions": "操作",
        "createdAt": "创建时间",
        "time": "时间"
      }
    },
    "users": {
      "title": "用户列表",
      "roles": {
        "user": "普通用户",
        "userShort": "用户",
        "admin": "管理员"
      },
      "statuses": {
        "active": "正常",
        "banned": "禁用"
      },
      "enterpriseRoles": {
        "owner": "主账号",
        "member": "子账号",
        "personal": "个人账号"
      },
      "filters": {
        "searchPlaceholder": "搜索用户名、昵称、邮箱或 Linux.do ID"
      },
      "table": {
        "user": "用户",
        "userId": "用户 ID",
        "role": "角色",
        "enterprise": "企业归属",
        "status": "状态",
        "credits": "算力点",
        "lastLogin": "最近登录"
      },
      "modal": {
        "createTitle": "新增用户",
        "editTitle": "编辑用户"
      },
      "form": {
        "basicInfo": "基础信息",
        "username": "用户名",
        "password": "密码",
        "newPassword": "新密码",
        "displayName": "昵称",
        "email": "邮箱",
        "role": "角色",
        "status": "状态",
        "creditAdjustment": "算力点调整",
        "credits": "算力点",
        "enterpriseCreditsHint": "企业账号积分请在企业管理中按增量调整。"
      },
      "validation": {
        "usernameRequired": "请输入用户名",
        "passwordRequired": "请输入密码",
        "roleRequired": "请选择角色",
        "statusRequired": "请选择状态"
      },
      "messages": {
        "created": "用户已新增",
        "saved": "用户已保存",
        "deleted": "用户已删除",
        "creditsAdjusted": "算力点已调整",
        "loadFailed": "读取用户失败"
      },
      "delete": {
        "title": "删除用户",
        "confirm": "确定删除「{{name}}」吗？删除后该账号将无法继续登录。"
      }
    },
    "enterprises": {
      "title": "企业列表",
      "actions": {
        "create": "创建企业",
        "setDiscount": "设置折扣倍率",
        "adjustCredits": "调整主账号积分",
        "resetPassword": "重置主账号密码",
        "confirmAdjustment": "确认调整"
      },
      "filters": {
        "searchPlaceholder": "搜索企业名称或主账号"
      },
      "table": {
        "enterprise": "企业",
        "owner": "主账号",
        "members": "成员",
        "ownerBalance": "主账号余额",
        "discountRate": "折扣倍率",
        "enterpriseStatus": "企业状态",
        "ownerStatus": "主账号状态"
      },
      "values": {
        "multiplier": "{{value}} 倍"
      },
      "units": {
        "multiplier": "倍"
      },
      "create": {
        "title": "创建企业"
      },
      "discount": {
        "title": "设置折扣倍率 · {{name}}"
      },
      "credits": {
        "title": "调整主账号积分 · {{name}}",
        "balancePrefix": "当前余额：",
        "balanceHint": "。正数增加，负数扣减，扣减后余额不能小于 0。",
        "recentAdjustments": "最近平台调整",
        "reason": "原因",
        "operator": "操作者"
      },
      "password": {
        "title": "重置主账号密码",
        "confirm": "重置「{{name}}」的密码后，该账号现有会话会立即失效。"
      },
      "form": {
        "name": "企业名称",
        "ownerDisplayName": "主账号昵称",
        "ownerUsername": "主账号用户名",
        "initialPassword": "初始密码",
        "discountRate": "折扣倍率",
        "adjustmentAmount": "调整数量",
        "adjustmentPlaceholder": "例如 100 或 -50.5",
        "adjustmentReason": "调整原因",
        "reasonPlaceholder": "例如：线下充值到账",
        "newPassword": "新密码"
      },
      "validation": {
        "nameRequired": "请输入企业名称",
        "ownerUsernameRequired": "请输入用户名",
        "initialPasswordRequired": "请输入初始密码",
        "discountRequired": "请输入折扣倍率",
        "discountRange": "折扣倍率必须在 0.1 到 1 之间",
        "adjustmentRequired": "请输入调整数量",
        "adjustmentNonZero": "调整数量不能为 0",
        "reasonRequired": "请输入调整原因",
        "newPasswordRequired": "请输入新密码"
      },
      "messages": {
        "creditLogsLoadFailed": "读取充值记录失败"
      }
    },
    "creditLogs": {
      "title": "算力点日志",
      "types": {
        "adminAdjust": "后台调整",
        "aiConsume": "模型消费",
        "aiRefund": "失败返还",
        "enterpriseAllocate": "企业分配",
        "enterpriseReclaim": "企业收回"
      },
      "filters": {
        "searchPlaceholder": "搜索用户 ID、类型、备注或关联 ID"
      },
      "table": {
        "userId": "用户 ID",
        "relatedId": "操作者 / 关联 ID",
        "type": "类型",
        "change": "变动",
        "balance": "余额",
        "remark": "备注"
      },
      "modal": {
        "createTitle": "新增日志",
        "editTitle": "编辑日志"
      },
      "form": {
        "userId": "用户 ID",
        "type": "类型",
        "amount": "变动数量",
        "balance": "变动后余额",
        "relatedId": "关联 ID",
        "createdAtPlaceholder": "不填则新增时自动生成",
        "remark": "备注",
        "extra": "扩展信息"
      },
      "validation": {
        "userIdRequired": "请输入用户 ID",
        "typeRequired": "请输入类型",
        "amountRequired": "请输入变动数量",
        "balanceRequired": "请输入变动后余额"
      },
      "messages": {
        "created": "日志已新增",
        "saved": "日志已保存",
        "deleted": "日志已删除",
        "loadFailed": "读取日志失败"
      },
      "delete": {
        "title": "删除日志",
        "confirm": "确定删除这条算力点日志吗？"
      }
    },
    "generationTasks": {
      "title": "使用日志",
      "types": {
        "image": "图片生成",
        "video": "视频生成",
        "audio": "音频生成",
        "chat": "对话"
      },
      "statuses": {
        "queued": "排队中",
        "pending": "等待中",
        "running": "运行中",
        "success": "成功",
        "failed": "失败",
        "cancelled": "已取消",
        "unknown": "未知"
      },
      "filters": {
        "userId": "用户 ID",
        "userIdPlaceholder": "搜索用户 ID",
        "taskType": "任务类型",
        "status": "状态"
      },
      "table": {
        "userId": "用户 ID",
        "username": "用户名",
        "taskType": "任务类型",
        "model": "模型",
        "modelDisplayName": "模型展示名",
        "provider": "服务商",
        "status": "状态",
        "credits": "扣费",
        "upstreamCredits": "上游 Credits",
        "duration": "耗时",
        "error": "错误信息"
      },
      "actions": {
        "deleteSelected_one": "删除选中（{{value}}）",
        "deleteSelected_other": "删除选中（{{value}}）"
      },
      "delete": {
        "title": "确认删除",
        "confirm": "确定删除该条使用日志吗？用户：{{user}}，模型：{{model}}"
      },
      "batchDelete": {
        "title": "确认批量删除",
        "confirm_one": "确定删除选中的 {{value}} 条使用日志吗？此操作不可恢复。",
        "confirm_other": "确定删除选中的 {{value}} 条使用日志吗？此操作不可恢复。"
      },
      "detail": {
        "title": "任务详情",
        "taskId": "任务 ID",
        "userId": "用户 ID",
        "upstreamTask": "上游任务",
        "type": "类型",
        "status": "状态",
        "credits": "扣费",
        "upstreamCredits": "上游 Credits",
        "provider": "服务商",
        "model": "模型",
        "duration": "耗时",
        "error": "错误信息",
        "requestBody": "请求体",
        "responseBody": "响应体",
        "rawError": "原始错误"
      },
      "values": {
        "seconds": "{{value}} 秒",
        "noData": "（无数据）",
        "truncated": "…（已截断）"
      },
      "messages": {
        "deleted": "已删除",
        "batchDeleted_one": "已删除 {{value}} 条记录",
        "batchDeleted_other": "已删除 {{value}} 条记录",
        "batchDeleteFailed": "批量删除失败",
        "loadFailed": "读取日志失败"
      }
    },
    "assets": {
      "title": "素材列表",
      "types": {
        "all": "全部类型",
        "text": "文本",
        "image": "图片"
      },
      "filters": {
        "searchPlaceholder": "搜索标题、内容或标签",
        "type": "类型",
        "tags": "标签",
        "allTags": "全部标签"
      },
      "table": {
        "cover": "封面",
        "title": "标题",
        "type": "类型",
        "tags": "标签",
        "category": "分类"
      },
      "modal": {
        "createTitle": "新增素材",
        "editTitle": "编辑素材"
      },
      "form": {
        "type": "类型",
        "title": "标题",
        "coverUrl": "封面 URL",
        "tags": "标签，用逗号分隔",
        "category": "分类",
        "description": "描述",
        "imageFile": "图片文件",
        "imageUploadHint": "上传后自动填充 S3 URL",
        "textContent": "文本内容"
      },
      "validation": {
        "typeRequired": "请选择类型",
        "titleRequired": "请输入标题",
        "contentRequired": "请输入文本内容"
      },
      "actions": {
        "selectImage": "选择图片",
        "copyContent": "复制内容"
      },
      "detail": {
        "title": "素材详情"
      },
      "delete": {
        "title": "删除素材",
        "confirm": "确定删除「{{title}}」吗？删除后会从服务器素材库中移除。"
      },
      "values": {
        "uncategorized": "未标注"
      },
      "messages": {
        "created": "素材已新增",
        "saved": "素材已保存",
        "deleted": "素材已删除",
        "loadFailed": "读取素材失败",
        "fileUnreadable": "文件不可读",
        "uploadFailed": "上传失败"
      }
    },
    "prompts": {
      "title": "提示词列表",
      "filters": {
        "searchPlaceholder": "搜索标题或提示词",
        "group": "分组",
        "tags": "标签",
        "allCategories": "全部分类",
        "allTags": "全部标签"
      },
      "table": {
        "cover": "封面",
        "title": "标题",
        "category": "分类",
        "tags": "标签"
      },
      "actions": {
        "batchDelete_one": "批量删除 {{value}}",
        "batchDelete_other": "批量删除 {{value}}",
        "copyPrompt": "复制提示词",
        "remoteSource": "远程源"
      },
      "modal": {
        "createTitle": "新增提示词",
        "editTitle": "编辑提示词"
      },
      "form": {
        "title": "标题",
        "category": "分类",
        "coverUrl": "封面 URL",
        "tags": "标签，用逗号分隔",
        "prompt": "提示词"
      },
      "validation": {
        "titleRequired": "请输入标题",
        "promptRequired": "请输入提示词"
      },
      "detail": {
        "title": "提示词详情"
      },
      "sync": {
        "title": "同步远程提示词源",
        "remoteSource": "远程源"
      },
      "delete": {
        "title": "删除提示词",
        "confirm": "确定删除「{{title}}」吗？删除后会从当前分类中删除。"
      },
      "batchDelete": {
        "title": "批量删除提示词",
        "confirm_one": "确定删除已选中的 {{value}} 条提示词吗？删除后会从当前分类中删除。",
        "confirm_other": "确定删除已选中的 {{value}} 条提示词吗？删除后会从当前分类中删除。"
      },
      "messages": {
        "synced": "远程提示词源已同步",
        "created": "提示词已新增",
        "saved": "提示词已保存",
        "deleted": "提示词已删除",
        "batchDeleted": "提示词已批量删除",
        "batchDeleteFailed": "批量删除失败",
        "loadFailed": "读取提示词失败"
      }
    },
    "settings": {
      "tabs": {
        "public": "公开配置（对外暴露）",
        "private": "私有配置（不会对外暴露）"
      },
      "actions": {
        "saveSettings": "保存设置",
        "format": "格式化",
        "addModel": "添加模型",
        "selectModels": "选择模型"
      },
      "editor": {
        "visual": "可视化编辑",
        "json": "手动编辑 JSON",
        "validJson": "JSON 格式正确",
        "publicHint": "这些配置会暴露给前端读取",
        "privateHint": "这些配置只会在后台保存"
      },
      "messages": {
        "loadFailed": "读取设置失败",
        "saved": "已保存",
        "invalidJson": "JSON 格式不正确",
        "invalidPublicJson": "公开配置 JSON 格式不正确",
        "invalidPrivateJson": "私有配置 JSON 格式不正确"
      },
      "units": {
        "seconds": "秒"
      },
      "public": {
        "availableModels": {
          "label": "系统可用模型（请先在私有配置里配置渠道）",
          "hint": "保存设置时会自动合并所有已启用私有渠道的模型，前台模型下拉会读取这里的公开列表",
          "placeholder": "请选择系统可用模型"
        },
        "defaultModels": {
          "default": "默认模型",
          "image": "默认图片模型",
          "video": "默认视频模型",
          "text": "默认文本模型",
          "audio": "默认音频模型"
        },
        "capabilityModels": {
          "title": "各能力可选模型",
          "description": "必须显式勾选；未勾选的模型不会在前台展示，也不能发起平台生成。",
          "imageLabel": "图片模型可选项",
          "imageHint": "留空时前台无图片模型可选",
          "imagePlaceholder": "选择图片模型",
          "videoLabel": "视频模型可选项",
          "videoHint": "留空时前台无视频模型可选",
          "videoPlaceholder": "选择视频模型",
          "textLabel": "文本模型可选项",
          "textHint": "留空时前台无文本模型可选",
          "textPlaceholder": "选择文本模型",
          "audioLabel": "音频模型可选项",
          "audioHint": "留空时前台无音频模型可选",
          "audioPlaceholder": "选择音频模型"
        },
        "imageRequestFormats": {
          "title": "图片请求格式",
          "description": "仅显式配置的图片模型使用指定协议；未配置模型保持现有默认请求格式。",
          "modelRequired": "请选择图片模型",
          "formatRequired": "请选择请求格式",
          "formatPlaceholder": "选择请求格式",
          "deleteLabel": "删除图片请求格式 {{model}}"
        },
        "systemPrompt": "系统提示词",
        "customChannel": {
          "label": "允许用户自定义渠道",
          "hint": "开启后，前端可提供走后端渠道和用户自定义 baseUrl 直连两种模式。关闭后，整个平台强制使用后台渠道，用户不再能自行配置渠道与模型，生成请求统一走后端代理并消耗算力点。"
        },
        "registration": {
          "label": "是否允许用户注册",
          "hint": "关闭后隐藏注册入口，注册接口也会拒绝新用户创建"
        }
      },
      "billing": {
        "title": "模型算力点",
        "description": "普通模型按次计费；视频模型按私有配置中的能力绑定 ID 和计费规则匹配。",
        "modes": {
          "perCredit": "按 credits 计费",
          "perSecond": "按秒计费",
          "perCall": "按次计费"
        },
        "table": {
          "model": "模型",
          "displayName": "展示名称",
          "rule": "计费规则",
          "price": "定价"
        },
        "units": {
          "pointsPerSecond": "点/秒",
          "perCredit": "每 credits",
          "perCall": "每次调用",
          "points": "点"
        }
      },
      "private": {
        "linuxDo": {
          "title": "Linux.do 登录",
          "callbackHint": "本项目接口回调地址是 /api/auth/linux-do/callback，请在 Linux.do 应用后台自行拼接站点前缀。",
          "manageApp": "点击此处管理你的 LinuxDO OAuth App",
          "enabled": "开启 Linux.do 登录",
          "clientId": "Linux.do Client ID",
          "clientIdPlaceholder": "输入 Linux.do OAuth App 的 ID",
          "clientSecret": "Linux.do Client Secret",
          "secretPlaceholder": "留空则沿用已保存的密钥"
        },
        "promptSync": {
          "title": "提示词定时同步",
          "enabled": "开启定时同步",
          "cron": "Cron 表达式",
          "hint": "默认每 5 分钟同步内置 GitHub 远程提示词源"
        },
        "fileLimits": {
          "title": "文件上传大小限制",
          "description": "设置各类型文件上传到 S3 存储桶的单个文件大小上限（单位：MB）。",
          "image": "图片（images）",
          "video": "视频（videos）",
          "audio": "音频（audios）",
          "prompt": "提示词（prompts）"
        }
      },
      "channels": {
        "actions": {
          "add": "新增渠道",
          "deleteLabel": "删除渠道 {{name}}"
        },
        "table": {
          "name": "名称",
          "protocol": "协议",
          "status": "状态",
          "models": "模型",
          "weight": "权重"
        },
        "values": {
          "unnamed": "未命名渠道",
          "channel": "渠道",
          "noModels": "未配置模型",
          "modelSummary_one": "{{value}} 个模型：{{models}}…",
          "modelSummary_other": "{{value}} 个模型：{{models}}…"
        },
        "drawer": {
          "createTitle": "新增渠道",
          "editTitle": "编辑渠道"
        },
        "form": {
          "name": "渠道名称",
          "protocol": "协议",
          "weight": "权重",
          "baseUrl": "接口地址",
          "apiKey": "API Key",
          "apiKeyPlaceholder": "留空则沿用已保存的 API Key",
          "models": "渠道可用模型",
          "remark": "备注"
        },
        "validation": {
          "nameRequired": "请输入渠道名称",
          "baseUrlRequired": "请输入接口地址",
          "apiKeyRequired": "请输入 API Key"
        },
        "messages": {
          "baseUrlRequired": "请先填写接口地址",
          "apiKeyRequired": "请先填写 API Key",
          "noModelsReturned": "上游未返回模型列表，请手动输入模型名称",
          "modelsFetched_one": "已获取 {{value}} 个模型，请选择后确认",
          "modelsFetched_other": "已获取 {{value}} 个模型，请选择后确认",
          "modelsLoadFailed": "读取模型失败",
          "testRequirements": "请先填写接口地址和至少一个模型",
          "testFailed": "测试失败"
        }
      },
      "generationProfiles": {
        "title": "视频能力绑定",
        "description": "将渠道中的实际模型绑定到画布支持的生成能力。普通视频使用 Seedance 请求结构，短剧使用 Vidu Drama 请求结构。",
        "channelRequired": "请先新增并启用一个包含模型的渠道。",
        "empty": "尚未绑定视频能力。新增绑定后，画布会使用稳定的能力名称调用所选上游模型。",
        "defaultName": "视频绑定 {{number}}",
        "types": {
          "standardVideo": "普通视频（Seedance）",
          "shortDrama": "短剧（Vidu Drama）"
        },
        "actions": {
          "add": "新增绑定",
          "deleteLabel": "删除{{capability}}绑定"
        },
        "values": {
          "capability": "能力"
        },
        "tabs": {
          "binding": "能力绑定",
          "billing": "计费规则"
        },
        "form": {
          "bindingId": "绑定 ID",
          "capability": "画布能力",
          "channel": "渠道",
          "channelPlaceholder": "选择渠道",
          "upstreamModel": "上游模型",
          "modelPlaceholder": "选择模型",
          "selectChannelFirst": "请先选择渠道",
          "maxDuration": "最大时长",
          "durationPlaceholder": "{{value}} 秒",
          "resolutions": "支持分辨率",
          "billingMode": "计费方式"
        }
      },
      "modelSelector": {
        "title": "选择渠道模型",
        "selectedSummary": "已选择 {{selected}} / {{total}}",
        "searchPlaceholder": "搜索模型",
        "modelPlaceholder": "输入模型名称",
        "fetchModels": "拉取模型列表",
        "manualHint": "如果上游不提供 OpenAI /models 模型列表接口，请在这里手动增加模型名称。",
        "tabs": {
          "new_one": "新获取的模型（{{value}}）",
          "new_other": "新获取的模型（{{value}}）",
          "current_one": "已有的模型（{{value}}）",
          "current_other": "已有的模型（{{value}}）"
        },
        "currentSummary": "当前列表已选择 {{selected}} / {{total}}",
        "selectAll": "全选当前列表",
        "clearCurrent": "取消当前列表",
        "empty": "没有匹配的模型"
      },
      "channelTest": {
        "title": "{{name}}渠道的模型测试",
        "modelCount_one": "共 {{value}} 个模型",
        "modelCount_other": "共 {{value}} 个模型",
        "batchTest_one": "批量测试 {{value}} 个模型",
        "batchTest_other": "批量测试 {{value}} 个模型",
        "description": "普通文本模型会发送一条 hi；Agent Plan / Seedance 视频模型只做配置格式检查，不会发起视频生成，也不代表模型权限已验证。",
        "searchPlaceholder": "搜索模型…",
        "table": {
          "model": "模型名称",
          "status": "状态"
        },
        "statuses": {
          "testing": "测试中",
          "notStarted": "未开始",
          "success": "成功"
        },
        "duration": "请求时长：{{value}} 秒"
      }
    }
  }
}
```

## en-US Resource

Merge the following `admin` object into `en-US.json`:

```json
{
  "admin": {
    "common": {
      "actions": {
        "add": "Add",
        "adjust": "Adjust",
        "cancel": "Cancel",
        "close": "Close",
        "confirm": "Confirm",
        "create": "Create",
        "delete": "Delete",
        "details": "Details",
        "edit": "Edit",
        "enlarge": "Enlarge",
        "query": "Search",
        "refresh": "Refresh",
        "reset": "Reset",
        "save": "Save",
        "sync": "Sync",
        "test": "Test",
        "viewDetails": "View details"
      },
      "counts": {
        "companies_one": "{{value}} company",
        "companies_other": "{{value}} companies",
        "people_one": "{{value}} person",
        "people_other": "{{value}} people",
        "records_one": "{{value}} record",
        "records_other": "{{value}} records"
      },
      "filters": {
        "all": "All",
        "keyword": "Keyword"
      },
      "messages": {
        "adjustFailed": "Adjustment failed",
        "deleteFailed": "Delete failed",
        "operationFailed": "Operation failed",
        "saveFailed": "Save failed",
        "syncFailed": "Sync failed"
      },
      "pagination": {
        "companies_one": "{{value}} company total",
        "companies_other": "{{value}} companies total",
        "people_one": "{{value}} person total",
        "people_other": "{{value}} people total",
        "records_one": "{{value}} record total",
        "records_other": "{{value}} records total"
      },
      "statuses": {
        "disabled": "Disabled",
        "enable": "Enable",
        "enabled": "Enabled"
      },
      "table": {
        "actions": "Actions",
        "createdAt": "Created at",
        "time": "Time"
      }
    },
    "users": {
      "title": "Users",
      "roles": {
        "user": "Standard user",
        "userShort": "User",
        "admin": "Administrator"
      },
      "statuses": {
        "active": "Active",
        "banned": "Disabled"
      },
      "enterpriseRoles": {
        "owner": "Owner account",
        "member": "Member account",
        "personal": "Personal account"
      },
      "filters": {
        "searchPlaceholder": "Search username, display name, email, or Linux.do ID"
      },
      "table": {
        "user": "User",
        "userId": "User ID",
        "role": "Role",
        "enterprise": "Enterprise",
        "status": "Status",
        "credits": "Credits",
        "lastLogin": "Last login"
      },
      "modal": {
        "createTitle": "Add user",
        "editTitle": "Edit user"
      },
      "form": {
        "basicInfo": "Basic information",
        "username": "Username",
        "password": "Password",
        "newPassword": "New password",
        "displayName": "Display name",
        "email": "Email",
        "role": "Role",
        "status": "Status",
        "creditAdjustment": "Credit adjustment",
        "credits": "Credits",
        "enterpriseCreditsHint": "Adjust enterprise account credits incrementally from Enterprise Management."
      },
      "validation": {
        "usernameRequired": "Enter a username",
        "passwordRequired": "Enter a password",
        "roleRequired": "Select a role",
        "statusRequired": "Select a status"
      },
      "messages": {
        "created": "User added",
        "saved": "User saved",
        "deleted": "User deleted",
        "creditsAdjusted": "Credits adjusted",
        "loadFailed": "Failed to load users"
      },
      "delete": {
        "title": "Delete user",
        "confirm": "Delete “{{name}}”? This account will no longer be able to sign in."
      }
    },
    "enterprises": {
      "title": "Enterprises",
      "actions": {
        "create": "Create enterprise",
        "setDiscount": "Set discount multiplier",
        "adjustCredits": "Adjust owner credits",
        "resetPassword": "Reset owner password",
        "confirmAdjustment": "Confirm adjustment"
      },
      "filters": {
        "searchPlaceholder": "Search enterprise name or owner account"
      },
      "table": {
        "enterprise": "Enterprise",
        "owner": "Owner account",
        "members": "Members",
        "ownerBalance": "Owner balance",
        "discountRate": "Discount multiplier",
        "enterpriseStatus": "Enterprise status",
        "ownerStatus": "Owner status"
      },
      "values": {
        "multiplier": "{{value}}×"
      },
      "units": {
        "multiplier": "×"
      },
      "create": {
        "title": "Create enterprise"
      },
      "discount": {
        "title": "Set discount multiplier · {{name}}"
      },
      "credits": {
        "title": "Adjust owner credits · {{name}}",
        "balancePrefix": "Current balance: ",
        "balanceHint": ". Positive values add credits; negative values deduct them. The resulting balance cannot be below 0.",
        "recentAdjustments": "Recent platform adjustments",
        "reason": "Reason",
        "operator": "Operator"
      },
      "password": {
        "title": "Reset owner password",
        "confirm": "Reset the password for “{{name}}”? All existing sessions for this account will expire immediately."
      },
      "form": {
        "name": "Enterprise name",
        "ownerDisplayName": "Owner display name",
        "ownerUsername": "Owner username",
        "initialPassword": "Initial password",
        "discountRate": "Discount multiplier",
        "adjustmentAmount": "Adjustment amount",
        "adjustmentPlaceholder": "For example, 100 or -50.5",
        "adjustmentReason": "Reason",
        "reasonPlaceholder": "For example, offline payment received",
        "newPassword": "New password"
      },
      "validation": {
        "nameRequired": "Enter an enterprise name",
        "ownerUsernameRequired": "Enter a username",
        "initialPasswordRequired": "Enter an initial password",
        "discountRequired": "Enter a discount multiplier",
        "discountRange": "The discount multiplier must be between 0.1 and 1",
        "adjustmentRequired": "Enter an adjustment amount",
        "adjustmentNonZero": "The adjustment amount cannot be 0",
        "reasonRequired": "Enter a reason",
        "newPasswordRequired": "Enter a new password"
      },
      "messages": {
        "creditLogsLoadFailed": "Failed to load top-up records"
      }
    },
    "creditLogs": {
      "title": "Credit logs",
      "types": {
        "adminAdjust": "Admin adjustment",
        "aiConsume": "Model usage",
        "aiRefund": "Failure refund",
        "enterpriseAllocate": "Enterprise allocation",
        "enterpriseReclaim": "Enterprise reclaim"
      },
      "filters": {
        "searchPlaceholder": "Search user ID, type, note, or related ID"
      },
      "table": {
        "userId": "User ID",
        "relatedId": "Operator / Related ID",
        "type": "Type",
        "change": "Change",
        "balance": "Balance",
        "remark": "Note"
      },
      "modal": {
        "createTitle": "Add log",
        "editTitle": "Edit log"
      },
      "form": {
        "userId": "User ID",
        "type": "Type",
        "amount": "Change amount",
        "balance": "Balance after change",
        "relatedId": "Related ID",
        "createdAtPlaceholder": "Leave blank to generate automatically",
        "remark": "Note",
        "extra": "Extra data"
      },
      "validation": {
        "userIdRequired": "Enter a user ID",
        "typeRequired": "Enter a type",
        "amountRequired": "Enter a change amount",
        "balanceRequired": "Enter the resulting balance"
      },
      "messages": {
        "created": "Log added",
        "saved": "Log saved",
        "deleted": "Log deleted",
        "loadFailed": "Failed to load logs"
      },
      "delete": {
        "title": "Delete log",
        "confirm": "Delete this credit log?"
      }
    },
    "generationTasks": {
      "title": "Usage logs",
      "types": {
        "image": "Image generation",
        "video": "Video generation",
        "audio": "Audio generation",
        "chat": "Chat"
      },
      "statuses": {
        "queued": "Queued",
        "pending": "Pending",
        "running": "Running",
        "success": "Succeeded",
        "failed": "Failed",
        "cancelled": "Cancelled",
        "unknown": "Unknown"
      },
      "filters": {
        "userId": "User ID",
        "userIdPlaceholder": "Search user ID",
        "taskType": "Task type",
        "status": "Status"
      },
      "table": {
        "userId": "User ID",
        "username": "Username",
        "taskType": "Task type",
        "model": "Model",
        "modelDisplayName": "Model display name",
        "provider": "Provider",
        "status": "Status",
        "credits": "Credits charged",
        "upstreamCredits": "Upstream credits",
        "duration": "Duration",
        "error": "Error"
      },
      "actions": {
        "deleteSelected_one": "Delete selected ({{value}})",
        "deleteSelected_other": "Delete selected ({{value}})"
      },
      "delete": {
        "title": "Confirm deletion",
        "confirm": "Delete this usage log? User: {{user}}, model: {{model}}"
      },
      "batchDelete": {
        "title": "Confirm bulk deletion",
        "confirm_one": "Delete the selected {{value}} usage log? This action cannot be undone.",
        "confirm_other": "Delete the selected {{value}} usage logs? This action cannot be undone."
      },
      "detail": {
        "title": "Task details",
        "taskId": "Task ID",
        "userId": "User ID",
        "upstreamTask": "Upstream task",
        "type": "Type",
        "status": "Status",
        "credits": "Credits charged",
        "upstreamCredits": "Upstream credits",
        "provider": "Provider",
        "model": "Model",
        "duration": "Duration",
        "error": "Error",
        "requestBody": "Request body",
        "responseBody": "Response body",
        "rawError": "Raw error"
      },
      "values": {
        "seconds": "{{value}} sec",
        "noData": "(No data)",
        "truncated": "… (truncated)"
      },
      "messages": {
        "deleted": "Deleted",
        "batchDeleted_one": "Deleted {{value}} record",
        "batchDeleted_other": "Deleted {{value}} records",
        "batchDeleteFailed": "Bulk delete failed",
        "loadFailed": "Failed to load logs"
      }
    },
    "assets": {
      "title": "Assets",
      "types": {
        "all": "All types",
        "text": "Text",
        "image": "Image"
      },
      "filters": {
        "searchPlaceholder": "Search title, content, or tags",
        "type": "Type",
        "tags": "Tags",
        "allTags": "All tags"
      },
      "table": {
        "cover": "Cover",
        "title": "Title",
        "type": "Type",
        "tags": "Tags",
        "category": "Category"
      },
      "modal": {
        "createTitle": "Add asset",
        "editTitle": "Edit asset"
      },
      "form": {
        "type": "Type",
        "title": "Title",
        "coverUrl": "Cover URL",
        "tags": "Tags, separated by commas",
        "category": "Category",
        "description": "Description",
        "imageFile": "Image file",
        "imageUploadHint": "The S3 URL is filled automatically after upload",
        "textContent": "Text content"
      },
      "validation": {
        "typeRequired": "Select a type",
        "titleRequired": "Enter a title",
        "contentRequired": "Enter text content"
      },
      "actions": {
        "selectImage": "Select image",
        "copyContent": "Copy content"
      },
      "detail": {
        "title": "Asset details"
      },
      "delete": {
        "title": "Delete asset",
        "confirm": "Delete “{{title}}”? It will be removed from the server asset library."
      },
      "values": {
        "uncategorized": "Uncategorized"
      },
      "messages": {
        "created": "Asset added",
        "saved": "Asset saved",
        "deleted": "Asset deleted",
        "loadFailed": "Failed to load assets",
        "fileUnreadable": "The file cannot be read",
        "uploadFailed": "Upload failed"
      }
    },
    "prompts": {
      "title": "Prompts",
      "filters": {
        "searchPlaceholder": "Search title or prompt",
        "group": "Group",
        "tags": "Tags",
        "allCategories": "All categories",
        "allTags": "All tags"
      },
      "table": {
        "cover": "Cover",
        "title": "Title",
        "category": "Category",
        "tags": "Tags"
      },
      "actions": {
        "batchDelete_one": "Bulk delete {{value}}",
        "batchDelete_other": "Bulk delete {{value}}",
        "copyPrompt": "Copy prompt",
        "remoteSource": "Remote source"
      },
      "modal": {
        "createTitle": "Add prompt",
        "editTitle": "Edit prompt"
      },
      "form": {
        "title": "Title",
        "category": "Category",
        "coverUrl": "Cover URL",
        "tags": "Tags, separated by commas",
        "prompt": "Prompt"
      },
      "validation": {
        "titleRequired": "Enter a title",
        "promptRequired": "Enter a prompt"
      },
      "detail": {
        "title": "Prompt details"
      },
      "sync": {
        "title": "Sync remote prompt sources",
        "remoteSource": "Remote source"
      },
      "delete": {
        "title": "Delete prompt",
        "confirm": "Delete “{{title}}”? It will be removed from the current category."
      },
      "batchDelete": {
        "title": "Bulk delete prompts",
        "confirm_one": "Delete the selected {{value}} prompt? It will be removed from the current category.",
        "confirm_other": "Delete the selected {{value}} prompts? They will be removed from the current category."
      },
      "messages": {
        "synced": "Remote prompt source synced",
        "created": "Prompt added",
        "saved": "Prompt saved",
        "deleted": "Prompt deleted",
        "batchDeleted": "Prompts deleted",
        "batchDeleteFailed": "Bulk delete failed",
        "loadFailed": "Failed to load prompts"
      }
    },
    "settings": {
      "tabs": {
        "public": "Public settings (exposed externally)",
        "private": "Private settings (not exposed externally)"
      },
      "actions": {
        "saveSettings": "Save settings",
        "format": "Format",
        "addModel": "Add model",
        "selectModels": "Select models"
      },
      "editor": {
        "visual": "Visual editor",
        "json": "Edit JSON manually",
        "validJson": "Valid JSON",
        "publicHint": "These settings are available to the frontend",
        "privateHint": "These settings are stored only on the backend"
      },
      "messages": {
        "loadFailed": "Failed to load settings",
        "saved": "Saved",
        "invalidJson": "Invalid JSON",
        "invalidPublicJson": "Invalid public settings JSON",
        "invalidPrivateJson": "Invalid private settings JSON"
      },
      "units": {
        "seconds": "sec"
      },
      "public": {
        "availableModels": {
          "label": "System models (configure channels under Private Settings first)",
          "hint": "Saving automatically merges models from all enabled private channels. Frontend model selectors read this public list.",
          "placeholder": "Select system models"
        },
        "defaultModels": {
          "default": "Default model",
          "image": "Default image model",
          "video": "Default video model",
          "text": "Default text model",
          "audio": "Default audio model"
        },
        "capabilityModels": {
          "title": "Models by capability",
          "description": "Models must be selected explicitly. Unselected models are hidden from the frontend and cannot start platform generation.",
          "imageLabel": "Image models",
          "imageHint": "Leave empty to offer no image models",
          "imagePlaceholder": "Select image models",
          "videoLabel": "Video models",
          "videoHint": "Leave empty to offer no video models",
          "videoPlaceholder": "Select video models",
          "textLabel": "Text models",
          "textHint": "Leave empty to offer no text models",
          "textPlaceholder": "Select text models",
          "audioLabel": "Audio models",
          "audioHint": "Leave empty to offer no audio models",
          "audioPlaceholder": "Select audio models"
        },
        "imageRequestFormats": {
          "title": "Image request formats",
          "description": "Only explicitly configured image models use the selected protocol. Unconfigured models keep the existing default request format.",
          "modelRequired": "Select an image model",
          "formatRequired": "Select a request format",
          "formatPlaceholder": "Select a request format",
          "deleteLabel": "Delete image request format for {{model}}"
        },
        "systemPrompt": "System prompt",
        "customChannel": {
          "label": "Allow custom user channels",
          "hint": "When enabled, the frontend can use backend channels or connect directly through a custom baseUrl. When disabled, the platform forces backend channels, hides user channel and model configuration, and routes generation through the backend proxy using credits."
        },
        "registration": {
          "label": "Allow user registration",
          "hint": "When disabled, the registration entry is hidden and the registration API rejects new accounts"
        }
      },
      "billing": {
        "title": "Model credits",
        "description": "Standard models are billed per call. Video models match capability binding IDs and billing rules from Private Settings.",
        "modes": {
          "perCredit": "Per upstream credit",
          "perSecond": "Per second",
          "perCall": "Per call"
        },
        "table": {
          "model": "Model",
          "displayName": "Display name",
          "rule": "Billing rule",
          "price": "Price"
        },
        "units": {
          "pointsPerSecond": "credits/sec",
          "perCredit": "Per upstream credit",
          "perCall": "Per call",
          "points": "credits"
        }
      },
      "private": {
        "linuxDo": {
          "title": "Linux.do sign-in",
          "callbackHint": "The callback path is /api/auth/linux-do/callback. Add your site origin in the Linux.do application console.",
          "manageApp": "Manage your LinuxDO OAuth App",
          "enabled": "Enable Linux.do sign-in",
          "clientId": "Linux.do Client ID",
          "clientIdPlaceholder": "Enter the Linux.do OAuth App ID",
          "clientSecret": "Linux.do Client Secret",
          "secretPlaceholder": "Leave blank to keep the saved secret"
        },
        "promptSync": {
          "title": "Scheduled prompt sync",
          "enabled": "Enable scheduled sync",
          "cron": "Cron expression",
          "hint": "By default, built-in GitHub prompt sources sync every 5 minutes"
        },
        "fileLimits": {
          "title": "Upload size limits",
          "description": "Set the per-file upload limit for each S3 storage category (MB).",
          "image": "Images (images)",
          "video": "Videos (videos)",
          "audio": "Audio (audios)",
          "prompt": "Prompts (prompts)"
        }
      },
      "channels": {
        "actions": {
          "add": "Add channel",
          "deleteLabel": "Delete channel {{name}}"
        },
        "table": {
          "name": "Name",
          "protocol": "Protocol",
          "status": "Status",
          "models": "Models",
          "weight": "Weight"
        },
        "values": {
          "unnamed": "Unnamed channel",
          "channel": "Channel",
          "noModels": "No models configured",
          "modelSummary_one": "{{value}} model: {{models}}…",
          "modelSummary_other": "{{value}} models: {{models}}…"
        },
        "drawer": {
          "createTitle": "Add channel",
          "editTitle": "Edit channel"
        },
        "form": {
          "name": "Channel name",
          "protocol": "Protocol",
          "weight": "Weight",
          "baseUrl": "API endpoint",
          "apiKey": "API Key",
          "apiKeyPlaceholder": "Leave blank to keep the saved API Key",
          "models": "Available channel models",
          "remark": "Note"
        },
        "validation": {
          "nameRequired": "Enter a channel name",
          "baseUrlRequired": "Enter an API endpoint",
          "apiKeyRequired": "Enter an API Key"
        },
        "messages": {
          "baseUrlRequired": "Enter an API endpoint first",
          "apiKeyRequired": "Enter an API Key first",
          "noModelsReturned": "The upstream service returned no models. Enter model names manually.",
          "modelsFetched_one": "Fetched {{value}} model. Select it and confirm.",
          "modelsFetched_other": "Fetched {{value}} models. Select them and confirm.",
          "modelsLoadFailed": "Failed to load models",
          "testRequirements": "Enter an API endpoint and at least one model first",
          "testFailed": "Test failed"
        }
      },
      "generationProfiles": {
        "title": "Video capability bindings",
        "description": "Bind actual channel models to Canvas generation capabilities. Standard video uses the Seedance request shape; short drama uses the Vidu Drama request shape.",
        "channelRequired": "Add and enable a channel with at least one model first.",
        "empty": "No video capabilities are bound. After adding one, Canvas uses its stable capability name to call the selected upstream model.",
        "defaultName": "Video binding {{number}}",
        "types": {
          "standardVideo": "Standard video (Seedance)",
          "shortDrama": "Short drama (Vidu Drama)"
        },
        "actions": {
          "add": "Add binding",
          "deleteLabel": "Delete {{capability}} binding"
        },
        "values": {
          "capability": "capability"
        },
        "tabs": {
          "binding": "Capability binding",
          "billing": "Billing rule"
        },
        "form": {
          "bindingId": "Binding ID",
          "capability": "Canvas capability",
          "channel": "Channel",
          "channelPlaceholder": "Select a channel",
          "upstreamModel": "Upstream model",
          "modelPlaceholder": "Select a model",
          "selectChannelFirst": "Select a channel first",
          "maxDuration": "Maximum duration",
          "durationPlaceholder": "{{value}} sec",
          "resolutions": "Supported resolutions",
          "billingMode": "Billing mode"
        }
      },
      "modelSelector": {
        "title": "Select channel models",
        "selectedSummary": "{{selected}} / {{total}} selected",
        "searchPlaceholder": "Search models",
        "modelPlaceholder": "Enter a model name",
        "fetchModels": "Fetch model list",
        "manualHint": "If the upstream service does not provide an OpenAI-compatible /models endpoint, add model names manually here.",
        "tabs": {
          "new_one": "New model ({{value}})",
          "new_other": "New models ({{value}})",
          "current_one": "Existing model ({{value}})",
          "current_other": "Existing models ({{value}})"
        },
        "currentSummary": "{{selected}} / {{total}} selected in this list",
        "selectAll": "Select all in this list",
        "clearCurrent": "Clear this list",
        "empty": "No matching models"
      },
      "channelTest": {
        "title": "Model test for {{name}}",
        "modelCount_one": "{{value}} model total",
        "modelCount_other": "{{value}} models total",
        "batchTest_one": "Test {{value}} model",
        "batchTest_other": "Test {{value}} models",
        "description": "Standard text models receive a single “hi” message. Agent Plan and Seedance video models only receive configuration validation; no video is generated, and model access is not verified.",
        "searchPlaceholder": "Search models…",
        "table": {
          "model": "Model",
          "status": "Status"
        },
        "statuses": {
          "testing": "Testing",
          "notStarted": "Not started",
          "success": "Succeeded"
        },
        "duration": "Request duration: {{value}} sec"
      }
    }
  }
}
```

## 验证

- `bun test src/pages/admin/generation-tasks/generation-task-status.test.mjs src/pages/admin/settings/billing-rules.test.mjs`
  - 5 pass / 0 fail
- `bunx tsc --noEmit --pretty false -p tsconfig.json`
  - 通过
- `git diff --check -- web/src/pages/admin`
  - 通过
- 中文硬编码扫描
  - UI 文案无残留
  - 仅保留 5 处既有服务端鉴权消息匹配字符串
- 未运行全量 `bun run build`，按代理任务约束交由主任务在合并语言资源后执行
