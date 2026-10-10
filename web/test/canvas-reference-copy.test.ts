import { expect, test } from "bun:test";

import { copyCanvasReferenceConnections } from "../src/pages/canvas/utils/canvas-node-geometry";

test("copying nodes keeps inbound references and remaps references inside the copied selection", () => {
    const connections = [
        { id: "external", fromNodeId: "reference", toNodeId: "image" },
        { id: "internal", fromNodeId: "image", toNodeId: "video" },
        { id: "outbound", fromNodeId: "video", toNodeId: "unchanged" },
    ];
    const copied = copyCanvasReferenceConnections(
        connections,
        new Map([
            ["image", "image-copy"],
            ["video", "video-copy"],
        ]),
        new Set(["reference", "image", "video", "unchanged"]),
    );
    expect(copied.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])).toEqual([
        ["reference", "image-copy"],
        ["image-copy", "video-copy"],
    ]);
    expect(copied.every((connection) => !connections.some((original) => original.id === connection.id))).toBe(true);
    expect(new Set(copied.map((connection) => connection.id)).size).toBe(2);
});

test("pasting after a reference was deleted does not create a dangling connection", () => {
    const copied = copyCanvasReferenceConnections([{ id: "reference", fromNodeId: "deleted", toNodeId: "image" }], new Map([["image", "image-copy"]]), new Set(["image"]));
    expect(copied).toEqual([]);
});
