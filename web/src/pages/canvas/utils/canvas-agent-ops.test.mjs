import assert from "node:assert/strict";
import test from "node:test";

import { applyCanvasAgentOps } from "./canvas-agent-ops.ts";

const snapshot = {
    projectId: "project",
    title: "画布",
    nodes: [
        { id: "group", type: "group", title: "组", position: { x: 0, y: 0 }, width: 300, height: 200 },
        { id: "image", type: "image", title: "图", position: { x: 20, y: 20 }, width: 100, height: 80, metadata: { groupId: "group", fileId: "file-1" } },
        { id: "config", type: "config", title: "配置", position: { x: 400, y: 0 }, width: 100, height: 80 },
    ],
    connections: [],
    selectedNodeIds: ["group"],
    viewport: { x: 0, y: 0, k: 1 },
};

test("Agent operations use graph connection and Group deletion invariants", () => {
    const connected = applyCanvasAgentOps(snapshot, [
        { type: "connect_nodes", fromNodeId: "config", toNodeId: "group" },
        { type: "connect_nodes", fromNodeId: "group", toNodeId: "config" },
        { type: "connect_nodes", fromNodeId: "image", toNodeId: "image" },
    ]);
    assert.deepEqual(
        connected.connections.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]),
        [["group", "config"]],
    );

    const deleted = applyCanvasAgentOps(snapshot, [{ type: "delete_node", id: "group" }]);
    assert.deepEqual(
        deleted.nodes.map((node) => node.id),
        ["image", "config"],
    );
    assert.equal(deleted.nodes[0].metadata.groupId, undefined);
    assert.equal(deleted.nodes[0].metadata.fileId, "file-1");
});

test("Agent batch deletion repairs the primary child and removes a root with its children", () => {
    const batchSnapshot = {
        ...snapshot,
        nodes: [
            { id: "root", type: "image", title: "批次", position: { x: 0, y: 0 }, width: 100, height: 80, metadata: { isBatchRoot: true, batchChildIds: ["first", "second"], primaryImageId: "first", content: "first" } },
            { id: "first", type: "image", title: "一", position: { x: 0, y: 0 }, width: 100, height: 80, metadata: { batchRootId: "root", content: "first" } },
            { id: "second", type: "image", title: "二", position: { x: 0, y: 0 }, width: 100, height: 80, metadata: { batchRootId: "root", content: "second" } },
        ],
        connections: [{ id: "batch", fromNodeId: "root", toNodeId: "first" }],
        selectedNodeIds: ["root", "first"],
    };
    const childDeleted = applyCanvasAgentOps(batchSnapshot, [{ type: "delete_node", id: "first" }]);
    assert.equal(childDeleted.nodes[0].metadata.primaryImageId, "second");
    assert.equal(childDeleted.nodes[0].metadata.content, "second");
    assert.deepEqual(childDeleted.selectedNodeIds, ["root"]);

    const rootDeleted = applyCanvasAgentOps(batchSnapshot, [{ type: "delete_node", id: "root" }]);
    assert.deepEqual(rootDeleted.nodes, []);
    assert.deepEqual(rootDeleted.connections, []);
    assert.deepEqual(rootDeleted.selectedNodeIds, []);
});
