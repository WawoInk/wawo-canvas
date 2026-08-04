import assert from "node:assert/strict";
import { test } from "node:test";

import { canvasGenerationResume } from "./canvas-generation-resume.ts";

test("resumes an existing image task without describing a new submission", () => {
    assert.deepEqual(canvasGenerationResume({ type: "image", metadata: { upstreamTaskId: "task-image-1", taskModel: "gpt-image-2" } }), {
        kind: "image",
        taskId: "task-image-1",
        model: "gpt-image-2",
    });
});

test("resumes the existing first-party Generation Run", () => {
    assert.deepEqual(canvasGenerationResume({ type: "video", metadata: { generationTaskId: "run-1", generationProfileId: "profile-1", status: "error" } }), {
        kind: "first-party-video",
        taskId: "run-1",
        model: "",
    });
    assert.equal(canvasGenerationResume({ type: "image", metadata: {} }), null);
});

test("does not resume a materialized first-party video", () => {
    assert.equal(
        canvasGenerationResume({
            type: "video",
            metadata: {
                generationTaskId: "run-succeeded",
                generationProfileId: "profile-1",
                status: "success",
                fileId: "file-1",
            },
        }),
        null,
    );
});

test("resumes a first-party video by client request identity after a lost create response", () => {
    assert.deepEqual(
        canvasGenerationResume({
            type: "video",
            metadata: {
                generationClientRequestId: "request-stable",
                generationProfileId: "profile-1",
                status: "error",
            },
        }),
        {
            kind: "first-party-video",
            taskId: "",
            clientRequestId: "request-stable",
            model: "",
        },
    );
});
