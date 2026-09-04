import assert from "node:assert/strict";
import { test } from "node:test";

import { buildNodeMentionReferences, getGenerationResourceNodes, getGroupResourceNodes } from "./canvas-resource-references.ts";

const t = (key, values) => `${key}:${values?.index ?? ""}`;
const nodes = [
    { id: "group", type: "group", title: "参考组", position: { x: 0, y: 0 }, width: 400, height: 300 },
    { id: "image", type: "image", title: "平台图片", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { groupId: "group", fileId: "file-image", content: "https://example.com/image.png" } },
    { id: "video", type: "video", title: "火山视频", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { groupId: "group", materialSource: "volcengine", volcengineAssetId: "asset-video" } },
    { id: "empty", type: "text", title: "空文本", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { groupId: "group" } },
    { id: "target", type: "config", title: "配置", position: { x: 0, y: 0 }, width: 100, height: 100 },
];

test("expands a group into supported origin resources in canvas order", () => {
    assert.deepEqual(
        getGroupResourceNodes("group", nodes).map((node) => node.id),
        ["image", "video"],
    );
    assert.deepEqual(
        getGenerationResourceNodes("target", nodes, [{ id: "group-target", fromNodeId: "group", toNodeId: "target" }]).map((node) => node.id),
        ["image", "video"],
    );
});

test("deduplicates group and direct references while preserving origin resource fields", () => {
    const references = buildNodeMentionReferences(
        nodes.at(-1),
        nodes,
        [
            { id: "group-target", fromNodeId: "group", toNodeId: "target" },
            { id: "image-target", fromNodeId: "image", toNodeId: "target" },
        ],
        t,
    );
    assert.deepEqual(
        references.map((item) => item.nodeId),
        ["image", "video"],
    );
    assert.equal(nodes[1].metadata.fileId, "file-image");
    assert.equal(nodes[2].metadata.volcengineAssetId, "asset-video");
});
