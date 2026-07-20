import assert from "node:assert/strict";
import { test } from "node:test";

import { buildShortDramaGenerationIntent, buildVideoGenerationIntent, cleanShortDramaAssetMappings, locateGenerationError, prepareFirstPartyCanvasVideoRun } from "./canvas-node-generation.ts";

const image = {
    id: "image-1",
    type: "image",
    title: "人物参考",
    metadata: {
        content: "data:image/png;base64,secret",
        storageKey: "indexed-db-key",
        fileId: "file-image-1",
    },
};
const videoTarget = { id: "video-1", type: "video", title: "输出视频", metadata: {} };

test("compiles Canvas media and settings as a first-party intent", () => {
    const settings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: 10, generateAudio: false, watermark: true };
    const intent = buildVideoGenerationIntent("video-1", [image, videoTarget], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "人物走进雨夜街道", settings);

    assert.deepEqual(intent, {
        kind: "video.generate",
        prompt: "人物走进雨夜街道",
        references: {
            images: [{ fileId: "file-image-1", sourceNodeId: "image-1", name: "人物参考" }],
            videos: [],
            audios: [],
        },
        settings,
    });
    const serialized = JSON.stringify(intent);
    for (const providerField of ["dataUrl", "storageKey", "image_url", "generate_audio", "ratio"]) assert.equal(serialized.includes(`"${providerField}":`), false);
});

test("rejects connected first-party media without a platform file", () => {
    const settings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: 10, generateAudio: false, watermark: true };
    const localOnly = { ...image, metadata: { ...image.metadata, fileId: undefined } };
    assert.throws(() => buildVideoGenerationIntent("video-1", [localOnly, videoTarget], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "prompt", settings), /尚未上传到平台文件库/);
});

test("prepares a durable first-party Canvas video run", () => {
    const profile = {
        id: "stable-profile",
        intents: ["video.generate"],
        capabilities: {
            cancellation: false,
            settings: {
                aspectRatio: { type: "enum", values: ["9:16"], default: "9:16" },
                resolution: { type: "enum", values: ["1080p"], default: "1080p" },
                durationSeconds: { type: "duration", min: 4, max: 12, default: 10 },
                generateAudio: { type: "boolean", default: true },
                watermark: { type: "boolean", default: false },
            },
        },
    };
    const config = { model: profile.id, size: "9:16", vquality: "1080p", videoSeconds: "10", videoGenerateAudio: "true", videoWatermark: "false", videoNegativePrompt: "  低质量，模糊  ", quality: "high" };
    const run = prepareFirstPartyCanvasVideoRun({ nodeId: "video-1", nodes: [image, videoTarget], connections: [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], prompt: "prompt", config, profile, clientRequestId: "request-stable" });
    assert.equal(run.command.clientRequestId, "request-stable");
    assert.equal(run.command.modelProfileId, "stable-profile");
    assert.equal(run.command.intent.negativePrompt, "低质量，模糊");
    const serialized = JSON.stringify(run.command);
    for (const providerField of ["negative_prompt", "extra_params", "metadata"]) assert.equal(serialized.includes(`"${providerField}"`), false);
    assert.deepEqual(run.metadata, { generationClientRequestId: "request-stable", generationProfileId: "stable-profile", generationCancellation: false });

    const emptyRun = prepareFirstPartyCanvasVideoRun({
        nodeId: "video-1",
        nodes: [image, videoTarget],
        connections: [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }],
        prompt: "prompt",
        config: { ...config, videoNegativePrompt: "   " },
        profile,
        clientRequestId: "request-empty",
    });
    assert.equal("negativePrompt" in emptyRun.command.intent, false);
});

test("compiles connected Drama assets with roles stored on each target node", () => {
    const scene = { ...image, id: "image-2", title: "典当行", metadata: { ...image.metadata, fileId: "file-image-2" } };
    const otherTarget = { ...videoTarget, id: "video-2", metadata: { dramaAssetRoles: { "image-1": "scene" } } };
    const target = {
        ...videoTarget,
        title: "典当行退婚",
        metadata: {
            dramaAssetRoles: { "image-1": "character", "image-2": "scene", disconnected: "tool" },
            dramaAssetDescriptions: { "image-1": "男主角" },
        },
    };
    const connections = [
        { id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" },
        { id: "connection-2", fromNodeId: "image-2", toNodeId: "video-1" },
    ];

    const dramaSettings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: "auto", quality: "high" };
    assert.deepEqual(buildShortDramaGenerationIntent("video-1", [image, scene, target, otherTarget], connections, "人物：林尘。分镜1-1：林尘在典当行擦拭柜台，神情淡然。", dramaSettings), {
        kind: "video.short-drama",
        title: "典当行退婚",
        script: "人物：林尘。分镜1-1：林尘在典当行擦拭柜台，神情淡然。",
        assets: [
            { sourceNodeId: "image-1", role: "character", name: "人物参考", description: "男主角", reference: { fileId: "file-image-1", sourceNodeId: "image-1", name: "人物参考" } },
            { sourceNodeId: "image-2", role: "scene", name: "典当行", reference: { fileId: "file-image-2", sourceNodeId: "image-2", name: "典当行" } },
        ],
        settings: dramaSettings,
    });
    assert.equal(otherTarget.metadata.dramaAssetRoles["image-1"], "scene");
});

test("cleans disconnected Drama asset mappings", () => {
    const metadata = {
        dramaAssetRoles: { "image-1": "character", disconnected: "tool" },
        dramaAssetDescriptions: { "image-1": "男主角", disconnected: "旧道具" },
    };
    assert.deepEqual(cleanShortDramaAssetMappings(metadata, ["image-1"]), {
        ...metadata,
        dramaAssetRoles: { "image-1": "character" },
        dramaAssetDescriptions: { "image-1": "男主角" },
    });
});

test("locates structured generation errors without parsing provider codes", () => {
    assert.deepEqual(locateGenerationError({ code: "INVALID_SETTING", message: "value is not allowed", retryable: false, fieldPath: "intent.settings.durationSeconds" }), {
        fieldPath: "intent.settings.durationSeconds",
    });
    assert.deepEqual(locateGenerationError({ code: "MEDIA_UNSUPPORTED", message: "unsupported image format", retryable: false, fieldPath: "intent.assets.1.reference.fileId", resourceId: "image-2" }), {
        fieldPath: "intent.assets.1.reference.fileId",
        resourceId: "image-2",
    });
});

test("rejects incomplete Drama intent before submission", () => {
    const settings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: "auto", quality: "high" };
    assert.throws(() => buildShortDramaGenerationIntent("video-1", [image, { ...videoTarget, title: "" }], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "脚本", settings), /短剧标题/);
    assert.throws(() => buildShortDramaGenerationIntent("video-1", [image, { ...videoTarget, title: "短剧" }], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "", settings), /短剧脚本/);
    assert.throws(() => buildShortDramaGenerationIntent("video-1", [image, { ...videoTarget, title: "短剧", metadata: {} }], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "完整脚本", settings), /为图片「人物参考」选择角色/);
});
