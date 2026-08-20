import assert from "node:assert/strict";
import { test } from "node:test";

import { completeAsyncImageTask } from "./async-image-task.ts";

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
