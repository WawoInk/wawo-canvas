# Canvas 节点、设置、生成与素材组件国际化

## 范围与约束

- 仅迁移已分配的 Canvas 节点、设置、生成、素材选择和导出组件。
- 未修改 locale JSON、`project/index.tsx`、`canvas/index.tsx`、Agent/Assistant 文件、共享 store 或协议合同。
- 节点类型、生成状态、模型 ID、task ID、角色枚举、工具 ID、文件 MIME、用户内容和服务端原始消息保持不变。
- React 组件使用 `useTranslation()`；非 React 的生成校验与导出使用共享 `i18n.t()`。
- 数量使用 i18next plural；尺寸、像素、位置和索引使用现有 `Intl.NumberFormat` formatter。
- 遮罩编辑错误保存稳定错误码，渲染时翻译，切换语言后不会残留旧语言错误。

## 修改文件

### 业务代码

- `web/src/pages/canvas/components/asset-picker-modal.tsx`
- `web/src/pages/canvas/components/canvas-config-composer.tsx`
- `web/src/pages/canvas/components/canvas-config-node-panel.tsx`
- `web/src/pages/canvas/components/canvas-image-settings-popover.tsx`
- `web/src/pages/canvas/components/canvas-image-toolbar-settings-modal.tsx`
- `web/src/pages/canvas/components/canvas-image-toolbar-tools.tsx`
- `web/src/pages/canvas/components/canvas-node-angle-dialog.tsx`
- `web/src/pages/canvas/components/canvas-node-crop-dialog.tsx`
- `web/src/pages/canvas/components/canvas-node-generation.ts`
- `web/src/pages/canvas/components/canvas-node-hover-toolbar.tsx`
- `web/src/pages/canvas/components/canvas-node-mask-edit-dialog.tsx`
- `web/src/pages/canvas/components/canvas-node-prompt-panel.tsx`
- `web/src/pages/canvas/components/canvas-node-split-dialog.tsx`
- `web/src/pages/canvas/components/canvas-node-upscale-dialog.tsx`
- `web/src/pages/canvas/components/canvas-node.tsx`
- `web/src/pages/canvas/components/canvas-prompt-chip-editor.tsx`
- `web/src/pages/canvas/components/canvas-prompt-library.tsx`
- `web/src/pages/canvas/components/canvas-size-picker.tsx`
- `web/src/pages/canvas/utils/canvas-export.ts`

### 测试

- `web/src/pages/canvas/components/canvas-node-generation.test.mjs`
- `web/src/pages/canvas/components/canvas-prompt-chip-editor-expand.test.tsx`

## zh-CN key

以下片段应合并到 `zh-CN.json` 根对象。复数键保留 `_one` / `_other`，由代码使用不带后缀的基础 key 调用。

```json
{
  "canvas": {
    "actions": {
      "aiGenerate": "AI 生成",
      "cancel": "取消",
      "cancelGenerationTask": "取消生成任务",
      "cancelTask": "取消任务",
      "generate": "生成",
      "reset": "重置",
      "resumeQuery": "恢复查询",
      "retry": "重试",
      "save": "保存",
      "startGeneration": "开始生成",
      "stop": "停止",
      "stopWaiting": "停止等待"
    },
    "common": {
      "reading": "读取中",
      "unknown": "未知"
    },
    "counts": {
      "items_one": "{{value}} 个",
      "items_other": "{{value}} 个",
      "images_one": "{{value}} 张",
      "images_other": "{{value}} 张",
      "videos_one": "{{value}} 个",
      "videos_other": "{{value}} 个",
      "audios_one": "{{value}} 个",
      "audios_other": "{{value}} 个",
      "nodes_one": "{{value}} 个",
      "nodes_other": "{{value}} 个"
    },
    "units": {
      "degreeSuffix": "°",
      "pixelDimensions": "{{value}} px",
      "pixelValue": "{{value}} px"
    },
    "assets": {
      "picker": {
        "title": "选择素材",
        "searchPlaceholder": "搜索素材",
        "empty": "没有素材",
        "insert": "插入",
        "previewAria": "{{title}}预览",
        "filters": {
          "all": "全部",
          "text": "文本",
          "image": "图片",
          "video": "视频"
        }
      }
    },
    "composer": {
      "title": "组装提示词",
      "hint": "@ 引用已连接素材，发送前按当前连接重新编号",
      "placeholder": "输入提示词，按 @ 引用连接的图片或文本",
      "imagePreviewAlt": "引用图片预览"
    },
    "resources": {
      "labels": {
        "text": "文本{{index}}",
        "image": "图片{{index}}",
        "video": "视频{{index}}",
        "audio": "音频{{index}}"
      }
    },
    "models": {
      "legacySelection": "旧模型：{{model}}（请重新选择）"
    },
    "configNode": {
      "title": "生成配置",
      "modes": {
        "image": "生图",
        "text": "文本",
        "video": "视频",
        "audio": "音频"
      },
      "inputs": {
        "prompt": "提示词",
        "referenceImage": "参考图",
        "referenceVideo": "参考视频",
        "referenceAudio": "参考音频"
      }
    },
    "prompts": {
      "library": "提示词库"
    },
    "settings": {
      "aspectRatioPlaceholder": "比例"
    },
    "promptEditor": {
      "promptAria": "提示词",
      "resourcesAria": "资源",
      "expand": "放大输入框",
      "collapse": "缩小输入框"
    },
    "promptPanel": {
      "placeholders": {
        "video": "描述要生成的视频内容",
        "audio": "描述要生成的音频内容",
        "imageEdit": "请输入你想要把这张图修改成什么",
        "imageGenerate": "描述要生成的图片内容",
        "textEdit": "请输入你想要将本段文本修改成什么",
        "textGenerate": "请输入你想要生成的文本内容"
      },
      "shortDrama": {
        "assetsTitle": "短剧资产角色",
        "missingRole": "缺少角色",
        "roleAria": "{{title}}角色",
        "selectRole": "选择角色",
        "roles": {
          "character": "角色",
          "scene": "场景",
          "tool": "道具"
        }
      }
    },
    "toolbar": {
      "messages": {
        "noPrompt": "暂无可复制的提示词",
        "promptCopied": "提示词已复制"
      },
      "settings": {
        "title": "自定义工具栏",
        "showLabels": "显示按钮文字",
        "description": "选择你想在图片节点编辑栏中使用的快捷工具。",
        "previewTitle": "节点预览",
        "previewNode": "图片节点",
        "toolsLabel": "快捷工具",
        "moreTitle": "配置快捷工具",
        "moreLabel": "更多"
      },
      "actions": {
        "info": {
          "title": "查看节点信息",
          "label": "信息"
        },
        "delete": {
          "title": "移除节点",
          "label": "删除"
        },
        "retry": {
          "title": "重新生成",
          "label": "重试"
        },
        "saveAsset": {
          "title": "加入我的素材",
          "label": "存素材"
        },
        "download": {
          "label": "下载",
          "image": "下载图片",
          "video": "下载视频",
          "audio": "下载音频"
        },
        "edit": {
          "title": "编辑",
          "label": "编辑"
        },
        "editText": {
          "title": "编辑文本",
          "label": "编辑文字"
        },
        "generateImage": {
          "title": "用文本生图",
          "label": "生图"
        },
        "config": {
          "title": "生成配置",
          "label": "生成配置"
        },
        "decreaseFont": {
          "title": "减小字号",
          "label": "缩小"
        },
        "increaseFont": {
          "title": "增大字号",
          "label": "放大"
        },
        "upload": {
          "image": "上传图片",
          "video": "上传视频",
          "audio": "上传音频"
        },
        "replace": {
          "video": "替换视频",
          "audio": "替换音频"
        }
      },
      "imageTools": {
        "copyPrompt": {
          "label": "复制提示词",
          "title": "复制生成该图片的提示词"
        },
        "reversePrompt": {
          "label": "反推提示词",
          "title": "创建反推提示词的文本和配置节点"
        },
        "replace": {
          "label": "替换图片",
          "title": "替换图片"
        },
        "resize": {
          "lockedLabel": "锁比例",
          "freeLabel": "自由比例",
          "toLockedTitle": "切换为等比缩放",
          "toFreeTitle": "切换为自由比例"
        },
        "maskEdit": {
          "label": "局部编辑",
          "title": "添加蒙版遮罩后局部修改"
        },
        "crop": {
          "label": "裁剪",
          "title": "裁剪并生成新节点"
        },
        "split": {
          "label": "切图",
          "title": "按行列切分图片"
        },
        "upscale": {
          "label": "放大",
          "title": "放大图片分辨率"
        },
        "superResolve": {
          "label": "超分",
          "title": "AI 超分"
        },
        "angle": {
          "label": "多角度",
          "title": "生成角度"
        },
        "view": {
          "label": "查看大图",
          "title": "查看图片详情"
        }
      }
    },
    "node": {
      "unknown": "未知节点",
      "errors": {
        "generationFailed": "生成失败"
      },
      "placeholders": {
        "editText": "双击编辑文字",
        "emptyImage": "空图片节点",
        "emptyVideo": "空视频节点",
        "emptyAudio": "空音频节点"
      },
      "defaultTitles": {
        "audio": "音频"
      },
      "batch": {
        "expanded": "图片组已展开",
        "collapsed": "图片组已收起"
      },
      "actions": {
        "setPrimary": "设为主图"
      },
      "types": {
        "text": "文本",
        "image": "图片",
        "config": "生成配置",
        "video": "视频",
        "audio": "音频"
      },
      "status": {
        "idle": "就绪",
        "success": "已完成",
        "loading": "处理中",
        "error": "失败"
      },
      "info": {
        "title": "节点信息",
        "base64ImagePlaceholder": "[base64 图片]",
        "positionValue": "{{x}}, {{y}}",
        "tabs": {
          "info": "信息",
          "json": "JSON"
        },
        "fields": {
          "id": "ID",
          "type": "类型",
          "size": "尺寸",
          "position": "位置",
          "status": "状态",
          "batch": "图片组",
          "prompt": "提示词",
          "imageSize": "图片大小"
        }
      }
    },
    "angle": {
      "title": "AI 多角度",
      "description": "左侧只预览方向，结果会基于原图重新生成",
      "horizontal": "左右角度",
      "pitch": "俯仰角度",
      "distance": "镜头距离",
      "wideAngle": "广角镜头",
      "standard": "标准",
      "wide": "广角"
    },
    "crop": {
      "title": "裁剪图片",
      "resizeAria": "调整裁剪框",
      "cropSize": "裁剪尺寸 {{value}}",
      "ratio": "比例 {{value}}",
      "originalSize": "原图 {{value}}",
      "lockedRatio": "锁定比例",
      "freeRatio": "自由比例",
      "confirm": "确认裁剪"
    },
    "maskEdit": {
      "title": "局部遮罩编辑",
      "paint": "画笔",
      "erase": "擦除",
      "brushSize": "笔刷大小",
      "request": "修改要求",
      "placeholder": "例如：把选中区域改成金属材质，保持原图光影",
      "apply": "AI 修改",
      "errors": {
        "promptRequired": "请输入修改要求",
        "maskRequired": "请先涂抹局部区域"
      }
    },
    "split": {
      "title": "切分图片",
      "description_one": "生成 {{value}} 个图片子节点，并按原图网格排列到画布右侧",
      "description_other": "生成 {{value}} 个图片子节点，并按原图网格排列到画布右侧",
      "original": "原图",
      "rows": "行数",
      "columns": "列数",
      "childNodes": "子节点",
      "approxPiece": "单块约",
      "generate": "生成子节点"
    },
    "upscale": {
      "title": "图片放大",
      "source": "源图",
      "targetPixels": "目标像素",
      "algorithm": "放大算法",
      "outputSize": "输出尺寸",
      "generate": "生成放大图",
      "errors": {
        "reachedMax": "图片已达到 4K，无需放大",
        "reachedTarget": "图片已达到当前目标像素，无需放大"
      },
      "algorithms": {
        "high": {
          "title": "高清插值",
          "description": "适合照片和细节图"
        },
        "bilinear": {
          "title": "双线性",
          "description": "平滑、速度快"
        },
        "nearest": {
          "title": "最近邻",
          "description": "适合像素风格"
        }
      }
    },
    "generation": {
      "errors": {
        "resourceNotUploaded": "素材「{{name}}」尚未上传到平台文件库",
        "shortDramaTitleRequired": "请输入短剧标题",
        "shortDramaScriptRequired": "请输入短剧脚本",
        "shortDramaAssetRequired": "请连接至少一张短剧资产图片",
        "shortDramaRoleRequired": "请为图片「{{name}}」选择角色",
        "imageNotUploaded": "图片「{{name}}」尚未上传到平台文件库"
      }
    },
    "export": {
      "defaultFileName": "无限画布"
    }
  }
}
```

## en-US key

以下片段应合并到 `en-US.json` 根对象。

```json
{
  "canvas": {
    "actions": {
      "aiGenerate": "Generate with AI",
      "cancel": "Cancel",
      "cancelGenerationTask": "Cancel generation task",
      "cancelTask": "Cancel Task",
      "generate": "Generate",
      "reset": "Reset",
      "resumeQuery": "Resume Status",
      "retry": "Retry",
      "save": "Save",
      "startGeneration": "Start Generation",
      "stop": "Stop",
      "stopWaiting": "Stop Waiting"
    },
    "common": {
      "reading": "Loading",
      "unknown": "Unknown"
    },
    "counts": {
      "items_one": "{{value}} item",
      "items_other": "{{value}} items",
      "images_one": "{{value}} image",
      "images_other": "{{value}} images",
      "videos_one": "{{value}} video",
      "videos_other": "{{value}} videos",
      "audios_one": "{{value}} audio file",
      "audios_other": "{{value}} audio files",
      "nodes_one": "{{value}} node",
      "nodes_other": "{{value}} nodes"
    },
    "units": {
      "degreeSuffix": "°",
      "pixelDimensions": "{{value}} px",
      "pixelValue": "{{value}} px"
    },
    "assets": {
      "picker": {
        "title": "Select Asset",
        "searchPlaceholder": "Search assets",
        "empty": "No assets",
        "insert": "Insert",
        "previewAria": "{{title}} preview",
        "filters": {
          "all": "All",
          "text": "Text",
          "image": "Image",
          "video": "Video"
        }
      }
    },
    "composer": {
      "title": "Compose Prompt",
      "hint": "Use @ to reference connected assets. References are renumbered from the current connections before generation.",
      "placeholder": "Enter a prompt and use @ to reference connected images or text",
      "imagePreviewAlt": "Referenced image preview"
    },
    "resources": {
      "labels": {
        "text": "Text {{index}}",
        "image": "Image {{index}}",
        "video": "Video {{index}}",
        "audio": "Audio {{index}}"
      }
    },
    "models": {
      "legacySelection": "Legacy model: {{model}} (select a new model)"
    },
    "configNode": {
      "title": "Generation Config",
      "modes": {
        "image": "Image",
        "text": "Text",
        "video": "Video",
        "audio": "Audio"
      },
      "inputs": {
        "prompt": "Prompts",
        "referenceImage": "Reference Images",
        "referenceVideo": "Reference Videos",
        "referenceAudio": "Reference Audio"
      }
    },
    "prompts": {
      "library": "Prompt Library"
    },
    "settings": {
      "aspectRatioPlaceholder": "Aspect ratio"
    },
    "promptEditor": {
      "promptAria": "Prompt",
      "resourcesAria": "Resources",
      "expand": "Expand prompt editor",
      "collapse": "Collapse prompt editor"
    },
    "promptPanel": {
      "placeholders": {
        "video": "Describe the video you want to generate",
        "audio": "Describe the audio you want to generate",
        "imageEdit": "Describe how you want to edit this image",
        "imageGenerate": "Describe the image you want to generate",
        "textEdit": "Describe how you want to revise this text",
        "textGenerate": "Describe the text you want to generate"
      },
      "shortDrama": {
        "assetsTitle": "Short Drama Asset Roles",
        "missingRole": "Role required",
        "roleAria": "Role for {{title}}",
        "selectRole": "Select role",
        "roles": {
          "character": "Character",
          "scene": "Scene",
          "tool": "Prop"
        }
      }
    },
    "toolbar": {
      "messages": {
        "noPrompt": "No prompt is available to copy",
        "promptCopied": "Prompt copied"
      },
      "settings": {
        "title": "Customize Toolbar",
        "showLabels": "Show button labels",
        "description": "Choose the quick tools to show in the image node editor.",
        "previewTitle": "Node Preview",
        "previewNode": "Image Node",
        "toolsLabel": "Quick Tools",
        "moreTitle": "Configure quick tools",
        "moreLabel": "More"
      },
      "actions": {
        "info": {
          "title": "View node information",
          "label": "Info"
        },
        "delete": {
          "title": "Remove node",
          "label": "Delete"
        },
        "retry": {
          "title": "Generate again",
          "label": "Retry"
        },
        "saveAsset": {
          "title": "Add to My Assets",
          "label": "Save Asset"
        },
        "download": {
          "label": "Download",
          "image": "Download image",
          "video": "Download video",
          "audio": "Download audio"
        },
        "edit": {
          "title": "Edit",
          "label": "Edit"
        },
        "editText": {
          "title": "Edit text",
          "label": "Edit Text"
        },
        "generateImage": {
          "title": "Generate an image from text",
          "label": "Image"
        },
        "config": {
          "title": "Generation config",
          "label": "Config"
        },
        "decreaseFont": {
          "title": "Decrease font size",
          "label": "Smaller"
        },
        "increaseFont": {
          "title": "Increase font size",
          "label": "Larger"
        },
        "upload": {
          "image": "Upload image",
          "video": "Upload video",
          "audio": "Upload audio"
        },
        "replace": {
          "video": "Replace video",
          "audio": "Replace audio"
        }
      },
      "imageTools": {
        "copyPrompt": {
          "label": "Copy Prompt",
          "title": "Copy the prompt used to generate this image"
        },
        "reversePrompt": {
          "label": "Reverse Prompt",
          "title": "Create text and config nodes to reverse-engineer the image prompt"
        },
        "replace": {
          "label": "Replace Image",
          "title": "Replace image"
        },
        "resize": {
          "lockedLabel": "Lock Ratio",
          "freeLabel": "Free Ratio",
          "toLockedTitle": "Switch to proportional resizing",
          "toFreeTitle": "Switch to free resizing"
        },
        "maskEdit": {
          "label": "Local Edit",
          "title": "Paint a mask and edit part of the image"
        },
        "crop": {
          "label": "Crop",
          "title": "Crop and create a new node"
        },
        "split": {
          "label": "Split",
          "title": "Split the image by rows and columns"
        },
        "upscale": {
          "label": "Upscale",
          "title": "Increase image resolution"
        },
        "superResolve": {
          "label": "Super Resolution",
          "title": "AI super resolution"
        },
        "angle": {
          "label": "Angles",
          "title": "Generate new camera angles"
        },
        "view": {
          "label": "View Full Image",
          "title": "View image details"
        }
      }
    },
    "node": {
      "unknown": "Unknown node",
      "errors": {
        "generationFailed": "Generation failed"
      },
      "placeholders": {
        "editText": "Double-click to edit text",
        "emptyImage": "Empty image node",
        "emptyVideo": "Empty video node",
        "emptyAudio": "Empty audio node"
      },
      "defaultTitles": {
        "audio": "Audio"
      },
      "batch": {
        "expanded": "Image group expanded",
        "collapsed": "Image group collapsed"
      },
      "actions": {
        "setPrimary": "Set as Primary"
      },
      "types": {
        "text": "Text",
        "image": "Image",
        "config": "Generation Config",
        "video": "Video",
        "audio": "Audio"
      },
      "status": {
        "idle": "Ready",
        "success": "Completed",
        "loading": "Processing",
        "error": "Failed"
      },
      "info": {
        "title": "Node Information",
        "base64ImagePlaceholder": "[base64 image]",
        "positionValue": "{{x}}, {{y}}",
        "tabs": {
          "info": "Info",
          "json": "JSON"
        },
        "fields": {
          "id": "ID",
          "type": "Type",
          "size": "Size",
          "position": "Position",
          "status": "Status",
          "batch": "Image Group",
          "prompt": "Prompt",
          "imageSize": "Image Size"
        }
      }
    },
    "angle": {
      "title": "AI Camera Angles",
      "description": "The left side previews direction only. The result is regenerated from the source image.",
      "horizontal": "Horizontal",
      "pitch": "Pitch",
      "distance": "Camera Distance",
      "wideAngle": "Wide-angle Lens",
      "standard": "Standard",
      "wide": "Wide"
    },
    "crop": {
      "title": "Crop Image",
      "resizeAria": "Resize crop box",
      "cropSize": "Crop size: {{value}}",
      "ratio": "Ratio: {{value}}",
      "originalSize": "Original: {{value}}",
      "lockedRatio": "Locked Ratio",
      "freeRatio": "Free Ratio",
      "confirm": "Confirm Crop"
    },
    "maskEdit": {
      "title": "Local Mask Edit",
      "paint": "Brush",
      "erase": "Erase",
      "brushSize": "Brush Size",
      "request": "Edit Request",
      "placeholder": "For example: change the selected area to metal while preserving the original lighting",
      "apply": "Apply AI Edit",
      "errors": {
        "promptRequired": "Enter an edit request",
        "maskRequired": "Paint the area you want to edit first"
      }
    },
    "split": {
      "title": "Split Image",
      "description_one": "Generate {{value}} image child node and arrange it to the right of the canvas using the source grid.",
      "description_other": "Generate {{value}} image child nodes and arrange them to the right of the canvas using the source grid.",
      "original": "Original",
      "rows": "Rows",
      "columns": "Columns",
      "childNodes": "Child Nodes",
      "approxPiece": "Approx. per Piece",
      "generate": "Generate Child Nodes"
    },
    "upscale": {
      "title": "Upscale Image",
      "source": "Source",
      "targetPixels": "Target Pixels",
      "algorithm": "Upscaling Algorithm",
      "outputSize": "Output Size",
      "generate": "Generate Upscaled Image",
      "errors": {
        "reachedMax": "The image is already 4K and does not need upscaling",
        "reachedTarget": "The image already meets the selected target size"
      },
      "algorithms": {
        "high": {
          "title": "High-quality Interpolation",
          "description": "Best for photos and detailed images"
        },
        "bilinear": {
          "title": "Bilinear",
          "description": "Smooth and fast"
        },
        "nearest": {
          "title": "Nearest Neighbor",
          "description": "Best for pixel art"
        }
      }
    },
    "generation": {
      "errors": {
        "resourceNotUploaded": "Asset \"{{name}}\" has not been uploaded to the platform file library",
        "shortDramaTitleRequired": "Enter a short drama title",
        "shortDramaScriptRequired": "Enter a short drama script",
        "shortDramaAssetRequired": "Connect at least one short drama asset image",
        "shortDramaRoleRequired": "Select a role for image \"{{name}}\"",
        "imageNotUploaded": "Image \"{{name}}\" has not been uploaded to the platform file library"
      }
    },
    "export": {
      "defaultFileName": "Infinite Canvas"
    }
  }
}
```

## 扫描与验证

### 硬编码扫描

- 对允许范围内非测试源码执行中文字符扫描：`0` 条残留。
- TypeScript AST 扫描 JSX 文本、`title`、`placeholder`、`aria-label`、`alt`、错误和 label/title 对象：仅剩 `1K/2K/4K`、空 `alt`、分隔符和协议/技术值。
- 用户标题、提示词、素材名、服务端错误详情和节点 JSON 不翻译。

### 测试

分组执行以规避 Bun 1.3.14 混合运行多个 `node:test` 文件时的嵌套 runner 限制：

```text
bun test src/pages/canvas/components/canvas-prompt-chip-editor-expand.test.tsx
2 pass / 0 fail

bun test src/pages/canvas/components/canvas-node-generation.test.mjs
7 pass / 0 fail

bun test src/pages/canvas/components/asset-picker.test.mjs
3 pass / 0 fail

bun test src/pages/canvas/components/canvas-generation-resume.test.mjs \
  src/pages/canvas/components/canvas-image-background.test.mjs \
  src/pages/canvas/components/canvas-node-config.test.ts \
  src/pages/canvas/components/canvas-prompt-chips.test.mjs
11 pass / 0 fail
```

合计：`23 pass / 0 fail`。

### 构建

```text
cd web
bun run build
```

结果：成功。TypeScript `tsc --noEmit` 和 Vite production build 均通过。

已有非阻塞警告：

- 部分模块同时被静态和动态 import，无法拆分到独立 chunk。
- 主 bundle 超过 Vite 默认 `500 kB` chunk 警告阈值。

## 主任务合并注意

1. 将上面的两个 `canvas` 片段分别合并到 `zh-CN.json` 与 `en-US.json`，不要覆盖其他 Canvas Subagent 已提供的同级 key。
2. 合并后检查 `_one` / `_other` 对称，以及 `text/image/config/video/audio`、`idle/success/loading/error`、`character/scene/tool` 等动态 key 集合完整。
3. 合并 locale 后再次运行完整 `bun run build`，并在浏览器切换中英文验证工具栏、节点错误、提示词编辑器和五个图片编辑对话框。
