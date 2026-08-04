# Canvas 节点与配置控件国际化

## 范围与结论

- 已迁移 Canvas 素材选择、配置节点、节点内容、节点悬浮工具栏、图片快捷工具、提示词编辑器，以及裁剪、蒙版、切图、放大和多角度弹窗中的用户可见文案。
- `canvas-video-settings-popover.tsx` 与 `canvas-audio-settings-popover.tsx` 没有独立硬编码 UI 文案；展示值继续复用已国际化的共享设置 label helper。
- 用户输入、节点标题、服务端错误详情、模型名、协议值和 MIME 保持原文。
- 未修改 locale JSON；下方对照用于主任务核对或补录。

## 改动文件

- `web/src/pages/canvas/components/asset-picker-modal.tsx`
- `web/src/pages/canvas/components/canvas-config-composer.tsx`
- `web/src/pages/canvas/components/canvas-config-node-panel.tsx`
- `web/src/pages/canvas/components/canvas-context-menu.tsx`
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

审计但无需修改：

- `web/src/pages/canvas/components/canvas-video-settings-popover.tsx`
- `web/src/pages/canvas/components/canvas-audio-settings-popover.tsx`

## 验证结果

- 静态 JSX 文本、`title`、`placeholder`、`aria-label`、`alt`、toast 和前端错误 fallback 扫描：指定源文件无剩余用户可见中英文硬编码。
- 双语 key 检查：本范围引用 `224` 个叶子 key，`zh-CN`/`en-US` 缺失 `0`。
- `git diff --check`：通过。
- `bun test src/pages/canvas/components/canvas-node-generation.test.mjs src/pages/canvas/components/canvas-prompt-chip-editor-expand.test.tsx`：`9 pass / 0 fail`。
- 按子任务约束未运行全量 `bun run build`。

## 完整 Key 对照

| Key | zh-CN | en-US |
| --- | --- | --- |
| `canvas.actions.aiGenerate` | AI 生成 | Generate with AI |
| `canvas.actions.cancel` | 取消 | Cancel |
| `canvas.actions.cancelGenerationTask` | 取消生成任务 | Cancel generation task |
| `canvas.actions.cancelTask` | 取消任务 | Cancel Task |
| `canvas.actions.generate` | 生成 | Generate |
| `canvas.actions.reset` | 重置 | Reset |
| `canvas.actions.resumeQuery` | 恢复查询 | Resume Status |
| `canvas.actions.retry` | 重试 | Retry |
| `canvas.actions.save` | 保存 | Save |
| `canvas.actions.startGeneration` | 开始生成 | Start Generation |
| `canvas.actions.stop` | 停止 | Stop |
| `canvas.actions.stopWaiting` | 停止等待 | Stop Waiting |
| `canvas.angle.description` | 左侧只预览方向，结果会基于原图重新生成 | The left side previews direction only. The result is regenerated from the source image. |
| `canvas.angle.distance` | 镜头距离 | Camera Distance |
| `canvas.angle.horizontal` | 左右角度 | Horizontal |
| `canvas.angle.pitch` | 俯仰角度 | Pitch |
| `canvas.angle.standard` | 标准 | Standard |
| `canvas.angle.title` | AI 多角度 | AI Camera Angles |
| `canvas.angle.wide` | 广角 | Wide |
| `canvas.angle.wideAngle` | 广角镜头 | Wide-angle Lens |
| `canvas.assets.picker.empty` | 没有素材 | No assets |
| `canvas.assets.picker.filters.all` | 全部 | All |
| `canvas.assets.picker.filters.image` | 图片 | Image |
| `canvas.assets.picker.filters.text` | 文本 | Text |
| `canvas.assets.picker.filters.video` | 视频 | Video |
| `canvas.assets.picker.insert` | 插入 | Insert |
| `canvas.assets.picker.previewAria` | {{title}}预览 | {{title}} preview |
| `canvas.assets.picker.searchPlaceholder` | 搜索素材 | Search assets |
| `canvas.assets.picker.title` | 选择素材 | Select Asset |
| `canvas.common.reading` | 读取中 | Loading |
| `canvas.common.unknown` | 未知 | Unknown |
| `canvas.composer.hint` | @ 引用已连接素材，发送前按当前连接重新编号 | Use @ to reference connected assets. References are renumbered from the current connections before generation. |
| `canvas.composer.imagePreviewAlt` | 引用图片预览 | Referenced image preview |
| `canvas.composer.placeholder` | 输入提示词，按 @ 引用连接的图片或文本 | Enter a prompt and use @ to reference connected images or text |
| `canvas.composer.title` | 组装提示词 | Compose Prompt |
| `canvas.configNode.inputs.prompt` | 提示词 | Prompts |
| `canvas.configNode.inputs.referenceAudio` | 参考音频 | Reference Audio |
| `canvas.configNode.inputs.referenceImage` | 参考图 | Reference Images |
| `canvas.configNode.inputs.referenceVideo` | 参考视频 | Reference Videos |
| `canvas.configNode.modes.audio` | 音频 | Audio |
| `canvas.configNode.modes.image` | 生图 | Image |
| `canvas.configNode.modes.text` | 文本 | Text |
| `canvas.configNode.modes.video` | 视频 | Video |
| `canvas.configNode.title` | 生成配置 | Generation Config |
| `canvas.contextMenu.delete` | 删除 | Delete |
| `canvas.contextMenu.duplicate` | 复制 | Duplicate |
| `canvas.counts.audios_one` | {{value}} 个 | {{value}} audio file |
| `canvas.counts.audios_other` | {{value}} 个 | {{value}} audio files |
| `canvas.counts.images_one` | {{value}} 张 | {{value}} image |
| `canvas.counts.images_other` | {{value}} 张 | {{value}} images |
| `canvas.counts.items_one` | {{value}} 个 | {{value}} item |
| `canvas.counts.items_other` | {{value}} 个 | {{value}} items |
| `canvas.counts.nodes_one` | {{value}} 个 | {{value}} node |
| `canvas.counts.nodes_other` | {{value}} 个 | {{value}} nodes |
| `canvas.counts.videos_one` | {{value}} 个 | {{value}} video |
| `canvas.counts.videos_other` | {{value}} 个 | {{value}} videos |
| `canvas.crop.confirm` | 确认裁剪 | Confirm Crop |
| `canvas.crop.cropSize` | 裁剪尺寸 {{value}} | Crop size: {{value}} |
| `canvas.crop.freeRatio` | 自由比例 | Free Ratio |
| `canvas.crop.lockedRatio` | 锁定比例 | Locked Ratio |
| `canvas.crop.originalSize` | 原图 {{value}} | Original: {{value}} |
| `canvas.crop.ratio` | 比例 {{value}} | Ratio: {{value}} |
| `canvas.crop.resizeAria` | 调整裁剪框 | Resize crop box |
| `canvas.crop.title` | 裁剪图片 | Crop Image |
| `canvas.generation.errors.imageNotUploaded` | 图片「{{name}}」尚未上传到平台文件库 | Image "{{name}}" has not been uploaded to the platform file library |
| `canvas.generation.errors.resourceNotUploaded` | 素材「{{name}}」尚未上传到平台文件库 | Asset "{{name}}" has not been uploaded to the platform file library |
| `canvas.generation.errors.shortDramaAssetRequired` | 请连接至少一张短剧资产图片 | Connect at least one short drama asset image |
| `canvas.generation.errors.shortDramaRoleRequired` | 请为图片「{{name}}」选择角色 | Select a role for image "{{name}}" |
| `canvas.generation.errors.shortDramaScriptRequired` | 请输入短剧脚本 | Enter a short drama script |
| `canvas.generation.errors.shortDramaTitleRequired` | 请输入短剧标题 | Enter a short drama title |
| `canvas.maskEdit.apply` | AI 修改 | Apply AI Edit |
| `canvas.maskEdit.brushSize` | 笔刷大小 | Brush Size |
| `canvas.maskEdit.erase` | 擦除 | Erase |
| `canvas.maskEdit.errors.maskRequired` | 请先涂抹局部区域 | Paint the area you want to edit first |
| `canvas.maskEdit.errors.promptRequired` | 请输入修改要求 | Enter an edit request |
| `canvas.maskEdit.paint` | 画笔 | Brush |
| `canvas.maskEdit.placeholder` | 例如：把选中区域改成金属材质，保持原图光影 | For example: change the selected area to metal while preserving the original lighting |
| `canvas.maskEdit.request` | 修改要求 | Edit Request |
| `canvas.maskEdit.title` | 局部遮罩编辑 | Local Mask Edit |
| `canvas.models.legacySelection` | 旧模型：{{model}}（请重新选择） | Legacy model: {{model}} (select a new model) |
| `canvas.node.actions.setPrimary` | 设为主图 | Set as Primary |
| `canvas.node.batch.collapsed` | 图片组已收起 | Image group collapsed |
| `canvas.node.batch.expanded` | 图片组已展开 | Image group expanded |
| `canvas.node.defaultTitles.audio` | 音频 | Audio |
| `canvas.node.errors.generationFailed` | 生成失败 | Generation failed |
| `canvas.node.info.base64ImagePlaceholder` | [base64 图片] | [base64 image] |
| `canvas.node.info.fields.batch` | 图片组 | Image Group |
| `canvas.node.info.fields.id` | ID | ID |
| `canvas.node.info.fields.imageSize` | 图片大小 | Image Size |
| `canvas.node.info.fields.position` | 位置 | Position |
| `canvas.node.info.fields.prompt` | 提示词 | Prompt |
| `canvas.node.info.fields.size` | 尺寸 | Size |
| `canvas.node.info.fields.status` | 状态 | Status |
| `canvas.node.info.fields.type` | 类型 | Type |
| `canvas.node.info.positionValue` | {{x}}, {{y}} | {{x}}, {{y}} |
| `canvas.node.info.tabs.info` | 信息 | Info |
| `canvas.node.info.tabs.json` | JSON | JSON |
| `canvas.node.info.title` | 节点信息 | Node Information |
| `canvas.node.placeholders.editText` | 双击编辑文字 | Double-click to edit text |
| `canvas.node.placeholders.emptyAudio` | 空音频节点 | Empty audio node |
| `canvas.node.placeholders.emptyImage` | 空图片节点 | Empty image node |
| `canvas.node.placeholders.emptyVideo` | 空视频节点 | Empty video node |
| `canvas.node.status.error` | 失败 | Failed |
| `canvas.node.status.idle` | 就绪 | Ready |
| `canvas.node.status.loading` | 处理中 | Processing |
| `canvas.node.status.success` | 已完成 | Completed |
| `canvas.node.types.audio` | 音频 | Audio |
| `canvas.node.types.config` | 生成配置 | Generation Config |
| `canvas.node.types.image` | 图片 | Image |
| `canvas.node.types.text` | 文本 | Text |
| `canvas.node.types.video` | 视频 | Video |
| `canvas.node.unknown` | 未知节点 | Unknown node |
| `canvas.promptEditor.collapse` | 缩小输入框 | Collapse prompt editor |
| `canvas.promptEditor.expand` | 放大输入框 | Expand prompt editor |
| `canvas.promptEditor.promptAria` | 提示词 | Prompt |
| `canvas.promptEditor.resourcesAria` | 资源 | Resources |
| `canvas.promptPanel.placeholders.audio` | 描述要生成的音频内容 | Describe the audio you want to generate |
| `canvas.promptPanel.placeholders.imageEdit` | 请输入你想要把这张图修改成什么 | Describe how you want to edit this image |
| `canvas.promptPanel.placeholders.imageGenerate` | 描述要生成的图片内容 | Describe the image you want to generate |
| `canvas.promptPanel.placeholders.textEdit` | 请输入你想要将本段文本修改成什么 | Describe how you want to revise this text |
| `canvas.promptPanel.placeholders.textGenerate` | 请输入你想要生成的文本内容 | Describe the text you want to generate |
| `canvas.promptPanel.placeholders.video` | 描述要生成的视频内容 | Describe the video you want to generate |
| `canvas.promptPanel.shortDrama.assetsTitle` | 短剧资产角色 | Short Drama Asset Roles |
| `canvas.promptPanel.shortDrama.missingRole` | 缺少角色 | Role required |
| `canvas.promptPanel.shortDrama.roleAria` | {{title}}角色 | Role for {{title}} |
| `canvas.promptPanel.shortDrama.roles.character` | 角色 | Character |
| `canvas.promptPanel.shortDrama.roles.scene` | 场景 | Scene |
| `canvas.promptPanel.shortDrama.roles.tool` | 道具 | Prop |
| `canvas.promptPanel.shortDrama.selectRole` | 选择角色 | Select role |
| `canvas.prompts.library` | 提示词库 | Prompt Library |
| `canvas.resources.labels.audio` | 音频{{index}} | Audio {{index}} |
| `canvas.resources.labels.image` | 图片{{index}} | Image {{index}} |
| `canvas.resources.labels.text` | 文本{{index}} | Text {{index}} |
| `canvas.resources.labels.video` | 视频{{index}} | Video {{index}} |
| `canvas.settings.aspectRatioPlaceholder` | 比例 | Aspect ratio |
| `canvas.split.approxPiece` | 单块约 | Approx. per Piece |
| `canvas.split.childNodes` | 子节点 | Child Nodes |
| `canvas.split.columns` | 列数 | Columns |
| `canvas.split.description_one` | 生成 {{value}} 个图片子节点，并按原图网格排列到画布右侧 | Generate {{value}} image child node and arrange it to the right of the canvas using the source grid. |
| `canvas.split.description_other` | 生成 {{value}} 个图片子节点，并按原图网格排列到画布右侧 | Generate {{value}} image child nodes and arrange them to the right of the canvas using the source grid. |
| `canvas.split.generate` | 生成子节点 | Generate Child Nodes |
| `canvas.split.original` | 原图 | Original |
| `canvas.split.rows` | 行数 | Rows |
| `canvas.split.title` | 切分图片 | Split Image |
| `canvas.toolbar.actions.config.label` | 生成配置 | Config |
| `canvas.toolbar.actions.config.title` | 生成配置 | Generation config |
| `canvas.toolbar.actions.decreaseFont.label` | 缩小 | Smaller |
| `canvas.toolbar.actions.decreaseFont.title` | 减小字号 | Decrease font size |
| `canvas.toolbar.actions.delete.label` | 删除 | Delete |
| `canvas.toolbar.actions.delete.title` | 移除节点 | Remove node |
| `canvas.toolbar.actions.download.audio` | 下载音频 | Download audio |
| `canvas.toolbar.actions.download.image` | 下载图片 | Download image |
| `canvas.toolbar.actions.download.label` | 下载 | Download |
| `canvas.toolbar.actions.download.video` | 下载视频 | Download video |
| `canvas.toolbar.actions.edit.label` | 编辑 | Edit |
| `canvas.toolbar.actions.edit.title` | 编辑 | Edit |
| `canvas.toolbar.actions.editText.label` | 编辑文字 | Edit Text |
| `canvas.toolbar.actions.editText.title` | 编辑文本 | Edit text |
| `canvas.toolbar.actions.generateImage.label` | 生图 | Image |
| `canvas.toolbar.actions.generateImage.title` | 用文本生图 | Generate an image from text |
| `canvas.toolbar.actions.increaseFont.label` | 放大 | Larger |
| `canvas.toolbar.actions.increaseFont.title` | 增大字号 | Increase font size |
| `canvas.toolbar.actions.info.label` | 信息 | Info |
| `canvas.toolbar.actions.info.title` | 查看节点信息 | View node information |
| `canvas.toolbar.actions.replace.audio` | 替换音频 | Replace audio |
| `canvas.toolbar.actions.replace.video` | 替换视频 | Replace video |
| `canvas.toolbar.actions.retry.label` | 重试 | Retry |
| `canvas.toolbar.actions.retry.title` | 重新生成 | Generate again |
| `canvas.toolbar.actions.saveAsset.label` | 存素材 | Save Asset |
| `canvas.toolbar.actions.saveAsset.title` | 加入我的素材 | Add to My Assets |
| `canvas.toolbar.actions.upload.audio` | 上传音频 | Upload audio |
| `canvas.toolbar.actions.upload.image` | 上传图片 | Upload image |
| `canvas.toolbar.actions.upload.video` | 上传视频 | Upload video |
| `canvas.toolbar.imageTools.angle.label` | 多角度 | Angles |
| `canvas.toolbar.imageTools.angle.title` | 生成角度 | Generate new camera angles |
| `canvas.toolbar.imageTools.copyPrompt.label` | 复制提示词 | Copy Prompt |
| `canvas.toolbar.imageTools.copyPrompt.title` | 复制生成该图片的提示词 | Copy the prompt used to generate this image |
| `canvas.toolbar.imageTools.crop.label` | 裁剪 | Crop |
| `canvas.toolbar.imageTools.crop.title` | 裁剪并生成新节点 | Crop and create a new node |
| `canvas.toolbar.imageTools.maskEdit.label` | 局部编辑 | Local Edit |
| `canvas.toolbar.imageTools.maskEdit.title` | 添加蒙版遮罩后局部修改 | Paint a mask and edit part of the image |
| `canvas.toolbar.imageTools.replace.label` | 替换图片 | Replace Image |
| `canvas.toolbar.imageTools.replace.title` | 替换图片 | Replace image |
| `canvas.toolbar.imageTools.resize.freeLabel` | 自由比例 | Free Ratio |
| `canvas.toolbar.imageTools.resize.lockedLabel` | 锁比例 | Lock Ratio |
| `canvas.toolbar.imageTools.resize.toFreeTitle` | 切换为自由比例 | Switch to free resizing |
| `canvas.toolbar.imageTools.resize.toLockedTitle` | 切换为等比缩放 | Switch to proportional resizing |
| `canvas.toolbar.imageTools.reversePrompt.label` | 反推提示词 | Reverse Prompt |
| `canvas.toolbar.imageTools.reversePrompt.title` | 创建反推提示词的文本和配置节点 | Create text and config nodes to reverse-engineer the image prompt |
| `canvas.toolbar.imageTools.split.label` | 切图 | Split |
| `canvas.toolbar.imageTools.split.title` | 按行列切分图片 | Split the image by rows and columns |
| `canvas.toolbar.imageTools.superResolve.label` | 超分 | Super Resolution |
| `canvas.toolbar.imageTools.superResolve.title` | AI 超分 | AI super resolution |
| `canvas.toolbar.imageTools.upscale.label` | 放大 | Upscale |
| `canvas.toolbar.imageTools.upscale.title` | 放大图片分辨率 | Increase image resolution |
| `canvas.toolbar.imageTools.view.label` | 查看大图 | View Full Image |
| `canvas.toolbar.imageTools.view.title` | 查看图片详情 | View image details |
| `canvas.toolbar.messages.noPrompt` | 暂无可复制的提示词 | No prompt is available to copy |
| `canvas.toolbar.messages.promptCopied` | 提示词已复制 | Prompt copied |
| `canvas.toolbar.settings.description` | 选择你想在图片节点编辑栏中使用的快捷工具。 | Choose the quick tools to show in the image node editor. |
| `canvas.toolbar.settings.moreLabel` | 更多 | More |
| `canvas.toolbar.settings.moreTitle` | 配置快捷工具 | Configure quick tools |
| `canvas.toolbar.settings.previewNode` | 图片节点 | Image Node |
| `canvas.toolbar.settings.previewTitle` | 节点预览 | Node Preview |
| `canvas.toolbar.settings.showLabels` | 显示按钮文字 | Show button labels |
| `canvas.toolbar.settings.title` | 自定义工具栏 | Customize Toolbar |
| `canvas.toolbar.settings.toolsLabel` | 快捷工具 | Quick Tools |
| `canvas.units.degreeSuffix` | ° | ° |
| `canvas.units.pixelDimensions` | {{value}} px | {{value}} px |
| `canvas.units.pixelValue` | {{value}} px | {{value}} px |
| `canvas.upscale.algorithm` | 放大算法 | Upscaling Algorithm |
| `canvas.upscale.algorithms.bilinear.description` | 平滑、速度快 | Smooth and fast |
| `canvas.upscale.algorithms.bilinear.title` | 双线性 | Bilinear |
| `canvas.upscale.algorithms.high.description` | 适合照片和细节图 | Best for photos and detailed images |
| `canvas.upscale.algorithms.high.title` | 高清插值 | High-quality Interpolation |
| `canvas.upscale.algorithms.nearest.description` | 适合像素风格 | Best for pixel art |
| `canvas.upscale.algorithms.nearest.title` | 最近邻 | Nearest Neighbor |
| `canvas.upscale.errors.reachedMax` | 图片已达到 4K，无需放大 | The image is already 4K and does not need upscaling |
| `canvas.upscale.errors.reachedTarget` | 图片已达到当前目标像素，无需放大 | The image already meets the selected target size |
| `canvas.upscale.generate` | 生成放大图 | Generate Upscaled Image |
| `canvas.upscale.outputSize` | 输出尺寸 | Output Size |
| `canvas.upscale.source` | 源图 | Source |
| `canvas.upscale.targetPixels` | 目标像素 | Target Pixels |
| `canvas.upscale.title` | 图片放大 | Upscale Image |
