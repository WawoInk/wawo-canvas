import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOverviewTree, filterOverviewNodes, overviewPreviewKind } from "./canvas-overview.ts";

const nodes = [
    { id: "text-1", type: "text", title: "产品描述", metadata: { content: "暖色海报" } },
    { id: "group-a", type: "group", title: "海报组", metadata: {} },
    { id: "image-a", type: "image", title: "暖色海报", metadata: { groupId: "group-a" } },
    { id: "text-a", type: "text", title: "文案", metadata: { content: "日落标题", groupId: "group-a" } },
    { id: "group-b", type: "group", title: "视频组", metadata: {} },
    { id: "video-b", type: "video", title: "预告片", metadata: { groupId: "group-b" } },
    { id: "orphan", type: "audio", title: "环境音", metadata: { groupId: "missing-group" } },
    { id: "batch-root", type: "image", title: "批量海报", metadata: { isBatchRoot: true, batchChildIds: ["batch-child"] } },
    { id: "batch-child", type: "image", title: "批量结果", metadata: { batchRootId: "batch-root", groupId: "group-a" } },
];

test("searches and filters visible Canvas overview nodes", () => {
    assert.deepEqual(
        filterOverviewNodes(nodes, "海报", "image").map((node) => node.id),
        ["image-a", "batch-root"],
    );
    assert.deepEqual(
        filterOverviewNodes(nodes, "暖色", "all").map((node) => node.id),
        ["text-1", "image-a"],
    );
});

test("builds a two-level Group tree and expands groups independently", () => {
    assert.deepEqual(
        buildOverviewTree(nodes, "", "all", new Set(["group-b"])).map(({ node, depth, hasChildren }) => [node.id, depth, hasChildren]),
        [
            ["text-1", 0, false],
            ["group-a", 0, true],
            ["image-a", 1, false],
            ["text-a", 1, false],
            ["group-b", 0, true],
            ["orphan", 0, false],
            ["batch-root", 0, false],
        ],
    );
});

test("keeps a matching child Group parent while searching or filtering", () => {
    assert.deepEqual(
        buildOverviewTree(nodes, "日落", "all", new Set()).map(({ node, depth }) => [node.id, depth]),
        [
            ["group-a", 0],
            ["text-a", 1],
        ],
    );
    assert.deepEqual(
        buildOverviewTree(nodes, "", "video", new Set()).map(({ node, depth }) => [node.id, depth]),
        [
            ["group-b", 0],
            ["video-b", 1],
        ],
    );
});

test("hides batch children behind their visible root", () => {
    assert.deepEqual(
        filterOverviewNodes(nodes, "", "all").map((node) => node.id),
        ["text-1", "group-a", "image-a", "text-a", "group-b", "video-b", "orphan", "batch-root"],
    );
});

test("uses the first video frame for overview previews", () => {
    assert.equal(overviewPreviewKind({ type: "video", metadata: { content: "https://example.com/video.mp4" } }), "video");
    assert.equal(overviewPreviewKind({ type: "video", metadata: {} }), "icon");
});

test("expands a selected Group to its child nodes for export", async () => {
    const { expandOverviewSelection } = await import("./canvas-overview.ts");
    const grouped = [
        { id: "group", type: "group", title: "组" },
        { id: "child", type: "image", title: "组内图片", metadata: { groupId: "group", batchChildIds: ["result"] } },
        { id: "result", type: "image", title: "批次结果", metadata: { batchRootId: "child" } },
        { id: "outside", type: "text", title: "组外文本" },
    ];
    assert.deepEqual(
        expandOverviewSelection(grouped, new Set(["group"])).map((node) => node.id),
        ["group", "child", "result"],
    );
});
