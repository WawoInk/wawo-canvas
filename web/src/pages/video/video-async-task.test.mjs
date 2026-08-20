import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { cancelVideoGenerationTask } from "../../services/api/video.ts";
import { completeVideoWorkbenchTask, createVideoWorkbenchTask } from "./video-async-task.ts";

test("remote video completion uses the compatibility task file id without polling upstream", async () => {
    const previousAdapter = axios.defaults.adapter;
    const requests = [];
    axios.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        if (config.method === "post") {
            return {
                data: { id: "upstream-video-7" },
                status: 200,
                statusText: "OK",
                headers: { "x-generation-task-id": "remote-generation-42" },
                config,
            };
        }
        throw new Error(`unexpected request: ${config.url}`);
    };

    try {
        const task = await createVideoWorkbenchTask({ ...defaultConfig, channelMode: "remote", model: "Videos", videoModel: "Videos" }, "make a launch film", [], [], []);
        const states = [{ task: { id: "remote-generation-42", status: "running", metadata: "" } }, { task: { id: "remote-generation-42", status: "succeeded", metadata: JSON.stringify({ fileIds: ["file-video-9"] }) } }];
        const video = await completeVideoWorkbenchTask(task, {
            pollTask: async () => states.shift(),
            resolveFile: async (fileId) => ({
                id: fileId,
                url: "https://files.test/file-video-9",
                fileId,
                storageKey: "",
                durationMs: 12000,
                width: 1920,
                height: 1080,
                bytes: 456,
                mimeType: "video/mp4",
            }),
            sleep: async () => {},
        });

        assert.equal(task.platformTaskId, "remote-generation-42");
        assert.equal(task.upstreamTask.id, "upstream-video-7");
        assert.equal(video.fileId, "file-video-9");
        assert.deepEqual(requests, ["post /api/v1/contents/generations/tasks"]);
    } finally {
        axios.defaults.adapter = previousAdapter;
    }
});

test("remote video task keeps the platform task id on the request result", async () => {
    const previousAdapter = axios.defaults.adapter;
    axios.defaults.adapter = async (config) => ({
        data: { id: "upstream-video-8" },
        status: 200,
        statusText: "OK",
        headers: { "x-generation-task-id": "remote-generation-43" },
        config,
    });
    try {
        const task = await createVideoWorkbenchTask({ ...defaultConfig, channelMode: "remote", model: "Videos", videoModel: "Videos" }, "make a launch film", [], [], []);
        assert.equal(task.platformTaskId, "remote-generation-43");
    } finally {
        axios.defaults.adapter = previousAdapter;
    }
});

test("remote video cancellation addresses the compatibility task by upstream id", async () => {
    const previousAdapter = axios.defaults.adapter;
    const requests = [];
    axios.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        return { data: {}, status: 200, statusText: "OK", headers: {}, config };
    };
    try {
        await cancelVideoGenerationTask({ ...defaultConfig, channelMode: "remote", model: "Videos", videoModel: "Videos" }, { id: "upstream-video-cancel", model: "Videos", platformTaskId: "remote-generation-cancel" });
        assert.deepEqual(requests, ["delete /api/v1/contents/generations/tasks/upstream-video-cancel"]);
    } finally {
        axios.defaults.adapter = previousAdapter;
    }
});
