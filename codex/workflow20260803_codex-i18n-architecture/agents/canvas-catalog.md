# Canvas 项目目录国际化

## 限定范围

- `web/src/pages/canvas/index.tsx`
- `web/src/pages/canvas/components/canvas-project-card.tsx`
- `web/src/pages/canvas/components/canvas-delete-projects-dialog.tsx`
- `web/src/services/api/canvas-projects.ts`

未修改 locale、package、Canvas Store、同步协议、路由或业务逻辑。服务端 `{code,data,msg}` 继续由现有 API 请求层原样处理。

## 改动说明

- Canvas 项目目录、卡片、批量操作、导入提示、空状态、删除弹窗和无障碍标签统一使用 `canvas.catalog.*`。
- 项目数、节点数和连线数使用 i18next plural，并通过 `formatNumber()` 展示。
- 更新时间使用现有 `formatDateTime()`，随当前 locale 格式化。
- Canvas 项目 API 在本地缺失 token 时使用 `errors.canvasProjects.authRequired`；服务端返回消息未改写。
- 现有 `canvas.library` 资源可由主任务整体重命名为 `canvas.catalog`，无需同时保留两份。

## zh-CN 资源

```json
{
  "canvas": {
    "catalog": {
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
    }
  },
  "errors": {
    "canvasProjects": {
      "authRequired": "请先登录"
    }
  }
}
```

## en-US 资源

```json
{
  "canvas": {
    "catalog": {
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
    }
  },
  "errors": {
    "canvasProjects": {
      "authRequired": "Log in first"
    }
  }
}
```

## 验证

- `rg` 扫描限定代码：无中文硬编码、无 `canvas.library.*` 遗留。
- `prettier --check`：通过。
- `git diff --check`：通过。
- `tsc --noEmit`：本任务完成后的首次执行通过；并行管理后台改动写入后复查被范围外的 `web/src/pages/admin/enterprises/index.tsx:216` 语法错误阻断。
- 未运行全量 `bun run build`，由主任务在合并 locale 和其他并行改动后统一执行。
