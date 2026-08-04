# Canvas 在线助手与本地 Agent i18n

## 限定范围

- `web/src/pages/canvas/components/canvas-agent-chat-ui.tsx`
- `web/src/pages/canvas/components/canvas-assistant-panel.tsx`
- `web/src/pages/canvas/components/canvas-local-agent-panel.tsx`
- `web/src/pages/canvas/stores/use-canvas-agent-store.ts`
- `web/src/pages/canvas/utils/canvas-agent-ops.ts`

未修改 locale JSON。下面两段资源需要由主任务分别合并到 `zh-CN.json` 和 `en-US.json` 的根级 `canvas` 节点。

## zh-CN key 对照

```json
{
  "canvas": {
    "agent": {
      "title": "Agent",
      "codex": "Codex",
      "mode": {
        "online": "网站",
        "local": "本机"
      },
      "tabs": {
        "setup": "连接",
        "chat": "对话",
        "history": "历史",
        "logs": "日志"
      },
      "accessibility": {
        "panel": "Agent 面板",
        "openAiLogo": "OpenAI"
      },
      "actions": {
        "cancel": "取消",
        "clear": "清空",
        "configure": "配置",
        "connect": "连接",
        "copy": "复制",
        "delete": "删除",
        "deleteRecord": "删除记录",
        "disconnect": "断开",
        "newConversation": "新对话",
        "open": "进入",
        "refresh": "刷新",
        "undo": "撤销"
      },
      "chat": {
        "removeImage": "移除图片",
        "send": "发送",
        "uploadImage": "上传图片",
        "working": "处理中..."
      },
      "composer": {
        "placeholder": "询问 Codex，或让它操作画布"
      },
      "tools": {
        "approve": "批准执行",
        "call": "工具调用",
        "confirmTitle": "确认工具调用",
        "confirmToggle": "工具确认",
        "detail": "详情",
        "reject": "拒绝执行",
        "status": {
          "approved": "已批准执行",
          "completed": "执行完成",
          "failed": "执行失败",
          "noop": "未生效",
          "pending": "等待确认",
          "rejected": "拒绝执行"
        }
      },
      "toolNames": {
        "applyOps": "画布操作",
        "getState": "读取画布",
        "getSelection": "读取选区",
        "exportSnapshot": "导出快照",
        "createNode": "创建节点",
        "createTextNode": "创建文本",
        "createTextNodes": "批量创建文本",
        "createConfigNode": "创建生成配置",
        "createImagePromptFlow": "创建生图流程",
        "createGenerationFlow": "创建生成流程",
        "generateText": "生成文本",
        "generateImage": "生成图片",
        "generateVideo": "生成视频",
        "generateAudio": "生成音频",
        "updateNode": "更新节点",
        "updateNodeText": "更新文本",
        "moveNodes": "移动节点",
        "resizeNode": "调整节点尺寸",
        "deleteNodes": "删除节点",
        "connectNodes": "连接节点",
        "selectNodes": "选择节点",
        "setViewport": "调整视口",
        "runGeneration": "触发生成"
      },
      "operations": {
        "addNode_one": "新增 {{value}} 个节点",
        "addNode_other": "新增 {{value}} 个节点",
        "updateNode_one": "更新 {{value}} 个节点",
        "updateNode_other": "更新 {{value}} 个节点",
        "deleteNode_one": "删除 {{value}} 个节点",
        "deleteNode_other": "删除 {{value}} 个节点",
        "deleteConnections_one": "删除 {{value}} 条连线",
        "deleteConnections_other": "删除 {{value}} 条连线",
        "connectNodes_one": "建立 {{value}} 条连线",
        "connectNodes_other": "建立 {{value}} 条连线",
        "setViewport_one": "调整 {{value}} 次视图",
        "setViewport_other": "调整 {{value}} 次视图",
        "selectNodes_one": "选择节点 {{value}} 次",
        "selectNodes_other": "选择节点 {{value}} 次",
        "runGeneration_one": "触发 {{value}} 次生成",
        "runGeneration_other": "触发 {{value}} 次生成",
        "unknown_one": "{{operation}} {{value}} 次",
        "unknown_other": "{{operation}} {{value}} 次"
      },
      "attachments": {
        "imagesSent": "发送了图片",
        "maxPayload": "图片附件最多约 {{size}}。",
        "payloadTooLarge": "图片附件超过 {{size}}，请删减后再发送。",
        "promptContext_one": "用户上传了 {{value}} 张图片附件：{{names}}。",
        "promptContext_other": "用户上传了 {{value}} 张图片附件：{{names}}。",
        "readFailed": "图片读取失败",
        "tooLargeTitle": "图片过大"
      },
      "deleteDialog": {
        "title": "删除对话记录",
        "description": "确定删除「{{name}}」吗？"
      },
      "diagnostics": {
        "title": "Infinite Canvas Agent 诊断日志",
        "endpoint": "Canvas Agent：{{value}}",
        "connection": "连接：{{value}}",
        "disabled": "未启用",
        "logs": "日志：{{value}}",
        "messages": "消息：{{value}}",
        "none": "无",
        "online": "在线",
        "pendingTool": "待确认工具：{{value}}",
        "sending": "发送中：{{value}}",
        "status": "状态：{{value}}",
        "waiting": "等待中：{{value}}"
      },
      "errors": {
        "canvasOperationFailed": "画布操作失败",
        "connectionFailed": "连接失败，请检查地址和 token",
        "connectionLost": "本地 Agent 连接失败或已断开",
        "deleteConversationFailed": "删除对话失败",
        "invalidUrl": "本地 Agent 地址格式不正确",
        "newConversationFailed": "新建对话失败",
        "notDiscovered": "没有发现本地 Agent，请先在 Codex 使用插件或手动启动 Canvas Agent",
        "pendingToolExists": "仍有待确认的画布工具调用",
        "requestFailed": "本地 Agent 请求失败",
        "requestRejected": "本地 Agent 拒绝了请求",
        "resumeConversationFailed": "恢复对话失败",
        "toolCancelledByUser": "用户取消了画布工具调用",
        "urlRequired": "请填写本地 Agent 地址"
      },
      "history": {
        "connectToView": "连接本地 Agent 后显示历史记录",
        "count_one": "{{value}} 条历史记录",
        "count_other": "{{value}} 条历史记录",
        "current": "当前",
        "defaultWorkspace": "默认画布目录",
        "empty": "暂无历史",
        "messageCount_one": "{{value}} 条消息",
        "messageCount_other": "{{value}} 条消息",
        "untitled": "未命名对话",
        "workspace": "工作空间",
        "workspaceEmpty": "当前工作空间还没有对话记录"
      },
      "logs": {
        "agentLog": "日志",
        "awaitingConfirmation": "等待确认",
        "codexEvent": "Codex 事件",
        "codexReply": "Codex 回复",
        "connectionFailed": "连接失败",
        "connectionLost": "连接断开",
        "copied": "日志已复制",
        "copyBlocked": "已选中日志，请手动复制",
        "count_one": "{{value}} 条",
        "count_other": "{{value}} 条",
        "deleteConversationFailed": "删除对话失败",
        "empty": "暂无事件日志",
        "error": "错误",
        "historyLoadFailed": "读取历史失败",
        "latestError": "最近错误",
        "latestErrorCopied": "最近错误已复制",
        "newConversationFailed": "新建对话失败",
        "rawJson": "原始 JSON",
        "requestAccepted": "本地 Agent 已接收",
        "resumeConversationFailed": "恢复对话失败",
        "sendFailed": "发送失败",
        "streamSummary": "流式摘要",
        "threadCreated": "已创建 Codex 会话",
        "title": "运行日志",
        "toolCompleted": "{{tool}}完成",
        "toolInvoked": "调用工具：{{tool}}",
        "troubleshooting": "排查日志",
        "turnCompleted": "本轮完成",
        "turnFailed": "本轮失败",
        "turnStarted": "开始处理",
        "userSent": "用户发送"
      },
      "messages": {
        "canvasReadSummary": "读取到 {{nodes}} 个节点，{{connections}} 条连线",
        "completed": "已完成",
        "connected": "本地 Agent 已连接",
        "errorTitle": "错误",
        "previousToolOperation": "上一次工具操作",
        "recordDeleted": "记录已删除",
        "sendFailed": "发送失败",
        "toolCallCompleted": "工具调用完成",
        "toolCompleted": "{{tool}}完成",
        "toolFailed": "工具失败",
        "undone": "已撤销"
      },
      "setup": {
        "autoDiscovery": "默认自动读取 Local URL 和 Connect token，失败时再手动填写。",
        "commandCopied": "命令已复制",
        "connectToken": "连接 Token",
        "connectTokenTechnical": "Connect token",
        "copyCommand": "复制命令",
        "description": "安装 Codex 插件后，画布会优先自动连接本机 Agent。",
        "localUrl": "本地地址",
        "localUrlTechnical": "Local URL",
        "steps": {
          "connectCanvas": {
            "description": "回到这里点击连接，网页会自动读取本机 Agent 配置。",
            "title": "打开画布连接"
          },
          "installPlugin": {
            "description": "在 Codex app 安装 Infinite Canvas 插件后，首次使用插件会自动启动本地 Agent。",
            "title": "安装 Codex 插件"
          },
          "manualStart": {
            "description": "如果自动发现失败，再运行下面命令。",
            "title": "手动启动备用"
          }
        },
        "title": "连接本地 Agent",
        "tokenPlaceholder": "自动发现，或手动填入 Connect token",
        "urlPlaceholder": "例如 http://127.0.0.1:17371",
        "webConnection": "网页连接"
      },
      "status": {
        "applyingCanvasOps": "执行画布操作",
        "awaitingConfirmation": "等待确认",
        "callingTool": "调用 {{tool}}",
        "cancelled": "已取消",
        "completed": "完成",
        "connected": "已连接",
        "connecting": "连接中",
        "connectionFailed": "连接失败",
        "disconnected": "连接断开",
        "error": "出错",
        "executingStep": "执行步骤",
        "messageUpdated": "更新消息",
        "newConversation": "新对话",
        "notConnected": "未连接",
        "offline": "离线",
        "readingCanvas": "读取画布",
        "ready": "就绪",
        "sendFailed": "发送失败",
        "sending": "发送中",
        "sessionRestored": "已恢复会话",
        "thinking": "思考中",
        "threadCreated": "已创建会话",
        "toolCompleted": "工具完成",
        "toolFailed": "工具失败",
        "undone": "已撤销"
      },
      "usage": {
        "inputOutput": "输入 {{input}} / 输出 {{output}} tokens",
        "tokens_one": "{{value}} token",
        "tokens_other": "{{value}} tokens"
      }
    },
    "assistant": {
      "accessibility": {
        "resizePanel": "调整右侧面板宽度"
      },
      "actions": {
        "collapse": "收起对话",
        "deleteAll": "删除全部"
      },
      "composer": {
        "placeholder": "描述你想让 Agent 如何操作画布"
      },
      "conversations": {
        "new": "新对话"
      },
      "deleteDialog": {
        "description_one": "将删除 {{value}} 条对话记录，此操作不可撤销。",
        "description_other": "将删除 {{value}} 条对话记录，此操作不可撤销。",
        "title": "删除对话记录？"
      },
      "diagnostics": {
        "confirmTools": "工具确认：{{value}}",
        "connections": "连线：{{value}}",
        "logs": "日志：{{value}}",
        "messages": "消息：{{value}}",
        "model": "模型：{{value}}",
        "nodes": "节点：{{value}}",
        "running": "运行中：{{value}}",
        "title": "Infinite Canvas 网站 Agent 诊断日志"
      },
      "empty": {
        "brand": "Infinite Canvas",
        "tagline": "一张画布，无限灵感"
      },
      "errors": {
        "argumentsMustBeObject": "工具参数必须是 JSON 对象",
        "fieldMustBeArray": "{{field}} 必须是数组",
        "fieldMustBeNonEmptyString": "{{field}} 必须是非空字符串",
        "fieldMustBeNumber": "{{field}} 必须是数字",
        "fieldMustBeStringArray": "{{field}} 必须是字符串数组",
        "fieldMustContainNonEmptyStrings": "{{field}} 必须只包含非空字符串",
        "fieldMustContainObjects": "{{field}} 必须只包含对象",
        "invalidArgumentsJson": "工具参数不是合法 JSON 对象",
        "invalidNodeType": "节点类型必须是 text、image、config、video 或 audio",
        "noToolCall": "模型没有返回工具调用，画布操作未执行。",
        "opsMustBeArray": "ops 必须是数组",
        "unsupportedOperation": "不支持的画布操作类型",
        "unsupportedTool": "不支持的工具：{{name}}"
      },
      "generation": {
        "promptTitle": "提示词",
        "titles": {
          "text": "文本生成",
          "image": "图片生成",
          "video": "视频生成",
          "audio": "音频生成"
        }
      },
      "history": {
        "description": "网站 Agent 的对话记录会显示在这里"
      },
      "logs": {
        "awaitingConfirmation": "等待用户确认",
        "continuationFailed": "工具续跑失败",
        "modelToolResponse": "模型工具回复",
        "requestFailed": "请求失败",
        "requestSent": "发送请求",
        "stepLimitReached": "Agent Tool Loop 达到步数上限",
        "toolApproved": "批准工具",
        "toolLoopEnded": "Agent Tool Loop {{step}} 结束",
        "toolLoopReply": "Agent Tool Loop {{step}} 回复",
        "toolLoopStarted": "Agent Tool Loop {{step}} 开始",
        "toolRejected": "拒绝工具",
        "toolResults": "工具执行结果"
      },
      "messages": {
        "autoExecutionCompleted": "工具自动执行完成",
        "canvasOperationApplied": "画布操作已执行。",
        "invalidToolArguments": "工具参数错误",
        "noContent": "没有返回内容。",
        "operationFailed": "操作失败",
        "previousToolFailed": "前一个工具调用失败，未继续执行。",
        "selectionCount_one": "当前选中 {{value}} 个节点。",
        "selectionCount_other": "当前选中 {{value}} 个节点。",
        "toolCallCancelled": "工具调用已取消",
        "toolContextMissing": "工具上下文不完整，无法执行。",
        "toolExecutionCompleted": "工具执行完成",
        "toolExecutionFailed": "工具执行失败",
        "toolsExecuted": "工具已执行。",
        "waitingForConfirmation": "准备执行工具，等待确认。"
      },
      "model": {
        "empty": "暂无文本模型",
        "notConfigured": "未配置模型",
        "select": "选择文本模型"
      },
      "noop": {
        "connectNodesNotFound": "没有找到要连接的节点。",
        "connectionsExist": "这些节点已经存在对应连线，无需重复连接。",
        "connectionsNotFound": "没有找到要删除的连线。",
        "deleteNodesNotFound": "没有找到要删除的节点。",
        "generationNodesNotFound": "没有找到要触发生成的节点。",
        "noConfigNodes": "画布当前没有生成配置节点可删除。",
        "noConnections": "画布当前没有连线可删除。",
        "noOperations": "模型没有返回可执行的画布操作。",
        "selectNodesNotFound": "没有找到要选择的节点。",
        "selectionUnchanged": "选区已经是目标状态。",
        "stateUnchanged": "工具已执行，但画布状态没有变化；请在日志 tab 查看工具参数和执行前后状态。",
        "updateNodesNotFound": "没有找到要更新的节点。",
        "viewportUnchanged": "视图已经是目标状态。"
      },
      "references": {
        "remove": "移除引用",
        "textFallback": "文"
      },
      "setup": {
        "description": "网站 Agent 直接使用当前网页配置的文本模型和 API。",
        "textModel": "文本模型",
        "title": "连接配置"
      },
      "snapshot": {
        "summary": "当前画布有 {{nodes}} 个节点、{{connections}} 条连线。文本 {{text}} 个，图片 {{images}} 个，生成配置 {{configs}} 个，视频 {{videos}} 个，音频 {{audios}} 个。"
      },
      "subtitle": "画布助手",
      "tabs": {
        "setup": "连接配置"
      }
    }
  }
}
```

## en-US key 对照

```json
{
  "canvas": {
    "agent": {
      "title": "Agent",
      "codex": "Codex",
      "mode": {
        "online": "Web",
        "local": "Local"
      },
      "tabs": {
        "setup": "Connect",
        "chat": "Chat",
        "history": "History",
        "logs": "Logs"
      },
      "accessibility": {
        "panel": "Agent panel",
        "openAiLogo": "OpenAI"
      },
      "actions": {
        "cancel": "Cancel",
        "clear": "Clear",
        "configure": "Configure",
        "connect": "Connect",
        "copy": "Copy",
        "delete": "Delete",
        "deleteRecord": "Delete record",
        "disconnect": "Disconnect",
        "newConversation": "New chat",
        "open": "Open",
        "refresh": "Refresh",
        "undo": "Undo"
      },
      "chat": {
        "removeImage": "Remove image",
        "send": "Send",
        "uploadImage": "Upload images",
        "working": "working..."
      },
      "composer": {
        "placeholder": "Ask Codex or tell it to edit the canvas"
      },
      "tools": {
        "approve": "Approve",
        "call": "Tool call",
        "confirmTitle": "Confirm tool call",
        "confirmToggle": "Confirm tools",
        "detail": "Details",
        "reject": "Reject",
        "status": {
          "approved": "Approved",
          "completed": "Completed",
          "failed": "Failed",
          "noop": "No changes",
          "pending": "Awaiting confirmation",
          "rejected": "Rejected"
        }
      },
      "toolNames": {
        "applyOps": "Canvas operations",
        "getState": "Read canvas",
        "getSelection": "Read selection",
        "exportSnapshot": "Export snapshot",
        "createNode": "Create node",
        "createTextNode": "Create text",
        "createTextNodes": "Create text nodes",
        "createConfigNode": "Create generation config",
        "createImagePromptFlow": "Create image flow",
        "createGenerationFlow": "Create generation flow",
        "generateText": "Generate text",
        "generateImage": "Generate image",
        "generateVideo": "Generate video",
        "generateAudio": "Generate audio",
        "updateNode": "Update node",
        "updateNodeText": "Update text",
        "moveNodes": "Move nodes",
        "resizeNode": "Resize node",
        "deleteNodes": "Delete nodes",
        "connectNodes": "Connect nodes",
        "selectNodes": "Select nodes",
        "setViewport": "Adjust viewport",
        "runGeneration": "Run generation"
      },
      "operations": {
        "addNode_one": "Add {{value}} node",
        "addNode_other": "Add {{value}} nodes",
        "updateNode_one": "Update {{value}} node",
        "updateNode_other": "Update {{value}} nodes",
        "deleteNode_one": "Delete {{value}} node",
        "deleteNode_other": "Delete {{value}} nodes",
        "deleteConnections_one": "Delete {{value}} connection",
        "deleteConnections_other": "Delete {{value}} connections",
        "connectNodes_one": "Create {{value}} connection",
        "connectNodes_other": "Create {{value}} connections",
        "setViewport_one": "Adjust the viewport {{value}} time",
        "setViewport_other": "Adjust the viewport {{value}} times",
        "selectNodes_one": "Change the selection {{value}} time",
        "selectNodes_other": "Change the selection {{value}} times",
        "runGeneration_one": "Run {{value}} generation",
        "runGeneration_other": "Run {{value}} generations",
        "unknown_one": "{{operation}} {{value}} time",
        "unknown_other": "{{operation}} {{value}} times"
      },
      "attachments": {
        "imagesSent": "Sent images",
        "maxPayload": "Image attachments can total about {{size}} at most.",
        "payloadTooLarge": "Image attachments exceed {{size}}. Remove some before sending.",
        "promptContext_one": "The user uploaded {{value}} image attachment: {{names}}.",
        "promptContext_other": "The user uploaded {{value}} image attachments: {{names}}.",
        "readFailed": "Failed to read image",
        "tooLargeTitle": "Images too large"
      },
      "deleteDialog": {
        "title": "Delete conversation",
        "description": "Delete \"{{name}}\"?"
      },
      "diagnostics": {
        "title": "Infinite Canvas Agent diagnostics",
        "endpoint": "Canvas Agent: {{value}}",
        "connection": "connection: {{value}}",
        "disabled": "disabled",
        "logs": "logs: {{value}}",
        "messages": "messages: {{value}}",
        "none": "none",
        "online": "online",
        "pendingTool": "pending tool: {{value}}",
        "sending": "sending: {{value}}",
        "status": "status: {{value}}",
        "waiting": "waiting: {{value}}"
      },
      "errors": {
        "canvasOperationFailed": "Canvas operation failed",
        "connectionFailed": "Connection failed. Check the address and token.",
        "connectionLost": "The local Agent connection failed or was disconnected",
        "deleteConversationFailed": "Failed to delete conversation",
        "invalidUrl": "The local Agent address is invalid",
        "newConversationFailed": "Failed to create conversation",
        "notDiscovered": "No local Agent was found. Use the Codex plugin or start Canvas Agent manually.",
        "pendingToolExists": "Another canvas tool call is awaiting confirmation",
        "requestFailed": "Local Agent request failed",
        "requestRejected": "The local Agent rejected the request",
        "resumeConversationFailed": "Failed to resume conversation",
        "toolCancelledByUser": "The user cancelled the canvas tool call",
        "urlRequired": "Enter the local Agent address"
      },
      "history": {
        "connectToView": "Connect the local Agent to view conversation history",
        "count_one": "{{value}} conversation",
        "count_other": "{{value}} conversations",
        "current": "Current",
        "defaultWorkspace": "Default canvas directory",
        "empty": "No history",
        "messageCount_one": "{{value}} message",
        "messageCount_other": "{{value}} messages",
        "untitled": "Untitled conversation",
        "workspace": "Workspace",
        "workspaceEmpty": "There are no conversations in this workspace"
      },
      "logs": {
        "agentLog": "Log",
        "awaitingConfirmation": "Awaiting confirmation",
        "codexEvent": "Codex event",
        "codexReply": "Codex reply",
        "connectionFailed": "Connection failed",
        "connectionLost": "Connection lost",
        "copied": "Logs copied",
        "copyBlocked": "Logs selected. Copy them manually.",
        "count_one": "{{value}} entry",
        "count_other": "{{value}} entries",
        "deleteConversationFailed": "Failed to delete conversation",
        "empty": "No event logs",
        "error": "Error",
        "historyLoadFailed": "Failed to load history",
        "latestError": "Latest error",
        "latestErrorCopied": "Latest error copied",
        "newConversationFailed": "Failed to create conversation",
        "rawJson": "Raw JSON",
        "requestAccepted": "Local Agent accepted the request",
        "resumeConversationFailed": "Failed to resume conversation",
        "sendFailed": "Send failed",
        "streamSummary": "Stream summary",
        "threadCreated": "Codex conversation created",
        "title": "Runtime logs",
        "toolCompleted": "{{tool}} completed",
        "toolInvoked": "Calling tool: {{tool}}",
        "troubleshooting": "Troubleshooting",
        "turnCompleted": "Turn completed",
        "turnFailed": "Turn failed",
        "turnStarted": "Processing started",
        "userSent": "User sent"
      },
      "messages": {
        "canvasReadSummary": "Read {{nodes}} nodes and {{connections}} connections",
        "completed": "Completed",
        "connected": "Local Agent connected",
        "errorTitle": "Error",
        "previousToolOperation": "Previous tool operation",
        "recordDeleted": "Record deleted",
        "sendFailed": "Send failed",
        "toolCallCompleted": "Tool call completed",
        "toolCompleted": "{{tool}} completed",
        "toolFailed": "Tool failed",
        "undone": "Undone"
      },
      "setup": {
        "autoDiscovery": "Local URL and Connect token are discovered automatically. Fill them in manually only if discovery fails.",
        "commandCopied": "Command copied",
        "connectToken": "Connection token",
        "connectTokenTechnical": "Connect token",
        "copyCommand": "Copy command",
        "description": "After the Codex plugin is installed, the canvas will try to connect to the local Agent automatically.",
        "localUrl": "Local address",
        "localUrlTechnical": "Local URL",
        "steps": {
          "connectCanvas": {
            "description": "Return here and connect. The web app will read the local Agent configuration automatically.",
            "title": "Connect the canvas"
          },
          "installPlugin": {
            "description": "Install the Infinite Canvas plugin in the Codex app. The plugin starts the local Agent the first time it is used.",
            "title": "Install the Codex plugin"
          },
          "manualStart": {
            "description": "Run the command below if automatic discovery fails.",
            "title": "Manual fallback"
          }
        },
        "title": "Connect local Agent",
        "tokenPlaceholder": "Discover automatically or enter the Connect token",
        "urlPlaceholder": "For example, http://127.0.0.1:17371",
        "webConnection": "Web connection"
      },
      "status": {
        "applyingCanvasOps": "Applying canvas operations",
        "awaitingConfirmation": "Awaiting confirmation",
        "callingTool": "Calling {{tool}}",
        "cancelled": "Cancelled",
        "completed": "Completed",
        "connected": "Connected",
        "connecting": "Connecting",
        "connectionFailed": "Connection failed",
        "disconnected": "Disconnected",
        "error": "Error",
        "executingStep": "Executing step",
        "messageUpdated": "Message updated",
        "newConversation": "New conversation",
        "notConnected": "Not connected",
        "offline": "Offline",
        "readingCanvas": "Reading canvas",
        "ready": "Ready",
        "sendFailed": "Send failed",
        "sending": "Sending",
        "sessionRestored": "Conversation restored",
        "thinking": "Thinking",
        "threadCreated": "Conversation created",
        "toolCompleted": "Tool completed",
        "toolFailed": "Tool failed",
        "undone": "Undone"
      },
      "usage": {
        "inputOutput": "{{input}} input / {{output}} output tokens",
        "tokens_one": "{{value}} token",
        "tokens_other": "{{value}} tokens"
      }
    },
    "assistant": {
      "accessibility": {
        "resizePanel": "Resize the right panel"
      },
      "actions": {
        "collapse": "Collapse chat",
        "deleteAll": "Delete all"
      },
      "composer": {
        "placeholder": "Describe how you want the Agent to edit the canvas"
      },
      "conversations": {
        "new": "New chat"
      },
      "deleteDialog": {
        "description_one": "Delete {{value}} conversation? This cannot be undone.",
        "description_other": "Delete {{value}} conversations? This cannot be undone.",
        "title": "Delete conversation history?"
      },
      "diagnostics": {
        "confirmTools": "confirm tools: {{value}}",
        "connections": "connections: {{value}}",
        "logs": "logs: {{value}}",
        "messages": "messages: {{value}}",
        "model": "model: {{value}}",
        "nodes": "nodes: {{value}}",
        "running": "running: {{value}}",
        "title": "Infinite Canvas web Agent diagnostics"
      },
      "empty": {
        "brand": "Infinite Canvas",
        "tagline": "One canvas, infinite ideas"
      },
      "errors": {
        "argumentsMustBeObject": "Tool arguments must be a JSON object",
        "fieldMustBeArray": "{{field}} must be an array",
        "fieldMustBeNonEmptyString": "{{field}} must be a non-empty string",
        "fieldMustBeNumber": "{{field}} must be a number",
        "fieldMustBeStringArray": "{{field}} must be an array of strings",
        "fieldMustContainNonEmptyStrings": "{{field}} must contain only non-empty strings",
        "fieldMustContainObjects": "{{field}} must contain only objects",
        "invalidArgumentsJson": "Tool arguments are not a valid JSON object",
        "invalidNodeType": "Node type must be text, image, config, video, or audio",
        "noToolCall": "The model returned no tool call, so no canvas operation was applied.",
        "opsMustBeArray": "ops must be an array",
        "unsupportedOperation": "Unsupported canvas operation type",
        "unsupportedTool": "Unsupported tool: {{name}}"
      },
      "generation": {
        "promptTitle": "Prompt",
        "titles": {
          "text": "Text generation",
          "image": "Image generation",
          "video": "Video generation",
          "audio": "Audio generation"
        }
      },
      "history": {
        "description": "Web Agent conversations will appear here"
      },
      "logs": {
        "awaitingConfirmation": "Awaiting user confirmation",
        "continuationFailed": "Tool continuation failed",
        "modelToolResponse": "Model tool response",
        "requestFailed": "Request failed",
        "requestSent": "Request sent",
        "stepLimitReached": "Agent tool loop reached the step limit",
        "toolApproved": "Tool approved",
        "toolLoopEnded": "Agent tool loop {{step}} ended",
        "toolLoopReply": "Agent tool loop {{step}} reply",
        "toolLoopStarted": "Agent tool loop {{step}} started",
        "toolRejected": "Tool rejected",
        "toolResults": "Tool results"
      },
      "messages": {
        "autoExecutionCompleted": "Automatic tool execution completed",
        "canvasOperationApplied": "Canvas operation applied.",
        "invalidToolArguments": "Invalid tool arguments",
        "noContent": "No content returned.",
        "operationFailed": "Operation failed",
        "previousToolFailed": "The previous tool call failed, so execution stopped.",
        "selectionCount_one": "{{value}} node is selected.",
        "selectionCount_other": "{{value}} nodes are selected.",
        "toolCallCancelled": "Tool call cancelled",
        "toolContextMissing": "Tool context is incomplete and cannot be executed.",
        "toolExecutionCompleted": "Tool execution completed",
        "toolExecutionFailed": "Tool execution failed",
        "toolsExecuted": "Tools executed.",
        "waitingForConfirmation": "Ready to run tools. Awaiting confirmation."
      },
      "model": {
        "empty": "No text models",
        "notConfigured": "No model configured",
        "select": "Select a text model"
      },
      "noop": {
        "connectNodesNotFound": "The nodes to connect were not found.",
        "connectionsExist": "Those nodes are already connected.",
        "connectionsNotFound": "The connections to delete were not found.",
        "deleteNodesNotFound": "The nodes to delete were not found.",
        "generationNodesNotFound": "The nodes to generate from were not found.",
        "noConfigNodes": "There are no generation config nodes to delete.",
        "noConnections": "There are no connections to delete.",
        "noOperations": "The model returned no executable canvas operations.",
        "selectNodesNotFound": "The nodes to select were not found.",
        "selectionUnchanged": "The selection is already in the requested state.",
        "stateUnchanged": "The tool ran, but the canvas did not change. Check the Logs tab for the tool arguments and before/after state.",
        "updateNodesNotFound": "The nodes to update were not found.",
        "viewportUnchanged": "The viewport is already in the requested state."
      },
      "references": {
        "remove": "Remove reference",
        "textFallback": "T"
      },
      "setup": {
        "description": "The web Agent uses the text model and API configured in this browser.",
        "textModel": "Text model",
        "title": "Connection settings"
      },
      "snapshot": {
        "summary": "The canvas has {{nodes}} nodes and {{connections}} connections: {{text}} text, {{images}} image, {{configs}} generation config, {{videos}} video, and {{audios}} audio nodes."
      },
      "subtitle": "Canvas assistant",
      "tabs": {
        "setup": "Connection"
      }
    }
  }
}
```

## 实现说明

- React 组件使用 `useTranslation()`；store、操作摘要、事件格式化、校验 fallback 等非 React 路径使用现有 `@/i18n` 实例。
- 工具名称与操作摘要统一到 `canvas.agent.toolNames.*`、`canvas.agent.operations.*`，数量使用 i18next plural，列表连接使用 `Intl.ListFormat`。
- 对话时间、事件时间、历史时间、数量、token 数和附件大小使用项目现有 `Intl` formatter。
- 在线助手和本地 Agent 的 Button、Tab、Modal、Tooltip、placeholder、aria-label、Toast、空状态、连接状态、运行状态、诊断日志与前端错误 fallback 均已迁移。
- 服务端返回的 `error/msg` 保持原文优先；仅在服务端没有消息时使用本地化 fallback。
- 保留 `ONLINE_AGENT_PROMPT`、`ONLINE_AGENT_TOOLS` 描述、画布上下文序列化文字和协议枚举，避免改变工具合同、Agent schema 与模型行为。
- 中文扫描仍命中的内容仅为上述模型/工具合同文本，以及用于识别历史中英文状态消息的正则，不是直接渲染文案。

## 验证

- `cd web && bun run build`：成功。
- TypeScript `tsc --noEmit`：成功。
- Vite production build：成功。
- 文档中的中英文资源片段各 300 个叶子 key，`jq empty` 通过，key 差异为 0。
- 源码引用 key 与文档资源 key 对照后，缺失为 0，多余为 0。
- `git diff --check`：成功。
- 未发现本模块专用测试文件；未修改路由、工具 schema、API 字段、SSE 事件、Agent 操作 union 或业务流程。
- 构建仅保留项目已有的动态/静态 import 混用和大 chunk 警告。
