import assert from "node:assert/strict";
import test from "node:test";

import { generationTaskStatus } from "./generation-task-status.ts";

test("管理后台使用日志用不重复的中文状态展示所有任务生命周期", () => {
    assert.deepEqual(
        ["queued", "pending", "running", "success", "succeeded", "failed", "cancelled", "unexpected"].map((status) => generationTaskStatus(status).label),
        ["排队中", "等待中", "运行中", "成功", "成功", "失败", "已取消", "未知"],
    );
});
