import assert from "node:assert/strict";
import test from "node:test";
import { captureCanvasReplicaBinding, getCanvasReplicaPendingWork, matchesCanvasReplicaBinding, mergeCanvasReplicaRemote, transitionCanvasReplica, transitionCanvasReplicaState } from "./canvas-replica.ts";

function normalized(value) {
    return transitionCanvasReplicaState({ projects: [], tombstones: [] }, { type: "restore", persisted: { projects: [value] } }).projects[0] || null;
}

function replica(overrides = {}) {
    return { ...normalized({ id: "project-1", title: "本地画布", createdAt: "created", updatedAt: "updated", revision: 3, remoteRevision: 2, localVersion: 7 }), ...overrides };
}

test("normalizes persisted projects and tombstones", () => {
    const restored = transitionCanvasReplicaState({ projects: [], tombstones: [] }, { type: "restore", persisted: { projects: [{ id: "legacy", name: "旧画布", nodes: null, viewport: null }, null], tombstones: ["deleted", "", "deleted", 1] } });
    assert.deepEqual(restored.projects[0], {
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
    assert.deepEqual(restored.tombstones, ["deleted"]);
});

test("local transition rejects stale bindings and preserves dirty work across acknowledgements", () => {
    const project = replica();
    assert.equal(transitionCanvasReplica(project, { type: "edit", patch: { title: "旧写入" }, expectedRemoteRevision: 1 }).accepted, false);
    const update = transitionCanvasReplica(project, { type: "edit", patch: { title: "本地新标题" }, expectedRemoteRevision: 2 });
    assert.deepEqual(update.project, { ...project, title: "本地新标题", localVersion: 8, dirty: true });
    const staleAck = transitionCanvasReplica(update.project, { type: "acknowledge-save", localVersion: 7, revision: 4, updatedAt: "saved" }).project;
    const currentAck = transitionCanvasReplica(update.project, { type: "acknowledge-save", localVersion: 8, revision: 4, updatedAt: "saved" }).project;
    assert.equal(staleAck.dirty, true);
    assert.equal(currentAck.dirty, false);
    assert.equal(currentAck.remoteRevision, 2);
});

test("binding rejects a changed account or remote snapshot", () => {
    const project = replica();
    const session = { token: "token-a", userId: "user-a" };
    const binding = captureCanvasReplicaBinding(project, session);
    assert.equal(matchesCanvasReplicaBinding(project, binding, session), true);
    assert.equal(matchesCanvasReplicaBinding({ ...project, remoteRevision: 3 }, binding, session), false);
    assert.equal(matchesCanvasReplicaBinding(project, binding, { token: "token-b", userId: "user-a" }), false);
    assert.equal(matchesCanvasReplicaBinding(project, binding, { token: "token-a", userId: "user-b" }), false);
});

test("remote merge preserves dirty replicas and tombstones while blocking the cursor", () => {
    const dirty = replica({ id: "dirty", title: "本地未同步", dirty: true });
    const clean = replica({ id: "clean", revision: 2, remoteRevision: 2 });
    const merged = mergeCanvasReplicaRemote({
        projects: [dirty, clean, replica({ id: "deleted" }), replica({ id: "tombstoned" })],
        tombstones: ["tombstoned"],
        updates: [
            { id: "dirty", revision: 4, projectJson: JSON.stringify({ ...dirty, title: "远端冲突" }) },
            { id: "clean", revision: 3, projectJson: JSON.stringify({ ...clean, title: "远端新值" }) },
            { id: "tombstoned", revision: 9, projectJson: JSON.stringify(clean) },
        ],
        deletes: ["dirty", "deleted"],
    });
    assert.equal(merged.cursorAccepted, false);
    assert.equal(merged.projects.find((project) => project.id === "dirty")?.title, "本地未同步");
    assert.equal(merged.projects.find((project) => project.id === "clean")?.remoteRevision, 3);
    assert.equal(
        merged.projects.some((project) => project.id === "deleted" || project.id === "tombstoned"),
        false,
    );
});

test("pending work owns dirty, tombstone, data-change and unload rules", () => {
    const clean = replica({ id: "clean", dirty: false });
    const dirty = replica({ id: "dirty", dirty: true });
    const previous = [{ ...dirty, title: "旧标题" }];
    const work = getCanvasReplicaPendingWork([clean, dirty], ["deleted"], { previous });
    assert.deepEqual(work.pendingIds, ["dirty", "deleted"]);
    assert.deepEqual(work.changedIds, ["dirty"]);
    assert.deepEqual(work.unloadProjects, [dirty]);
    assert.deepEqual(transitionCanvasReplicaState({ projects: [clean, dirty], tombstones: [] }, { type: "delete", ids: ["dirty"] }).tombstones, ["dirty"]);
});
