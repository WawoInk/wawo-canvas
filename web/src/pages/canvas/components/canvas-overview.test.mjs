import assert from "node:assert/strict";
import { test } from "node:test";

import { filterOverviewNodes, overviewPreviewKind } from "./canvas-overview.ts";

const nodes = [
    { id: "text-1", type: "text", title: "产品描述", metadata: { content: "暖色海报" } },
    { id: "batch-root", type: "image", title: "海报批量", metadata: { isBatchRoot: true, batchChildIds: ["batch-child"] } },
    { id: "batch-child", type: "image", title: "海报结果", metadata: { batchRootId: "batch-root" } },
    { id: "video-1", type: "video", title: "预告片", metadata: {} },
];

test("searches and filters visible Canvas overview nodes", () => {
    assert.deepEqual(
        filterOverviewNodes(nodes, "海报", "image").map((node) => node.id),
        ["batch-root"],
    );
    assert.deepEqual(
        filterOverviewNodes(nodes, "暖色", "all").map((node) => node.id),
        ["text-1"],
    );
});

test("hides batch children behind their visible root", () => {
    assert.deepEqual(
        filterOverviewNodes(nodes, "", "all").map((node) => node.id),
        ["text-1", "batch-root", "video-1"],
    );
});

test("uses the first video frame for overview previews", () => {
    assert.equal(overviewPreviewKind({ type: "video", metadata: { content: "https://example.com/video.mp4" } }), "video");
    assert.equal(overviewPreviewKind({ type: "video", metadata: {} }), "icon");
});
