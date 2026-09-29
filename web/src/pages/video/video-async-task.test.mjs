import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { cancelVideoGenerationTask } from "../../services/api/video.ts";
import { buildVideoWorkbenchGenerationCommand, completeVideoWorkbenchTask, createVideoWorkbenchTask, VIDEO_WORKBENCH_COMPATIBILITY_POLL_ATTEMPTS } from "./video-async-task.ts";

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

test("video workbench compiles ordinary video duration from the configured Profile", () => {
    const profile = {
        ...standardProfile,
        capabilities: {
            ...standardProfile.capabilities,
            settings: { ...standardProfile.capabilities.settings, videoMode: { type: "enum", values: ["reference", "frames"], default: "reference" }, durationSeconds: { ...standardProfile.capabilities.settings.durationSeconds, max: 30 } },
        },
    };
    const input = {
        clientRequestId: "video-duration-24",
        profile,
        config: { ...defaultConfig, channelMode: "remote", model: profile.id, videoModel: profile.id, videoSeconds: "24", videoMode: "frames" },
        prompt: "make a launch film",
        references: [],
        videoReferences: [],
        audioReferences: [],
    };

    assert.equal(buildVideoWorkbenchGenerationCommand(input).intent.settings.durationSeconds, 24);
    assert.equal(buildVideoWorkbenchGenerationCommand(input).intent.settings.videoMode, "frames");
    assert.equal(
        buildVideoWorkbenchGenerationCommand({
            ...input,
            profile: { ...profile, capabilities: { ...profile.capabilities, settings: { ...profile.capabilities.settings, durationSeconds: { ...profile.capabilities.settings.durationSeconds, max: 20 } } } },
        }).intent.settings.durationSeconds,
        20,
    );
});

test("video workbench submits a custom resolution published by its Profile", () => {
    const profile = {
        ...standardProfile,
        capabilities: {
            ...standardProfile.capabilities,
            settings: { ...standardProfile.capabilities.settings, resolution: { type: "enum", values: ["720p", "540p"], default: "720p" } },
        },
    };
    const command = buildVideoWorkbenchGenerationCommand({
        clientRequestId: "custom-resolution",
        profile,
        config: { ...defaultConfig, channelMode: "remote", model: profile.id, videoModel: profile.id, vquality: "540p" },
        prompt: "make a launch film",
        references: [],
        videoReferences: [],
        audioReferences: [],
    });
    assert.equal(command.intent.settings.resolution, "540p");
});

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

test("remote video workbench recovers an accepted task when the create response is lost", async () => {
    const previousAdapter = axios.defaults.adapter;
    const requests = [];
    axios.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        if (config.method === "post" && config.url === "/api/v1/generations") throw new Error("connection closed after submit");
        if (config.method === "get" && config.url === "/api/v1/generations/client-requests/request-lost") {
            return {
                data: { code: 0, data: { id: "generation-recovered", status: "queued", modelProfileId: standardProfile.id, intentKind: "video.generate", createdAt: "2026-08-20T00:00:00Z" }, msg: "ok" },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        }
        throw new Error(`unexpected request: ${config.url}`);
    };

    try {
        const task = await createVideoWorkbenchTask({ ...defaultConfig, channelMode: "remote", model: standardProfile.id, videoModel: standardProfile.id }, "make a launch film", [], [], [], {
            profile: standardProfile,
            clientRequestId: "request-lost",
        });
        assert.equal(task.id, "generation-recovered");
        assert.equal(task.clientRequestId, "request-lost");
        assert.deepEqual(requests, ["post /api/v1/generations", "get /api/v1/generations/client-requests/request-lost"]);
    } finally {
        axios.defaults.adapter = previousAdapter;
    }
});

test("local video workbench marks compatibility tasks with the video workbench source", async () => {
    const previousAdapter = axios.defaults.adapter;
    let source;
    axios.defaults.adapter = async (config) => {
        source = config.headers["X-Source"];
        return {
            data: { id: "compat-video-1", status: "queued" },
            status: 200,
            statusText: "OK",
            headers: {},
            config,
        };
    };

    try {
        const task = await createVideoWorkbenchTask(
            {
                ...defaultConfig,
                channelMode: "local",
                apiKey: "test-key",
                baseUrl: "https://video.test",
                model: "video-model",
                videoModel: "video-model",
                models: ["video-model"],
                videoModels: ["video-model"],
                channels: [{ id: "video", name: "Video", baseUrl: "https://video.test", apiKey: "test-key", apiFormat: "openai", models: ["video-model"] }],
            },
            "make a launch film",
            [],
            [],
            [],
        );

        assert.equal(task.id, "compat-video-1");
        assert.equal(source, "video_workbench");
    } finally {
        axios.defaults.adapter = previousAdapter;
    }
});

test("video workbench compatibility polling keeps the Canvas observation window", () => {
    assert.equal(VIDEO_WORKBENCH_COMPATIBILITY_POLL_ATTEMPTS, 360);
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
        const resolved = [];
        const video = await completeVideoWorkbenchTask(
            { id: "generation-43", model: standardProfile.id, firstParty: true, clientRequestId: "request-43", cancellation: false },
            {
                resolveFile: async (fileId, file) => {
                    resolved.push({ fileId, file });
                    return {
                        id: fileId,
                        url: "https://files.test/file-video-9",
                        fileId,
                        storageKey: "",
                        durationMs: 12000,
                        width: 1920,
                        height: 1080,
                        bytes: file.bytes || 0,
                        mimeType: file.mimeType,
                    };
                },
            },
        );

        assert.deepEqual(resolved, [
            {
                fileId: "file-video-9",
                file: { fileId: "file-video-9", mimeType: "video/mp4", bytes: 456 },
            },
        ]);
        assert.deepEqual(video, {
            id: "file-video-9",
            url: "https://files.test/file-video-9",
            fileId: "file-video-9",
            storageKey: "",
            durationMs: 12000,
            width: 1920,
            height: 1080,
            bytes: 456,
            mimeType: "video/mp4",
        });
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
                durationSeconds: { type: "duration", min: 8, max: 30, allowAuto: true, default: "auto" },
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
        config: { ...defaultConfig, channelMode: "remote", model: profile.id, videoModel: profile.id, size: "9:16", vquality: "1080p", videoSeconds: "24", quality: "high" },
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
            settings: { aspectRatio: "9:16", resolution: "1080p", durationSeconds: 24, quality: "high" },
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
