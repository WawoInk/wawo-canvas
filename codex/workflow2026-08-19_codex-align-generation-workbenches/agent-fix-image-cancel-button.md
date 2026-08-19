# agent-fix-image-cancel-button

## 发现

- Ant Design `Button loading` 用于防重复提交，运行中会让按钮不可用并抑制点击。
- 图片工作台的运行态按钮同时设置了 `loading={running}` 和取消分支 `onClick`，所以 `cancelGeneration()` 没有用户可达入口。
- 最小修复：移除 `loading={running}`，用 `LoaderCircle` 图标保留明确运行反馈，保留现有 `disabled` 和取消点击分支。
