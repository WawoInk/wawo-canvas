import assert from "node:assert/strict";
import { test } from "node:test";

let token = "token-1";
const calls = [];
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
    apiDelete: async (...args) => {
        calls.push(["delete", ...args]);
    },
}));

const { createStoryboardRecord, deleteStoryboardRecord, fetchStoryboardRecord, fetchStoryboardRecords } = await import("./storyboards.ts");

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

test("创建和删除分镜只通过认证 API", async () => {
    calls.length = 0;
    const input = {
        id: "storyboard-client-1",
        title: "雨夜来客",
        source: "第一场",
        options: { aspectRatio: "9:16", targetDurationSec: 60, style: "电影叙事", maxSegmentDurationSec: 15, maxShotDurationSec: 8, dialogueMustBeExact: true, allowMusic: false },
        model: "text-model",
        sourceHash: "sha256:abc",
        directorPlan: { schemaVersion: "1.0", title: "雨夜来客", sourceType: "script", scenes: [] },
        document: { schemaVersion: "1.0", title: "雨夜来客", sourceType: "script", aspectRatio: "9:16", targetDurationSec: 60, scenes: [] },
        validation: { status: "passed", errors: [], warnings: [] },
    };

    await createStoryboardRecord(input);
    await deleteStoryboardRecord("storyboard/a");

    assert.deepEqual(calls, [
        ["post", "/api/v1/storyboards", input, "token-1"],
        ["delete", "/api/v1/storyboards/storyboard%2Fa", "token-1"],
    ]);
});

test("分镜接口拒绝匿名请求", async () => {
    token = "";
    assert.throws(() => fetchStoryboardRecords(), /errors.authRequired/);
    token = "token-1";
});
