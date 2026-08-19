import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { completeImageWorkbenchTask, createImageWorkbenchTask } from "./image-async-task.ts";

test("async image completion patches file metadata with the remote generation task id", async () => {
    const previousAdapter = axios.defaults.adapter;
    const patched = [];
    let source = "";
    axios.defaults.adapter = async (config) => {
        source = config.headers.get("X-Source");
        return {
            data: { id: "upstream-task-7" },
            status: 200,
            statusText: "OK",
            headers: { "x-generation-task-id": "remote-generation-42" },
            config,
        };
    };

    try {
        const task = await createImageWorkbenchTask({ ...defaultConfig, channelMode: "remote", model: "Images", imageModel: "Images" }, "draw a lighthouse", []);
        const image = await completeImageWorkbenchTask(task, {
            poll: async () => ({ status: "succeeded", images: [{ dataUrl: "https://provider.test/result.png" }] }),
            materialize: async () => ({
                fileId: "file-final-9",
                url: "https://files.test/file-final-9",
                width: 1536,
                height: 1024,
                bytes: 321,
                mimeType: "image/png",
            }),
            patchMetadata: async (taskId, metadata) => patched.push({ taskId, metadata }),
            sleep: async () => {},
        });

        assert.equal(source, "image_workbench");
        assert.equal(image.fileId, "file-final-9");
        assert.deepEqual(patched, [
            {
                taskId: "remote-generation-42",
                metadata: JSON.stringify({ fileIds: ["file-final-9"] }),
            },
        ]);
    } finally {
        axios.defaults.adapter = previousAdapter;
    }
});

test("async image timeout cancels the system task", async () => {
    let cancelled = 0;
    await assert.rejects(
        completeImageWorkbenchTask(
            { platformTaskId: "remote-generation-timeout", upstreamTask: { id: "upstream-task", model: "Images" } },
            {
                poll: async () => ({ status: "pending" }),
                materialize: async () => {
                    throw new Error("not reached");
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

test("async image cancellation cancels the system task", async () => {
    const controller = new AbortController();
    controller.abort();
    let cancelled = 0;
    await assert.rejects(
        completeImageWorkbenchTask(
            { platformTaskId: "remote-generation-cancelled", upstreamTask: { id: "upstream-task", model: "Images" } },
            {
                poll: async () => ({ status: "pending" }),
                materialize: async () => {
                    throw new Error("not reached");
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
