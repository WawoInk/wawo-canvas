import assert from "node:assert/strict";
import test from "node:test";

import { captureCanvasReplicaBinding, matchesCanvasReplicaBinding, transitionCanvasReplicaState } from "../stores/canvas-replica.ts";

test("editor binding rejects a changed session or remote snapshot", () => {
    const project = transitionCanvasReplicaState({ projects: [], tombstones: [] }, { type: "restore", persisted: { projects: [{ id: "project-1", remoteRevision: 7 }] } }).projects[0];
    const binding = captureCanvasReplicaBinding(project, { token: "token-a", userId: "user-a" });

    assert.equal(matchesCanvasReplicaBinding(project, binding, { token: "token-a", userId: "user-a" }), true);
    assert.equal(matchesCanvasReplicaBinding({ ...project, remoteRevision: 8 }, binding, { token: "token-a", userId: "user-a" }), false);
    assert.equal(matchesCanvasReplicaBinding(project, binding, { token: "token-b", userId: "user-a" }), false);
    assert.equal(matchesCanvasReplicaBinding(project, binding, { token: "token-a", userId: "user-b" }), false);
});
