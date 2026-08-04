# Canvas 项目列表与编辑器外壳 i18n

## 范围

本批迁移 Canvas 项目列表、项目卡片、删除确认、编辑器顶栏、底部工具栏、缩放与快捷键、总览侧栏、右键菜单，以及 `project/index.tsx` 内的前端提示、默认标题、fallback 错误和本地生成提示词。补充迁移 Store/Replica 的默认项目标题、导入标题、资源引用标签和导出默认文件名。

本代理未修改 locale JSON。主代理需要确认下方资源已合并到 `zh-CN.json` 与 `en-US.json` 的顶层 `canvas` 节点后再做浏览器验证。

用户项目名、节点内容、素材标题、服务端错误原文、Agent activity、节点类型/任务状态/API source/MIME 等协议值不翻译。取消判断复用全局 `errors.requestCancelled`，不再依赖中文哨兵。

## 改动文件

- `web/src/pages/canvas/index.tsx`
- `web/src/pages/canvas/project/index.tsx`
- `web/src/pages/canvas/components/canvas-project-card.tsx`
- `web/src/pages/canvas/components/canvas-delete-projects-dialog.tsx`
- `web/src/pages/canvas/components/canvas-toolbar.tsx`
- `web/src/pages/canvas/components/canvas-zoom-controls.tsx`
- `web/src/pages/canvas/components/canvas-context-menu.tsx`
- `web/src/pages/canvas/components/canvas-overview-sidebar.tsx`
- `web/src/pages/canvas/stores/use-canvas-store.ts`
- `web/src/pages/canvas/stores/canvas-replica.ts`
- `web/src/pages/canvas/utils/canvas-export.ts`
- `web/src/pages/canvas/utils/canvas-resource-references.ts`

以下限定文件已审阅，无用户可见文案，因此未改动：

- `web/src/pages/canvas/components/canvas-mini-map.tsx`
- `web/src/pages/canvas/components/canvas-overview.ts`
- `web/src/pages/canvas/components/infinite-canvas.tsx`
- `web/src/pages/canvas/components/canvas-connections.tsx`
- `web/src/pages/canvas/components/canvas-resource-mention-textarea.tsx`
- `web/src/pages/canvas/components/canvas-generation-resume.ts`
- `web/src/pages/canvas/stores/use-canvas-ui-store.ts`

## zh-CN 资源

```json
{
  "canvas": {
    "nodeTypes": {
      "image": "图片",
      "text": "文本",
      "config": "配置",
      "video": "视频",
      "audio": "音频"
    },
    "library": {
      "states": {
        "loading": "正在加载...",
        "opening": "正在打开画布...",
        "loadingProjects": "正在加载画布..."
      },
      "header": {
        "eyebrow": "画布库",
        "title": "无限画布"
      },
      "actions": {
        "exportSelected": "导出选中",
        "deleteSelected": "删除选中",
        "deleteAll": "删除全部",
        "import": "导入画布",
        "create": "新建画布"
      },
      "messages": {
        "importSuccess_one": "已导入 {{value}} 个画布",
        "importSuccess_other": "已导入 {{value}} 个画布"
      },
      "errors": {
        "importFailed": "导入失败，请选择有效的画布压缩包"
      },
      "empty": {
        "title": "还没有画布",
        "description": "新建一个画布后，就可以独立保存节点、连线和画布外观。"
      },
      "project": {
        "defaultTitle": "无限画布 {{index}}",
        "selectedExportFileName_one": "无限画布-{{value}}个项目",
        "selectedExportFileName_other": "无限画布-{{value}}个项目",
        "selectLabel": "选择 {{title}}",
        "nodeCount_one": "{{value}} 个节点",
        "nodeCount_other": "{{value}} 个节点",
        "connectionCount_one": "{{value}} 条连线",
        "connectionCount_other": "{{value}} 条连线",
        "updatedAt": "更新于 {{time}}",
        "actions": {
          "saveName": "保存名称",
          "cancelRename": "取消重命名",
          "export": "导出",
          "rename": "重命名",
          "delete": "删除"
        }
      },
      "deleteDialog": {
        "title": "删除画布？",
        "cancel": "取消",
        "confirm": "删除",
        "description_one": "将删除 {{value}} 个画布，里面的节点和连线也会一起移除。",
        "description_other": "将删除 {{value}} 个画布，里面的节点和连线也会一起移除。"
      }
    },
    "toolbar": {
      "tools": {
        "hand": "移动/选择",
        "undo": "撤销",
        "redo": "重做",
        "text": "文本",
        "image": "图片",
        "video": "视频",
        "audio": "音频",
        "config": "生成配置",
        "upload": "上传素材",
        "assets": "我的素材",
        "appearance": "画布外观",
        "deleteSelected": "删除选中",
        "clear": "清空画布"
      },
      "appearance": {
        "title": "画布外观",
        "themeMode": "主题模式",
        "light": "浅色",
        "dark": "深色",
        "gridStyle": "网格样式",
        "dots": "点",
        "lines": "线",
        "blank": "空白",
        "imageInfo": "图片信息",
        "switchTheme": "切换到{{theme}}主题"
      }
    },
    "zoom": {
      "minimap": {
        "open": "打开小地图",
        "close": "关闭小地图"
      },
      "reset": "重置视图",
      "scale": "放大/缩小画布"
    },
    "shortcuts": {
      "title": "快捷键",
      "gestures": {
        "dragCanvas": "拖动画布",
        "wheel": "滚轮",
        "drag": "拖动",
        "click": "点击",
        "zoomSlider": "缩放滑杆",
        "dropMedia": "拖入图片/视频/音频"
      },
      "actions": {
        "pan": "平移视图",
        "zoom": "缩放画布",
        "preciseZoom": "精确调整缩放",
        "boxSelect": "框选多个节点",
        "addSelection": "追加选择节点",
        "selectAll": "全选节点",
        "copyPaste": "复制 / 粘贴节点",
        "copyPasteClipboard": "复制 / 粘贴节点，或粘贴剪切板文本/图片",
        "undo": "撤销",
        "redo": "重做",
        "deleteSelection": "删除选中",
        "cancelOverlays": "取消选择并关闭浮层",
        "upload": "上传到画布"
      }
    },
    "contextMenu": {
      "duplicate": "复制",
      "delete": "删除"
    },
    "overview": {
      "label": "画布总览",
      "expand": "展开总览侧栏",
      "collapse": "折叠总览侧栏",
      "tabs": {
        "label": "总览类型",
        "canvas": "画布",
        "assets": "素材"
      },
      "search": {
        "placeholder": "搜索节点",
        "ariaLabel": "搜索 Canvas 节点"
      },
      "type": {
        "all": "全部类型",
        "label": "节点类型"
      },
      "listLabel": "Canvas 节点列表",
      "batchResults_one": " · {{value}} 个结果",
      "batchResults_other": " · {{value}} 个结果",
      "empty": "没有匹配节点",
      "videoPreview": "{{title}}预览",
      "status": {
        "processing": "处理中",
        "failed": "失败",
        "completed": "已完成",
        "ready": "就绪"
      }
    },
    "editor": {
      "project": {
        "untitled": "未命名画布",
        "imported": "导入画布"
      },
      "connectionCreate": {
        "title": "引用该节点生成",
        "close": "关闭",
        "text": {
          "title": "文本生成",
          "description": "脚本、广告词、品牌文案"
        },
        "image": "图片生成",
        "video": "视频生成",
        "audio": "音频参考",
        "config": {
          "title": "配置节点",
          "description": "模型、尺寸、数量和输入顺序"
        }
      },
      "confirmations": {
        "continueGeneration": "继续生成",
        "stopWaiting": {
          "title": "停止等待？",
          "description": "这只会停止当前页面等待，不会取消上游任务；稍后仍可恢复查询。",
          "confirm": "停止"
        },
        "cancelGeneration": {
          "title": "取消生成任务？",
          "description": "取消会提交给上游；只有上游确认后任务才会变为已取消。",
          "confirm": "取消任务"
        }
      },
      "errors": {
        "taskCancelled": "任务已取消",
        "configConnection": "配置节点之间不能连接",
        "emptySaveText": "没有可保存的文本",
        "emptySaveVideo": "没有可保存的视频",
        "emptySaveImage": "没有可保存的图片",
        "emptyImageForReversePrompt": "图片节点为空，无法反推提示词",
        "maskEditFailed": "局部修改失败",
        "generationFailed": "生成失败",
        "videoTaskCreateFailed": "视频任务创建失败",
        "retryPromptMissing": "找不到提示词，无法重试",
        "retryReferenceMissing": "参考图片已丢失，无法继续重试",
        "imageGenerationTimeout": "图片生成超时，请稍后重试",
        "imageGenerationFailed": "图片生成失败",
        "videoResultEmpty": "视频结果为空",
        "videoFileUnavailable": "视频文件不可用",
        "videoGenerationFailed": "视频生成失败",
        "videoGenerationTimeout": "视频生成超时，请稍后重试",
        "emptyTextForImage": "文本节点为空，无法生图",
        "assetImageUnavailable": "素材图片暂时不可用，请刷新后重试",
        "generationInterrupted": "页面刷新后生成已中断，请重新生成。"
      },
      "files": {
        "clipboardImageName": "剪切板图片.png",
        "downloadName": "canvas-{{type}}-{{id}}.{{extension}}"
      },
      "messages": {
        "clipboardImageAdded": "已从剪切板添加图片",
        "clipboardTextAdded": "已从剪切板添加文本",
        "assetSaved": "已加入我的素材",
        "imageSplit_one": "已切分为 {{value}} 个子节点",
        "imageSplit_other": "已切分为 {{value}} 个子节点"
      },
      "nodes": {
        "copySuffix": " 副本",
        "copyTitle": "{{title}} 副本",
        "clipboardText": "剪切板文本",
        "canvasText": "画布文本",
        "canvasVideo": "画布视频",
        "canvasImage": "画布图片",
        "reversePrompt": "反推提示词",
        "reversePromptConfig": "反推提示词配置",
        "croppedImage": "裁剪图片",
        "splitImageTitle": "{{title}} {{row}}-{{column}}",
        "maskEditResult": "局部编辑结果",
        "upscaledImage": "放大图片",
        "generatedImage": "生成图片",
        "prompt": "提示词",
        "generatedVideo": "生成视频",
        "generatedAudio": "生成音频",
        "generatedText": "生成文本",
        "assistantText": "助手文本"
      },
      "prompts": {
        "reverseImage": "请根据参考图片反推一段适合用于 AI 生图的提示词。\n\n要求：\n1. 只输出提示词正文，不要解释。\n2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。\n3. 尽量写成可直接用于生图模型的完整提示词。",
        "reverseComposer": "参考图片：@[node:{{imageNodeId}}]\n任务说明：@[node:{{instructionNodeId}}]",
        "maskEdit": "只修改蒙版透明区域，其他区域保持不变。{{prompt}}",
        "editText": "请根据要求修改以下文本。\n\n原文：\n{{sourceText}}\n\n修改要求：\n{{prompt}}",
        "angle": "基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。{{angle}}。"
      },
      "modals": {
        "superResolution": {
          "title": "AI 超分",
          "unavailable": "暂未实现"
        },
        "imagePreview": {
          "title": "图片详情"
        },
        "clear": {
          "title": "清空画布？",
          "cancel": "取消",
          "confirm": "清空",
          "description": "这会删除当前画布上的所有节点和连线。"
        }
      },
      "topbar": {
        "openMenu": "打开画布菜单",
        "renameHint": "双击修改画布名称",
        "agent": "Agent",
        "menu": {
          "home": "主页",
          "docs": "文档",
          "projects": "我的画布",
          "new": "新建画布",
          "delete": "删除当前画布",
          "import": "导入素材",
          "undo": "撤销",
          "redo": "重做"
        }
      },
      "agent": {
        "connected": "已连接到本地 Codex",
        "connecting": "连接中",
        "starting": "正在连接本地 Codex",
        "openPanel": "打开本地 Codex 面板"
      },
      "angle": {
        "horizontal": {
          "front": "正面视角",
          "right": "向右旋转 {{value}}°",
          "left": "向左旋转 {{value}}°"
        },
        "pitch": {
          "level": "水平视角",
          "down": "俯视 {{value}}°",
          "up": "仰视 {{value}}°"
        },
        "lens": {
          "wide": "广角",
          "standard": "标准"
        },
        "label": "AI 多角度：{{horizontal}}，{{pitch}}，镜头距离 {{distance}}，{{lens}}镜头"
      }
    }
  }
}
```

## en-US 资源

```json
{
  "canvas": {
    "nodeTypes": {
      "image": "Image",
      "text": "Text",
      "config": "Configuration",
      "video": "Video",
      "audio": "Audio"
    },
    "library": {
      "states": {
        "loading": "Loading...",
        "opening": "Opening canvas...",
        "loadingProjects": "Loading canvases..."
      },
      "header": {
        "eyebrow": "Canvas library",
        "title": "Infinite Canvas"
      },
      "actions": {
        "exportSelected": "Export selected",
        "deleteSelected": "Delete selected",
        "deleteAll": "Delete all",
        "import": "Import canvas",
        "create": "New canvas"
      },
      "messages": {
        "importSuccess_one": "Imported {{value}} canvas",
        "importSuccess_other": "Imported {{value}} canvases"
      },
      "errors": {
        "importFailed": "Import failed. Select a valid canvas archive."
      },
      "empty": {
        "title": "No canvases yet",
        "description": "Create a canvas to save its nodes, connections, and appearance independently."
      },
      "project": {
        "defaultTitle": "Infinite Canvas {{index}}",
        "selectedExportFileName_one": "infinite-canvas-{{value}}-project",
        "selectedExportFileName_other": "infinite-canvas-{{value}}-projects",
        "selectLabel": "Select {{title}}",
        "nodeCount_one": "{{value}} node",
        "nodeCount_other": "{{value}} nodes",
        "connectionCount_one": "{{value}} connection",
        "connectionCount_other": "{{value}} connections",
        "updatedAt": "Updated {{time}}",
        "actions": {
          "saveName": "Save name",
          "cancelRename": "Cancel rename",
          "export": "Export",
          "rename": "Rename",
          "delete": "Delete"
        }
      },
      "deleteDialog": {
        "title": "Delete canvases?",
        "cancel": "Cancel",
        "confirm": "Delete",
        "description_one": "Delete {{value}} canvas? Its nodes and connections will also be removed.",
        "description_other": "Delete {{value}} canvases? Their nodes and connections will also be removed."
      }
    },
    "toolbar": {
      "tools": {
        "hand": "Move/select",
        "undo": "Undo",
        "redo": "Redo",
        "text": "Text",
        "image": "Image",
        "video": "Video",
        "audio": "Audio",
        "config": "Generation settings",
        "upload": "Upload media",
        "assets": "My assets",
        "appearance": "Canvas appearance",
        "deleteSelected": "Delete selected",
        "clear": "Clear canvas"
      },
      "appearance": {
        "title": "Canvas appearance",
        "themeMode": "Theme mode",
        "light": "Light",
        "dark": "Dark",
        "gridStyle": "Grid style",
        "dots": "Dots",
        "lines": "Lines",
        "blank": "Blank",
        "imageInfo": "Image information",
        "switchTheme": "Switch to {{theme}} theme"
      }
    },
    "zoom": {
      "minimap": {
        "open": "Open minimap",
        "close": "Close minimap"
      },
      "reset": "Reset view",
      "scale": "Zoom canvas"
    },
    "shortcuts": {
      "title": "Keyboard shortcuts",
      "gestures": {
        "dragCanvas": "Drag canvas",
        "wheel": "Mouse wheel",
        "drag": "Drag",
        "click": "Click",
        "zoomSlider": "Zoom slider",
        "dropMedia": "Drop image, video, or audio"
      },
      "actions": {
        "pan": "Pan view",
        "zoom": "Zoom canvas",
        "preciseZoom": "Adjust zoom precisely",
        "boxSelect": "Select multiple nodes",
        "addSelection": "Add nodes to selection",
        "selectAll": "Select all nodes",
        "copyPaste": "Copy / paste nodes",
        "copyPasteClipboard": "Copy / paste nodes or paste clipboard text/images",
        "undo": "Undo",
        "redo": "Redo",
        "deleteSelection": "Delete selected",
        "cancelOverlays": "Clear selection and close overlays",
        "upload": "Upload to canvas"
      }
    },
    "contextMenu": {
      "duplicate": "Duplicate",
      "delete": "Delete"
    },
    "overview": {
      "label": "Canvas overview",
      "expand": "Expand overview sidebar",
      "collapse": "Collapse overview sidebar",
      "tabs": {
        "label": "Overview type",
        "canvas": "Canvas",
        "assets": "Assets"
      },
      "search": {
        "placeholder": "Search nodes",
        "ariaLabel": "Search Canvas nodes"
      },
      "type": {
        "all": "All types",
        "label": "Node type"
      },
      "listLabel": "Canvas node list",
      "batchResults_one": " · {{value}} result",
      "batchResults_other": " · {{value}} results",
      "empty": "No matching nodes",
      "videoPreview": "{{title}} preview",
      "status": {
        "processing": "Processing",
        "failed": "Failed",
        "completed": "Completed",
        "ready": "Ready"
      }
    },
    "editor": {
      "project": {
        "untitled": "Untitled canvas",
        "imported": "Imported canvas"
      },
      "connectionCreate": {
        "title": "Generate from this node",
        "close": "Close",
        "text": {
          "title": "Generate text",
          "description": "Scripts, ad copy, and brand content"
        },
        "image": "Generate image",
        "video": "Generate video",
        "audio": "Audio reference",
        "config": {
          "title": "Configuration node",
          "description": "Model, dimensions, quantity, and input order"
        }
      },
      "confirmations": {
        "continueGeneration": "Continue generating",
        "stopWaiting": {
          "title": "Stop waiting?",
          "description": "This only stops waiting on this page. It does not cancel the upstream task, and you can resume polling later.",
          "confirm": "Stop"
        },
        "cancelGeneration": {
          "title": "Cancel generation task?",
          "description": "The cancellation request will be sent upstream. The task is cancelled only after the upstream service confirms it.",
          "confirm": "Cancel task"
        }
      },
      "errors": {
        "taskCancelled": "Task cancelled",
        "configConnection": "Configuration nodes cannot be connected to each other",
        "emptySaveText": "There is no text to save",
        "emptySaveVideo": "There is no video to save",
        "emptySaveImage": "There is no image to save",
        "emptyImageForReversePrompt": "This image node is empty, so a prompt cannot be reverse-engineered",
        "maskEditFailed": "Masked edit failed",
        "generationFailed": "Generation failed",
        "videoTaskCreateFailed": "Failed to create the video task",
        "retryPromptMissing": "No prompt was found for this retry",
        "retryReferenceMissing": "The reference image is missing, so this retry cannot continue",
        "imageGenerationTimeout": "Image generation timed out. Try again later.",
        "imageGenerationFailed": "Image generation failed",
        "videoResultEmpty": "The video result is empty",
        "videoFileUnavailable": "The video file is unavailable",
        "videoGenerationFailed": "Video generation failed",
        "videoGenerationTimeout": "Video generation timed out. Try again later.",
        "emptyTextForImage": "This text node is empty, so an image cannot be generated",
        "assetImageUnavailable": "The asset image is temporarily unavailable. Refresh and try again.",
        "generationInterrupted": "Generation was interrupted by the page refresh. Generate again."
      },
      "files": {
        "clipboardImageName": "clipboard-image.png",
        "downloadName": "canvas-{{type}}-{{id}}.{{extension}}"
      },
      "messages": {
        "clipboardImageAdded": "Image added from the clipboard",
        "clipboardTextAdded": "Text added from the clipboard",
        "assetSaved": "Added to My Assets",
        "imageSplit_one": "Split into {{value}} child node",
        "imageSplit_other": "Split into {{value}} child nodes"
      },
      "nodes": {
        "copySuffix": " Copy",
        "copyTitle": "{{title}} Copy",
        "clipboardText": "Clipboard text",
        "canvasText": "Canvas text",
        "canvasVideo": "Canvas video",
        "canvasImage": "Canvas image",
        "reversePrompt": "Reverse-engineered prompt",
        "reversePromptConfig": "Reverse prompt configuration",
        "croppedImage": "Cropped image",
        "splitImageTitle": "{{title}} {{row}}-{{column}}",
        "maskEditResult": "Masked edit result",
        "upscaledImage": "Upscaled image",
        "generatedImage": "Generated image",
        "prompt": "Prompt",
        "generatedVideo": "Generated video",
        "generatedAudio": "Generated audio",
        "generatedText": "Generated text",
        "assistantText": "Assistant text"
      },
      "prompts": {
        "reverseImage": "Analyze the reference image and produce a prompt suitable for AI image generation.\n\nRequirements:\n1. Output only the prompt, with no explanation.\n2. Cover the subject, composition, style, lighting, color, materials, camera, and atmosphere.\n3. Write a complete prompt that can be used directly with an image generation model.",
        "reverseComposer": "Reference image: @[node:{{imageNodeId}}]\nTask instructions: @[node:{{instructionNodeId}}]",
        "maskEdit": "Modify only the transparent area of the mask and keep every other area unchanged. {{prompt}}",
        "editText": "Revise the following text according to the instructions.\n\nOriginal text:\n{{sourceText}}\n\nRevision instructions:\n{{prompt}}",
        "angle": "Generate a new view of the same subject from the reference image. Keep the subject, colors, materials, and visual style consistent instead of applying only a perspective transform. {{angle}}."
      },
      "modals": {
        "superResolution": {
          "title": "AI super resolution",
          "unavailable": "Not implemented yet"
        },
        "imagePreview": {
          "title": "Image details"
        },
        "clear": {
          "title": "Clear canvas?",
          "cancel": "Cancel",
          "confirm": "Clear",
          "description": "This deletes every node and connection on the current canvas."
        }
      },
      "topbar": {
        "openMenu": "Open canvas menu",
        "renameHint": "Double-click to rename the canvas",
        "agent": "Agent",
        "menu": {
          "home": "Home",
          "docs": "Documentation",
          "projects": "My canvases",
          "new": "New canvas",
          "delete": "Delete current canvas",
          "import": "Import media",
          "undo": "Undo",
          "redo": "Redo"
        }
      },
      "agent": {
        "connected": "Connected to local Codex",
        "connecting": "Connecting",
        "starting": "Connecting to local Codex",
        "openPanel": "Open local Codex panel"
      },
      "angle": {
        "horizontal": {
          "front": "Front view",
          "right": "Rotate {{value}}° right",
          "left": "Rotate {{value}}° left"
        },
        "pitch": {
          "level": "Level view",
          "down": "Tilt down {{value}}°",
          "up": "Tilt up {{value}}°"
        },
        "lens": {
          "wide": "wide-angle",
          "standard": "standard"
        },
        "label": "AI multi-angle: {{horizontal}}, {{pitch}}, camera distance {{distance}}, {{lens}} lens"
      }
    }
  }
}
```

## 验证

- `bun test src/pages/canvas/stores/canvas-replica.test.mjs src/pages/canvas/components/canvas-generation-resume.test.mjs src/pages/canvas/components/canvas-overview.test.mjs src/pages/canvas/components/canvas-image-background.test.mjs`
  - 9 pass, 0 fail。
- `bunx tsc --noEmit`
  - 通过。
- `git diff --check`
  - 通过。
- locale 资源校验
  - 两个文档 JSON 块均通过 `jq empty`。
  - `zh-CN` / `en-US` 各 206 个叶子 key，集合完全对称。
- 用户可见硬编码扫描
  - 限定文件内不再存在中文 UI 文案。
  - 保留一条中文代码注释；取消判断使用全局 `errors.requestCancelled`。
  - `Ctrl / Cmd`、`Delete / Backspace`、`Esc`、节点类型值、任务状态值、MIME、API source 和品牌名按协议/产品值保留。
- 本子任务未运行全量 `bun run build`，由主代理合并全部 locale 资源后统一执行。

## 主代理接入注意

1. 合并上方两份 `canvas` 资源，保持叶子 key 对称。
2. 合并后确认 `_one` / `_other` 复数 key 均存在。
3. locale 合并后重新执行 `cd web && bun run build`。
4. 浏览器切换 `zh-CN` / `en-US`，重点冒烟：项目新建/导入/删除、项目卡片日期与计数、总览筛选、工具栏外观、快捷键弹窗、默认节点标题、错误 Toast、图片反推提示词和多角度提示词。
