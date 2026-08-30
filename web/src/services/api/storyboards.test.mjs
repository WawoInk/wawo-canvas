import assert from "node:assert/strict";
import { test } from "node:test";

let token = "token-1";
const calls = [];
let putError;
// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/i18n", () => ({ default: { t: (key) => key } }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: { getState: () => ({ token }) } }));
mock.module("@/services/api/request", () => ({
    apiGet: async (...args) => {
        calls.push(["get", ...args]);
        return [];
    },
    apiPost: async (...args) => {
        calls.push(["post", ...args]);
        return args[1];
    },
    apiPut: async (...args) => {
        calls.push(["put", ...args]);
        if (putError) throw putError;
        return args[1];
    },
    apiDelete: async (...args) => {
        calls.push(["delete", ...args]);
    },
}));

const { createStoryboardRecord, deleteStoryboardRecord, fetchStoryboardRecord, fetchStoryboardRecords, updateStoryboardRecord } = await import("./storyboards.ts?api-test");

test("分镜列表通过当前登录令牌加载 PostgreSQL 摘要", async () => {
    calls.length = 0;
    await fetchStoryboardRecords();
    assert.deepEqual(calls, [["get", "/api/v1/storyboards", undefined, "token-1"]]);
});

test("分镜详情按编码后的 ID 加载 S3 快照", async () => {
    calls.length = 0;
    await fetchStoryboardRecord("storyboard/a");
    assert.deepEqual(calls, [["get", "/api/v1/storyboards/storyboard%2Fa", undefined, "token-1"]]);
});

test("创建、更新和删除分镜只通过认证 API", async () => {
    calls.length = 0;
    putError = undefined;
    const draft = {
        id: "storyboard-client-1",
        title: "雨夜来客",
        source: "第一场",
        options: { aspectRatio: "9:16", targetDurationSec: 60, style: "电影叙事", maxSegmentDurationSec: 15, maxShotDurationSec: 8, dialogueMustBeExact: true, allowMusic: false },
        model: "text-model",
        sourceHash: "sha256:abc",
    };
    const workspace = {
        ...draft,
        directorPlan: { schemaVersion: "1.0", title: "雨夜来客", sourceType: "script", scenes: [] },
        document: { schemaVersion: "1.0", title: "雨夜来客", sourceType: "script", aspectRatio: "9:16", targetDurationSec: 60, scenes: [] },
        validation: { status: "passed", errors: [], warnings: [] },
    };

    await createStoryboardRecord(draft);
    await updateStoryboardRecord("storyboard/a", workspace, 3);
    await deleteStoryboardRecord("storyboard/a");

    assert.deepEqual(calls, [
        ["post", "/api/v1/storyboards", draft, "token-1"],
        ["put", "/api/v1/storyboards/storyboard%2Fa", { ...workspace, expectedRevision: 3 }, "token-1"],
        ["delete", "/api/v1/storyboards/storyboard%2Fa", "token-1"],
    ]);
});

test("更新冲突保留 ApiError 和服务端 current 详情", async () => {
    calls.length = 0;
    const conflict = Object.assign(new Error("conflict"), { status: 409, data: { current: { id: "storyboard-1", revision: 8 } } });
    putError = conflict;

    await assert.rejects(updateStoryboardRecord("storyboard-1", { id: "storyboard-1" }, 7), (error) => error === conflict);
    putError = undefined;
});

test("分镜接口拒绝匿名请求", async () => {
    token = "";
    assert.throws(() => fetchStoryboardRecords(), /errors.authRequired/);
    token = "token-1";
});
