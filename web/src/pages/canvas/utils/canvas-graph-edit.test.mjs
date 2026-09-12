import assert from "node:assert/strict";
import test from "node:test";

import { applyCanvasGraphEdit } from "./canvas-graph-edit.ts";

const node = (id, type, metadata) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 80, metadata });

test("connect enforces direction and target invariants", () => {
    const graph = {
        nodes: [node("text", "text"), node("config", "config"), node("group", "group")],
        connections: [],
    };
    const connected = applyCanvasGraphEdit(graph, {
        type: "connect",
        id: "connection",
        firstNodeId: "config",
        secondNodeId: "text",
        firstHandleType: "target",
    });
    assert.deepEqual(connected.connections, [{ id: "connection", fromNodeId: "text", toNodeId: "config" }]);

    for (const edit of [
        { type: "connect", id: "self", firstNodeId: "text", secondNodeId: "text", firstHandleType: "source" },
        { type: "connect", id: "group-target", firstNodeId: "text", secondNodeId: "group", firstHandleType: "source" },
        { type: "connect", id: "config-pair", firstNodeId: "config", secondNodeId: "config", firstHandleType: "source" },
    ]) {
        assert.equal(applyCanvasGraphEdit(graph, edit).connections.length, 0);
    }
    assert.equal(applyCanvasGraphEdit(connected, { type: "connect", id: "duplicate", firstNodeId: "text", secondNodeId: "config", firstHandleType: "source" }).connections.length, 1);
});

test("delete expands batch roots and repairs a deleted primary child", () => {
    const graph = {
        nodes: [
            node("source", "text"),
            node("root", "image", { isBatchRoot: true, batchChildIds: ["first", "second"], primaryImageId: "first", content: "first", naturalWidth: 100, naturalHeight: 80 }),
            node("first", "image", { batchRootId: "root", content: "first", naturalWidth: 100, naturalHeight: 80 }),
            node("second", "image", { batchRootId: "root", content: "second", naturalWidth: 200, naturalHeight: 120 }),
        ],
        connections: [
            { id: "source-first", fromNodeId: "source", toNodeId: "first" },
            { id: "source-second", fromNodeId: "source", toNodeId: "second" },
        ],
    };
    const childDeleted = applyCanvasGraphEdit(graph, { type: "delete", nodeIds: ["first"] });
    const root = childDeleted.nodes.find((item) => item.id === "root");
    assert.deepEqual(root.metadata.batchChildIds, ["second"]);
    assert.equal(root.metadata.primaryImageId, "second");
    assert.equal(root.metadata.content, "second");
    assert.equal(root.metadata.naturalWidth, 200);
    assert.deepEqual(
        childDeleted.connections.map((item) => item.id),
        ["source-second"],
    );

    const rootDeleted = applyCanvasGraphEdit(graph, { type: "delete", nodeIds: new Set(["root"]) });
    assert.deepEqual(
        rootDeleted.nodes.map((item) => item.id),
        ["source"],
    );
    assert.deepEqual([...rootDeleted.deletedNodeIds], ["root", "first", "second"]);
    assert.deepEqual(rootDeleted.connections, []);
});
