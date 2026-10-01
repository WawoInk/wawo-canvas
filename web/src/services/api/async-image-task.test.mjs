import assert from "node:assert/strict";
import { test } from "node:test";

import { completeAsyncImageTask } from "./async-image-task.ts";

test("stops observation when an aborted poll still returns success", async () => {
    const controller = new AbortController();
    const calls = [];
    await assert.rejects(
        completeAsyncImageTask(
            { platformTaskId: "platform-image", upstreamTask: { id: "upstream-image", model: "Images" } },
            {
                signal: controller.signal,
                poll: async () => {
                    controller.abort();
                    return { status: "succeeded", images: [{ dataUrl: "https://provider.test/image.png" }] };
                },
                materialize: async () => {
                    calls.push("materialize");
                    return { fileId: "late-file" };
                },
                patchMetadata: async () => calls.push("patch"),
                cancel: async () => calls.push("cancel"),
            },
        ),
        { name: "AbortError" },
    );
    assert.deepEqual(calls, ["cancel"]);
});

test("stops observation when an in-flight image upload finishes after abort", async () => {
    const controller = new AbortController();
    const calls = [];
    await assert.rejects(
        completeAsyncImageTask(
            { platformTaskId: "platform-image", upstreamTask: { id: "upstream-image", model: "Images", images: [{ dataUrl: "https://provider.test/image.png" }] } },
            {
                signal: controller.signal,
                poll: async () => assert.fail("an immediate image does not need polling"),
                materialize: async () => {
                    controller.abort();
                    return { fileId: "late-file" };
                },
                patchMetadata: async () => calls.push("patch"),
                cancel: async () => calls.push("cancel"),
            },
        ),
        { name: "AbortError" },
    );
    assert.deepEqual(calls, ["cancel"]);
});

test("does not return a late image after abort during task metadata persistence", async () => {
    const controller = new AbortController();
    let cancelled = 0;
    await assert.rejects(
        completeAsyncImageTask(
            { platformTaskId: "platform-image", upstreamTask: { id: "upstream-image", model: "Images" } },
            {
                signal: controller.signal,
                poll: async () => ({ status: "succeeded", images: [{ dataUrl: "https://provider.test/image.png" }] }),
                materialize: async () => ({ fileId: "late-file" }),
                patchMetadata: async () => controller.abort(),
                cancel: async () => {
                    cancelled += 1;
                },
            },
        ),
        { name: "AbortError" },
    );
    assert.equal(cancelled, 1);
});

test("materializes a Canvas image result into its platform generation task", async () => {
    const states = [{ status: "pending" }, { status: "succeeded", images: [{ dataUrl: "https://provider.test/result.png" }] }];
    const patched = [];

    const stored = await completeAsyncImageTask(
        {
            platformTaskId: "platform-image-42",
            upstreamTask: { id: "upstream-image-7", model: "Images" },
        },
        {
            poll: async () => states.shift(),
            materialize: async (dataUrl) => {
                assert.equal(dataUrl, "https://provider.test/result.png");
                return {
                    fileId: "file-image-9",
                    url: "https://files.test/file-image-9",
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

    assert.equal(stored.fileId, "file-image-9");
    assert.deepEqual(patched, [{ taskId: "platform-image-42", metadata: JSON.stringify({ fileIds: ["file-image-9"] }) }]);
});
