import assert from "node:assert/strict";
import { test } from "node:test";

const summary = {
    id: "storyboard-1",
    title: "雨夜来客",
    source: "第一场",
    options: { aspectRatio: "9:16", targetDurationSec: 60, style: "电影叙事", maxSegmentDurationSec: 15, maxShotDurationSec: 8, dialogueMustBeExact: true, allowMusic: false },
    model: "text-model",
    sourceHash: "sha256:abc",
    validationStatus: "passed",
    sceneCount: 2,
    shotCount: 4,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T01:00:00.000Z",
};
const detail = {
    ...summary,
    directorPlan: { schemaVersion: "1.0", title: "雨夜来客", sourceType: "script", scenes: [] },
    document: { schemaVersion: "1.0", title: "雨夜来客", sourceType: "script", aspectRatio: "9:16", targetDurationSec: 60, scenes: [] },
    validation: { status: "passed", errors: [], warnings: [] },
};
const calls = [];
// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/services/api/storyboards", () => ({
    fetchStoryboardRecords: async () => [summary],
    fetchStoryboardRecord: async (id) => {
        calls.push(["fetch", id]);
        return detail;
    },
    createStoryboardRecord: async (record) => {
        calls.push(["create", record]);
        return detail;
    },
    deleteStoryboardRecord: async (id) => {
        calls.push(["delete", id]);
    },
}));

const { deleteStoryboardRecord, listStoryboardRecords, loadStoryboardRecord, saveStoryboardRecord } = await import("./storyboard-storage.ts");

test("存储适配器把服务端摘要时间转换为现有页面时间戳", async () => {
    const records = await listStoryboardRecords();
    assert.deepEqual(records, [{ ...summary, createdAt: Date.parse(summary.createdAt), updatedAt: Date.parse(summary.updatedAt) }]);
});

test("存储适配器按需加载 S3 详情并恢复页面记录", async () => {
    calls.length = 0;
    const record = await loadStoryboardRecord("storyboard-1");
    assert.deepEqual(calls, [["fetch", "storyboard-1"]]);
    const { validationStatus: _validationStatus, sceneCount: _sceneCount, shotCount: _shotCount, ...expectedDetail } = detail;
    assert.deepEqual(record, { ...expectedDetail, createdAt: Date.parse(detail.createdAt), updatedAt: Date.parse(detail.updatedAt) });
});

test("存储适配器只把生成内容交给服务端创建 ID 和时间", async () => {
    calls.length = 0;
    const { validationStatus: _validationStatus, sceneCount: _sceneCount, shotCount: _shotCount, ...recordDetail } = detail;
    const localRecord = { ...recordDetail, id: "temporary", createdAt: 1, updatedAt: 2 };
    const saved = await saveStoryboardRecord(localRecord);
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...expectedCreate } = localRecord;

    assert.deepEqual(calls, [["create", expectedCreate]]);
    assert.equal(saved.id, "storyboard-1");
    assert.equal(saved.createdAt, Date.parse(detail.createdAt));
});

test("存储适配器通过服务端删除记录", async () => {
    calls.length = 0;
    await deleteStoryboardRecord("storyboard-1");
    assert.deepEqual(calls, [["delete", "storyboard-1"]]);
});
