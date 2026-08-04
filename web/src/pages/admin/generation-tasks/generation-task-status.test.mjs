import assert from "node:assert/strict";
import test from "node:test";

import { generationTaskStatus } from "./generation-task-status.ts";

test("管理后台使用日志用不重复的中文状态展示所有任务生命周期", () => {
    assert.deepEqual(
        ["queued", "pending", "running", "success", "succeeded", "failed", "cancelled", "unexpected"].map((status) => generationTaskStatus(status).labelKey),
        [
            "admin.generationTasks.statuses.queued",
            "admin.generationTasks.statuses.pending",
            "admin.generationTasks.statuses.running",
            "admin.generationTasks.statuses.success",
            "admin.generationTasks.statuses.success",
            "admin.generationTasks.statuses.failed",
            "admin.generationTasks.statuses.cancelled",
            "admin.generationTasks.statuses.unknown",
        ],
    );
});
