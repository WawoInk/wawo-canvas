import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { cancelVideoGenerationTask } from "../../services/api/video.ts";
import { buildVideoWorkbenchGenerationCommand, completeVideoWorkbenchTask, createVideoWorkbenchTask } from "./video-async-task.ts";

const standardProfile = {
    id: "seedance-profile",
    intents: ["video.generate"],
    capabilities: {
        settings: {
            aspectRatio: { type: "enum", values: ["16:9", "9:16"], default: "16:9" },
            resolution: { type: "enum", values: ["720p", "1080p"], default: "720p" },
            durationSeconds: { type: "duration", min: 4, max: 12, allowAuto: true, default: 8 },
            generateAudio: { type: "boolean", default: true },
            watermark: { type: "boolean", default: false },
        },
        cancellation: false,
        completion: ["poll"],
    },
};

test("remote video workbench submits its configured Profile to the first-party route", async () => {
    const previousAdapter = axios.defaults.adapter;
    const requests = [];
    axios.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        if (config.method === "post" && config.url === "/api/v1/generations") {
            return {
                data: {
                    code: 0,
                    data: {
                        id: "generation-42",
                        status: "queued",
                        modelProfileId: standardProfile.id,
                        intentKind: "video.generate",
                        createdAt: "2026-08-20T00:00:00Z",
                    },
                    msg: "ok",
                },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        }
        throw new Error(`unexpected request: ${config.url}`);
    };

    try {
        const task = await createVideoWorkbenchTask({ ...defaultConfig, channelMode: "remote", model: standardProfile.id, videoModel: standardProfile.id }, "make a launch film", [], [], [], { profile: standardProfile });

        assert.equal(task.id, "generation-42");
        assert.equal(task.firstParty, true);
        assert.equal(task.model, standardProfile.id);
        assert.equal(task.cancellation, false);
        assert.deepEqual(requests, ["post /api/v1/generations"]);
    } finally {
        axios.defaults.adapter = previousAdapter;
    }
});

test("first-party video completion reads the server-materialized file", async () => {
    const previousAdapter = axios.defaults.adapter;
    const requests = [];
    axios.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        return {
            data: {
                code: 0,
                data: {
                    id: "generation-43",
                    status: "succeeded",
                    modelProfileId: standardProfile.id,
                    intentKind: "video.generate",
                    result: { kind: "video", file: { fileId: "file-video-9", mimeType: "video/mp4", bytes: 456 } },
                    createdAt: "2026-08-20T00:00:00Z",
                },
                msg: "ok",
            },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        };
    };
    try {
        const video = await completeVideoWorkbenchTask(
            { id: "generation-43", model: standardProfile.id, firstParty: true, clientRequestId: "request-43", cancellation: false },
            {
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
            },
        );

        assert.equal(video.fileId, "file-video-9");
        assert.deepEqual(requests, ["get /api/v1/generations/generation-43"]);
    } finally {
        axios.defaults.adapter = previousAdapter;
    }
});

test("builds a short-drama command with platform files and explicit image roles", () => {
    const profile = {
        id: "vidu-profile",
        intents: ["video.short-drama"],
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["9:16"], default: "9:16" },
                resolution: { type: "enum", values: ["1080p"], default: "1080p" },
                durationSeconds: { type: "duration", min: 8, max: 12, allowAuto: true, default: "auto" },
                quality: { type: "enum", values: ["standard", "high"], default: "high" },
            },
            title: { required: true, minLength: 1, maxLength: 20 },
            script: { required: true, minLength: 20, maxLength: 5000 },
            assets: { required: true, min: 1, max: 14, nameMaxLength: 30, roles: ["character", "scene", "tool"], mimeTypes: ["image/png"] },
            cancellation: false,
            completion: ["poll"],
        },
    };
    const command = buildVideoWorkbenchGenerationCommand({
        clientRequestId: "drama-request-1",
        profile,
        config: { ...defaultConfig, channelMode: "remote", model: profile.id, videoModel: profile.id, size: "9:16", vquality: "1080p", videoSeconds: "-1", quality: "high" },
        prompt: "人物：林尘。分镜一：林尘在典当行擦拭柜台，神情淡然。",
        title: "典当行退婚",
        references: [{ id: "asset-1", name: "林尘", type: "image/png", dataUrl: "https://files.test/asset-1", fileId: "file-asset-1" }],
        videoReferences: [],
        audioReferences: [],
        dramaAssetRoles: { "asset-1": "character" },
    });

    assert.deepEqual(command, {
        commandVersion: 1,
        clientRequestId: "drama-request-1",
        modelProfileId: profile.id,
        source: "video_workbench",
        intent: {
            kind: "video.short-drama",
            title: "典当行退婚",
            script: "人物：林尘。分镜一：林尘在典当行擦拭柜台，神情淡然。",
            assets: [{ sourceNodeId: "asset-1", role: "character", name: "林尘", reference: { fileId: "file-asset-1", sourceNodeId: "asset-1", name: "林尘" } }],
            settings: { aspectRatio: "9:16", resolution: "1080p", durationSeconds: "auto", quality: "high" },
        },
    });
});

test("compatibility video cancellation addresses the upstream task id", async () => {
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
