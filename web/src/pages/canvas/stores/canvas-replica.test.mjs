import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCanvasProject } from "./canvas-replica.ts";

test("normalizes legacy persisted projects", () => {
    assert.deepEqual(normalizeCanvasProject({ id: "legacy", name: "旧画布", nodes: null, viewport: null }), {
        id: "legacy",
        title: "旧画布",
        createdAt: "",
        updatedAt: "",
        revision: 0,
        remoteRevision: 0,
        syncConflict: false,
        localVersion: 0,
        dirty: false,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    });
});

test("rejects malformed persisted projects", () => {
    assert.equal(normalizeCanvasProject(null), null);
    assert.equal(normalizeCanvasProject({ title: "missing id" }), null);
});

test("preserves Canvas asset file associations", () => {
    const project = normalizeCanvasProject({ id: "project-1", nodes: [{ id: "image-1", metadata: { fileId: "file-image-1" } }] });
    assert.equal(project.nodes[0].metadata.fileId, "file-image-1");
});
