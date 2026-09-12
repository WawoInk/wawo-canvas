import assert from "node:assert/strict";
import test from "node:test";

import { transitionCanvasReplica, transitionCanvasReplicaState } from "./canvas-replica.ts";
import { applyCanvasVideoResult } from "./canvas-video-result.ts";

function project(value) {
    return transitionCanvasReplicaState({ projects: [], tombstones: [] }, { type: "restore", persisted: { projects: [value] } }).projects[0];
}

test("video result becomes a version-guarded dirty commit until its durable version is acknowledged", () => {
    const loading = {
        id: "video-1",
        type: "video",
        title: "生成视频",
        position: { x: 40, y: 60 },
        width: 480,
        height: 270,
        metadata: { status: "loading", generationTaskId: "task-1" },
    };
    const nodes = applyCanvasVideoResult([loading], {
        nodeId: loading.id,
        display: { width: 640, height: 360, preserveCenter: true },
        file: {
            url: "https://files.example/video.mp4",
            fileId: "file-video-1",
            width: 1920,
            height: 1080,
            bytes: 2048,
            mimeType: "video/mp4",
            durationMs: 6000,
        },
        generationTaskStatus: "succeeded",
    });
    const canvas = project({ id: "project-1", revision: 4, remoteRevision: 4, localVersion: 0, nodes });

    const stale = transitionCanvasReplica(canvas, { type: "edit", patch: { nodes }, expectedRemoteRevision: 3 });
    assert.equal(stale.accepted, false);

    const commit = transitionCanvasReplica({ ...canvas, nodes: [loading] }, { type: "edit", patch: { nodes }, expectedRemoteRevision: 4 });
    assert.deepEqual(commit.project.nodes[0], {
        ...loading,
        position: { x: -40, y: 15 },
        width: 640,
        height: 360,
        metadata: {
            ...loading.metadata,
            content: "https://files.example/video.mp4",
            storageKey: "",
            fileId: "file-video-1",
            status: "success",
            errorDetails: undefined,
            naturalWidth: 1920,
            naturalHeight: 1080,
            bytes: 2048,
            mimeType: "video/mp4",
            durationMs: 6000,
            generationTaskStatus: "succeeded",
        },
    });
    assert.equal(commit.project.dirty, true);
    assert.equal(transitionCanvasReplica(commit.project, { type: "acknowledge-save", localVersion: 0, revision: 5, updatedAt: "saved" }).project.dirty, true);
    assert.equal(transitionCanvasReplica(commit.project, { type: "acknowledge-save", localVersion: 1, revision: 5, updatedAt: "saved" }).project.dirty, false);
    assert.equal(commit.project.remoteRevision, 4);
    assert.equal(
        applyCanvasVideoResult(nodes, {
            nodeId: loading.id,
            display: { width: 640, height: 360, preserveCenter: true },
            file: { url: "https://files.example/video.mp4", fileId: "file-video-1", width: 1920, height: 1080, bytes: 2048, mimeType: "video/mp4", durationMs: 6000 },
            generationTaskStatus: "succeeded",
        }),
        nodes,
    );
});
