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

test("Agent operations preserve Group connection and deletion invariants", () => {
    const connected = applyCanvasAgentOps(snapshot, [
        { type: "connect_nodes", fromNodeId: "config", toNodeId: "group" },
        { type: "connect_nodes", fromNodeId: "group", toNodeId: "config" },
    ]);
    assert.deepEqual(connected.connections.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId]), [["group", "config"]]);

    const deleted = applyCanvasAgentOps(snapshot, [{ type: "delete_node", id: "group" }]);
    assert.deepEqual(deleted.nodes.map((node) => node.id), ["image", "config"]);
    assert.equal(deleted.nodes[0].metadata.groupId, undefined);
    assert.equal(deleted.nodes[0].metadata.fileId, "file-1");
});
