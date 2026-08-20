import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig } from "../../stores/use-config-store.ts";
import {
    cancelImageWorkbenchTask,
    completeImageWorkbenchTask,
    createImageWorkbenchTask,
    imageWorkbenchDeletionIds,
    imageWorkbenchReference,
    imageWorkbenchTaskStatusForError,
    imageWorkbenchTaskRecord,
    isImageWorkbenchTaskRetryableError,
    resumableImageWorkbenchTasks,
    upsertImageWorkbenchTaskRecord,
} from "./image-async-task.ts";

test("image workbench creates a resumable generation task", async () => {
    const previousPost = axios.post;
    /** @type {{ url: string; body: unknown; options: Record<string, any> }} */
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return {
            data: { id: "upstream-task-7" },
            headers: { "x-generation-task-id": "platform-task-42" },
        };
    };

    const model = "Images";
    try {
        const task = await createImageWorkbenchTask(
            {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
            },
            "画一座灯塔",
            [],
        );

        assert.equal(request.url, "/api/v1/async/images/generations");
        assert.equal(request.options.headers["X-Source"], "image_workbench");
        assert.deepEqual(task, {
            source: "image_workbench",
            platformTaskId: "platform-task-42",
            upstreamTask: {
                id: "upstream-task-7",
                model,
                platformTaskId: "platform-task-42",
            },
        });
    } finally {
        axios.post = previousPost;
    }
});

test("image workbench materializes a result completed during task creation", async () => {
    let polls = 0;
    const patched = [];

    const image = await completeImageWorkbenchTask(
        {
            source: "image_workbench",
            platformTaskId: "platform-immediate-44",
            upstreamTask: {
                id: "platform-immediate-44",
                model: "Images",
                images: [{ dataUrl: "https://provider.test/immediate.png" }],
            },
        },
        {
            poll: async () => {
                polls += 1;
                throw new Error("an immediate result must not be polled");
            },
            materialize: async (dataUrl) => {
                assert.equal(dataUrl, "https://provider.test/immediate.png");
                return {
                    fileId: "file-immediate-44",
                    url: "https://files.test/file-immediate-44",
                    width: 1024,
                    height: 1024,
                    bytes: 123,
                    mimeType: "image/png",
                };
            },
            patchMetadata: async (taskId, metadata) => {
                patched.push({ taskId, metadata });
            },
        },
    );

    assert.equal(polls, 0);
    assert.equal(image.fileId, "file-immediate-44");
    assert.deepEqual(patched, [
        {
            taskId: "platform-immediate-44",
            metadata: JSON.stringify({ fileIds: ["file-immediate-44"] }),
        },
    ]);
});

test("image workbench does not materialize an immediate result after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    let materialized = false;
    let cancelled = 0;

    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-immediate-cancelled",
                upstreamTask: {
                    id: "platform-immediate-cancelled",
                    model: "Images",
                    images: [{ dataUrl: "https://provider.test/immediate.png" }],
                },
            },
            {
                poll: async () => {
                    throw new Error("an immediate result must not be polled");
                },
                materialize: async () => {
                    materialized = true;
                    throw new Error("a cancelled result must not be materialized");
                },
                patchMetadata: async () => {},
                cancel: async () => {
                    cancelled += 1;
                },
                signal: controller.signal,
            },
        ),
        { name: "AbortError" },
    );

    assert.equal(materialized, false);
    assert.equal(cancelled, 1);
});

test("image workbench completes pending tasks and patches the exact platform task", async () => {
    const states = [{ status: "pending" }, { status: "succeeded", images: [{ dataUrl: "https://provider.test/result.png" }] }];
    /** @type {{ taskId: string; metadata: string }[]} */
    const patched = [];
    let polls = 0;

    const image = await completeImageWorkbenchTask(
        {
            source: "image_workbench",
            platformTaskId: "platform-task-42",
            upstreamTask: { id: "upstream-task-7", model: "Images" },
        },
        {
            poll: async () => {
                polls += 1;
                return states.shift();
            },
            materialize: async (dataUrl) => {
                assert.equal(dataUrl, "https://provider.test/result.png");
                return {
                    fileId: "file-final-9",
                    url: "https://files.test/file-final-9",
                    width: 1536,
                    height: 1024,
                    bytes: 321,
                    mimeType: "image/png",
                };
            },
            patchMetadata: async (taskId, metadata) => {
                patched.push({ taskId, metadata });
            },
            sleep: async () => {},
        },
    );

    assert.equal(polls, 2);
    assert.equal(image.fileId, "file-final-9");
    assert.deepEqual(patched, [
        {
            taskId: "platform-task-42",
            metadata: JSON.stringify({ fileIds: ["file-final-9"] }),
        },
    ]);
});

test("image workbench keeps provider failures as terminal errors", async () => {
    let materialized = false;

    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-task-42",
                upstreamTask: { id: "upstream-task-7", model: "Images" },
            },
            {
                poll: async () => ({ status: "failed", error: "provider rejected the prompt" }),
                materialize: async () => {
                    materialized = true;
                    throw new Error("materialization must not run");
                },
                patchMetadata: async () => {
                    throw new Error("metadata patch must not run");
                },
                sleep: async () => {},
            },
        ),
        /provider rejected the prompt/,
    );

    assert.equal(materialized, false);
});

test("image workbench keeps a materialized result when metadata patching fails", async () => {
    const image = await completeImageWorkbenchTask(
        {
            source: "image_workbench",
            platformTaskId: "platform-task-42",
            upstreamTask: { id: "upstream-task-7", model: "Images" },
        },
        {
            poll: async () => ({ status: "succeeded", images: [{ dataUrl: "data:image/png;base64,aW1hZ2U=" }] }),
            materialize: async () => ({
                fileId: "file-final-9",
                url: "https://files.test/file-final-9",
                width: 1024,
                height: 1024,
                bytes: 321,
                mimeType: "image/png",
            }),
            patchMetadata: async () => {
                throw new Error("history is temporarily unavailable");
            },
        },
    );

    assert.equal(image.fileId, "file-final-9");
});

test("image workbench pauses on temporary query and upload errors without terminal failure", async () => {
    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-query-retry",
                upstreamTask: { id: "upstream-query-retry", model: "Images" },
            },
            {
                poll: async () => {
                    throw new Error("temporary query failure");
                },
                materialize: async () => {
                    throw new Error("temporary upload failure");
                },
                patchMetadata: async () => {},
                sleep: async () => {},
            },
        ),
        (error) => isImageWorkbenchTaskRetryableError(error),
    );

    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-upload-retry",
                upstreamTask: {
                    id: "upstream-upload-retry",
                    model: "Images",
                    images: [{ dataUrl: "https://provider.test/upload-retry.png" }],
                },
            },
            {
                poll: async () => ({ status: "pending" }),
                materialize: async () => {
                    throw new Error("temporary upload failure");
                },
                patchMetadata: async () => {},
            },
        ),
        (error) => isImageWorkbenchTaskRetryableError(error),
    );
});

test("image workbench resumes polling after a temporary query error", async () => {
    let polls = 0;
    const image = await completeImageWorkbenchTask(
        {
            source: "image_workbench",
            platformTaskId: "platform-query-recovered",
            upstreamTask: { id: "upstream-query-recovered", model: "Images" },
        },
        {
            poll: async () => {
                polls += 1;
                if (polls === 1) throw new Error("temporary query failure");
                return { status: "succeeded", images: [{ dataUrl: "https://provider.test/recovered.png" }] };
            },
            materialize: async () => ({
                fileId: "file-query-recovered",
                url: "https://files.test/file-query-recovered",
                width: 1024,
                height: 1024,
                bytes: 10,
                mimeType: "image/png",
            }),
            patchMetadata: async () => {},
            sleep: async () => {},
        },
    );

    assert.equal(polls, 2);
    assert.equal(image.fileId, "file-query-recovered");
});

test("image workbench task records round trip only pending task identities", () => {
    const pending = imageWorkbenchTaskRecord(2, {
        source: "image_workbench",
        platformTaskId: "platform-task-42",
        upstreamTask: {
            id: "upstream-task-7",
            model: "Images",
            images: [{ dataUrl: "data:image/png;base64,aW1hZ2U=" }],
        },
    });
    /** @type {import("./image-async-task.ts").ImageWorkbenchTaskRecord} */
    const completed = { ...pending, index: 0, status: "succeeded", fileId: "file-final-9", images: undefined };
    /** @type {import("./image-async-task.ts").ImageWorkbenchTaskRecord} */
    const failed = { ...pending, index: 1, status: "failed", error: "provider failed", images: undefined };

    assert.deepEqual(pending, {
        index: 2,
        source: "image_workbench",
        upstreamTaskId: "upstream-task-7",
        taskModel: "Images",
        platformTaskId: "platform-task-42",
        status: "pending",
        images: [{ dataUrl: "data:image/png;base64,aW1hZ2U=" }],
    });
    assert.deepEqual(resumableImageWorkbenchTasks([completed, failed, pending]), [
        {
            record: pending,
            task: {
                source: "image_workbench",
                platformTaskId: "platform-task-42",
                upstreamTask: {
                    id: "upstream-task-7",
                    model: "Images",
                    images: [{ dataUrl: "data:image/png;base64,aW1hZ2U=" }],
                },
            },
        },
    ]);
});

test("image workbench retry replaces a failed slot with durable task identities", () => {
    const retriedTask = imageWorkbenchTaskRecord(1, {
        source: "image_workbench",
        platformTaskId: "platform-retry-2",
        upstreamTask: { id: "upstream-retry-2", model: "Images" },
    });

    assert.deepEqual(
        upsertImageWorkbenchTaskRecord(
            [
                {
                    index: 1,
                    source: "image_workbench",
                    upstreamTaskId: "upstream-old-1",
                    taskModel: "Images",
                    platformTaskId: "platform-old-1",
                    status: "failed",
                    error: "temporary query failure",
                },
            ],
            retriedTask,
        ),
        [{ ...retriedTask, status: "pending" }],
    );
    assert.deepEqual(upsertImageWorkbenchTaskRecord([], { ...retriedTask, status: "succeeded", fileId: "file-retry-2" }), [{ ...retriedTask, status: "succeeded", fileId: "file-retry-2" }]);
});

test("image workbench restores successful and failed batch slots", async () => {
    const { restoreImageWorkbenchSlots } = await import("./image-async-task.ts");
    const image = { id: "file-final-9", slotIndex: 0 };

    assert.equal(typeof restoreImageWorkbenchSlots, "function");
    assert.deepEqual(
        restoreImageWorkbenchSlots(
            [
                { index: 1, source: "image_workbench", status: "failed", error: "provider rejected slot 2" },
                { index: 0, source: "image_workbench", status: "succeeded", fileId: "file-final-9" },
            ],
            [image],
        ),
        [
            { index: 0, status: "success", image },
            { index: 1, status: "failed", error: "provider rejected slot 2" },
        ],
    );
});

test("image workbench restores only records owned by its source", () => {
    assert.deepEqual(
        resumableImageWorkbenchTasks([
            {
                index: 0,
                source: "canvas",
                upstreamTaskId: "canvas-task-1",
                taskModel: "Images",
                status: "pending",
            },
        ]),
        [],
    );
});

test("image workbench cancels the upstream task after polling timeout", async () => {
    let cancelled = 0;

    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-timeout",
                upstreamTask: { id: "upstream-timeout", model: "Images" },
            },
            {
                poll: async () => ({ status: "pending" }),
                materialize: async () => {
                    throw new Error("materialization must not run");
                },
                patchMetadata: async () => {},
                cancel: async () => {
                    cancelled += 1;
                },
                sleep: async () => {},
            },
        ),
        /timed out/,
    );

    assert.equal(cancelled, 1);
});

test("image workbench cancellation aborts polling and cancels upstream task", async () => {
    const controller = new AbortController();
    controller.abort();
    let cancelled = 0;

    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-cancelled",
                upstreamTask: { id: "upstream-cancelled", model: "Images" },
            },
            {
                poll: async () => ({ status: "pending" }),
                materialize: async () => {
                    throw new Error("materialization must not run");
                },
                patchMetadata: async () => {},
                cancel: async () => {
                    cancelled += 1;
                },
                signal: controller.signal,
                sleep: async () => {},
            },
        ),
        { name: "AbortError" },
    );

    assert.equal(cancelled, 1);
});

test("image workbench references preserve platform file ids", () => {
    assert.deepEqual(
        imageWorkbenchReference({
            id: "asset-1",
            name: "asset.png",
            type: "image/png",
            dataUrl: "https://files.test/file-1",
            fileId: "file-1",
        }),
        {
            id: "asset-1",
            name: "asset.png",
            type: "image/png",
            dataUrl: "https://files.test/file-1",
            fileId: "file-1",
        },
    );
});

test("image workbench cancellation during a poll still cancels upstream", async () => {
    const controller = new AbortController();
    let cancelled = 0;

    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-inflight-cancel",
                upstreamTask: { id: "upstream-inflight-cancel", model: "Images" },
            },
            {
                poll: async () => {
                    controller.abort();
                    throw new DOMException("Aborted", "AbortError");
                },
                materialize: async () => {
                    throw new Error("materialization must not run");
                },
                patchMetadata: async () => {},
                cancel: async () => {
                    cancelled += 1;
                },
                signal: controller.signal,
            },
        ),
        { name: "AbortError" },
    );

    assert.equal(cancelled, 1);
});

test("image workbench cancellation while waiting still cancels upstream", async () => {
    const controller = new AbortController();
    let cancelled = 0;

    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-wait-cancel",
                upstreamTask: { id: "upstream-wait-cancel", model: "Images" },
            },
            {
                poll: async () => ({ status: "pending" }),
                materialize: async () => {
                    throw new Error("materialization must not run");
                },
                patchMetadata: async () => {},
                cancel: async () => {
                    cancelled += 1;
                },
                signal: controller.signal,
                sleep: async () => {
                    controller.abort();
                    throw new DOMException("Aborted", "AbortError");
                },
            },
        ),
        { name: "AbortError" },
    );

    assert.equal(cancelled, 1);
});

test("image workbench cancellation passes the real platform task identity", async () => {
    const controller = new AbortController();
    controller.abort();
    let cancelledTask;

    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-cancel-real-id",
                upstreamTask: { id: "upstream-cancel-real-id", model: "Images" },
            },
            {
                poll: async () => ({ status: "pending" }),
                materialize: async () => {
                    throw new Error("materialization must not run");
                },
                patchMetadata: async () => {},
                cancel: async (task) => {
                    cancelledTask = task;
                },
                signal: controller.signal,
                sleep: async () => {},
            },
        ),
        { name: "AbortError" },
    );

    assert.equal(cancelledTask.platformTaskId, "platform-cancel-real-id");
    assert.equal(cancelledTask.upstreamTask.id, "upstream-cancel-real-id");
    assert.equal(imageWorkbenchTaskStatusForError(new Error("cancelled"), true), "cancelled");
});

test("image workbench remote cancellation sends the upstream task id and model", async () => {
    const previousPost = axios.post;
    let request;
    axios.post = async (url, body, options) => {
        request = { url, body, options };
        return { data: { status: "cancelled" } };
    };

    try {
        await cancelImageWorkbenchTask(
            { ...defaultConfig, channelMode: "remote", model: "Images", imageModel: "Images" },
            {
                source: "image_workbench",
                platformTaskId: "platform-cancel-request",
                upstreamTask: { id: "upstream-cancel-request", model: "Images" },
            },
        );
    } finally {
        axios.post = previousPost;
    }

    assert.equal(request.url, "/api/v1/tasks/upstream-cancel-request/cancel");
    assert.deepEqual(request.body, { model: "Images" });
});

test("image workbench keeps recovery identity when remote cancellation is not confirmed", async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
        completeImageWorkbenchTask(
            {
                source: "image_workbench",
                platformTaskId: "platform-cancel-pending",
                upstreamTask: { id: "upstream-cancel-pending", model: "Images" },
            },
            {
                poll: async () => ({ status: "pending" }),
                materialize: async () => {
                    throw new Error("materialization must not run");
                },
                patchMetadata: async () => {},
                cancel: async () => {
                    throw new Error("upstream has not confirmed cancellation");
                },
                signal: controller.signal,
                sleep: async () => {},
            },
        ),
        (error) => {
            assert.equal(isImageWorkbenchTaskRetryableError(error), true);
            assert.equal(imageWorkbenchTaskStatusForError(error, true), "pending");
            return true;
        },
    );
});

test("image workbench deletion expands platform task ids and falls back for legacy logs", () => {
    assert.deepEqual(
        imageWorkbenchDeletionIds({
            id: "local-batch-id",
            tasks: [
                { index: 0, source: "image_workbench", platformTaskId: "platform-delete-1", status: "succeeded" },
                { index: 1, source: "image_workbench", platformTaskId: "platform-delete-2", status: "failed" },
                { index: 2, source: "image_workbench", platformTaskId: "platform-delete-1", status: "failed" },
            ],
        }),
        ["platform-delete-1", "platform-delete-2"],
    );
    assert.deepEqual(imageWorkbenchDeletionIds({ id: "legacy-batch-id", tasks: [] }), ["legacy-batch-id"]);
});
