import assert from "node:assert/strict";
import { test } from "node:test";

import { applyGroupSelection, applyUngroupSelection, findGroupDropTarget, snapNodesIntoGroup } from "./canvas-node-geometry.ts";

const node = (id, x, y, metadata = {}, type = "image") => ({ id, type, title: id, position: { x, y }, width: 100, height: 80, metadata });

test("groups selected nodes without overwriting origin metadata", () => {
    const a = node("a", 100, 100, { fileId: "file-a", generationTaskId: "task-a" });
    const b = node("b", 260, 120, { materialSource: "volcengine", volcengineAssetId: "asset-b" });
    const group = { id: "group", type: "group", title: "组", position: { x: 76, y: 48 }, width: 408, height: 176, metadata: {} };

    const result = applyGroupSelection(new Set(["a", "b"]), [a, b], [], group);

    assert.deepEqual(result?.selectedIds, ["group"]);
    assert.equal(result?.nodes.find((item) => item.id === "a").metadata.fileId, "file-a");
    assert.equal(result?.nodes.find((item) => item.id === "a").metadata.generationTaskId, "task-a");
    assert.equal(result?.nodes.find((item) => item.id === "b").metadata.volcengineAssetId, "asset-b");
    assert.equal(result?.nodes.find((item) => item.id === "a").metadata.groupId, "group");
    assert.equal(result?.nodes.find((item) => item.id === "b").metadata.groupId, "group");
});

test("ungroups members without moving or deleting them and removes group connections", () => {
    const group = node("group", 60, 40, {}, "group");
    const a = node("a", 100, 100, { groupId: "group", fileId: "file-a" });
    const b = node("b", 260, 120, { groupId: "group" });
    const connections = [
        { id: "group-output", fromNodeId: "group", toNodeId: "target" },
        { id: "keep", fromNodeId: "a", toNodeId: "target" },
    ];

    const result = applyUngroupSelection(new Set(["group"]), [group, a, b], connections);

    assert.deepEqual(
        result?.nodes.map((item) => item.id),
        ["a", "b"],
    );
    assert.deepEqual(
        result?.nodes.map((item) => item.position),
        [a.position, b.position],
    );
    assert.equal(result?.nodes[0].metadata.fileId, "file-a");
    assert.equal(result?.nodes[0].metadata.groupId, undefined);
    assert.deepEqual(
        result?.connections.map((item) => item.id),
        ["keep"],
    );
});

test("uses the visually topmost group as the drop target and keeps relative node positions", () => {
    const back = { ...node("back", 0, 0, {}, "group"), width: 500, height: 400 };
    const front = { ...node("front", 50, 50, {}, "group"), width: 300, height: 240 };
    const a = node("a", 100, 100, { fileId: "file-a" });
    const b = node("b", 210, 130);

    assert.equal(findGroupDropTarget(new Set(["a", "b"]), [back, front, a, b])?.id, "front");
    const result = snapNodesIntoGroup(new Set(["a", "b"]), [back, front, a, b], front);
    const movedA = result.find((item) => item.id === "a");
    const movedB = result.find((item) => item.id === "b");
    assert.equal(movedA.metadata.groupId, "front");
    assert.equal(movedA.metadata.fileId, "file-a");
    assert.equal(movedB.position.x - movedA.position.x, b.position.x - a.position.x);
    assert.equal(movedB.position.y - movedA.position.y, b.position.y - a.position.y);
});
