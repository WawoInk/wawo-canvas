import assert from "node:assert/strict";
import { test } from "node:test";

import i18n from "@/i18n";
import { buildNodeGenerationContext, buildNodeResponseMessages, buildShortDramaGenerationIntent, buildVideoGenerationIntent, cleanShortDramaAssetMappings, hydrateNodeGenerationContext, locateGenerationError, prepareFirstPartyCanvasVideoRun } from "./canvas-node-generation.ts";

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

test("keeps uploaded file IDs in Canvas image references", () => {
    const target = { id: "image-target", type: "image", title: "输出图片", metadata: {} };
    const context = buildNodeGenerationContext("image-target", [image, target], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "image-target" }], "替换背景");

    assert.equal(context.referenceImages[0].fileId, "file-image-1");
});

test("compiles reverse prompt composer inputs into a multimodal model message", () => {
    const instruction = { id: "instruction-1", type: "text", title: "反推提示词", metadata: { content: "只输出完整的生图提示词" } };
    const config = { id: "config-1", type: "config", title: "反推提示词配置", metadata: { composerContent: "参考图片：@[node:image-1]\n任务说明：@[node:instruction-1]" } };
    const context = buildNodeGenerationContext(
        "config-1",
        [image, instruction, config],
        [
            { id: "image-config", fromNodeId: "image-1", toNodeId: "config-1" },
            { id: "instruction-config", fromNodeId: "instruction-1", toNodeId: "config-1" },
        ],
        config.metadata.composerContent,
    );

    assert.equal(context.referenceImages.length, 1);
    assert.match(context.prompt, /只输出完整的生图提示词/);
    assert.deepEqual(buildNodeResponseMessages(context)[0].content[1], { type: "image_url", image_url: { url: image.metadata.content } });
});

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

test("expands mixed Group connections through origin and Generation Run compilers", () => {
    const group = { id: "group-1", type: "group", title: "参考组", metadata: {} };
    const groupedImage = { ...image, id: "group-image", metadata: { ...image.metadata, groupId: "group-1" } };
    const groupedVideo = { id: "group-video", type: "video", title: "动作参考", metadata: { groupId: "group-1", materialSource: "volcengine", volcengineAssetId: "asset-group-video" } };
    const groupedText = { id: "group-text", type: "text", title: "文案参考", metadata: { groupId: "group-1", content: "保持人物服装一致" } };
    const config = { id: "config-1", type: "config", title: "配置", metadata: { composerContent: "使用参考" } };
    const nodes = [group, groupedImage, groupedVideo, groupedText, config, videoTarget];

    const context = buildNodeGenerationContext("config-1", nodes, [{ id: "group-config", fromNodeId: "group-1", toNodeId: "config-1" }], "@[node:group-image] @[node:group-video] @[node:group-text]");
    assert.equal(context.referenceImages[0].fileId, "file-image-1");
    assert.equal(context.referenceVideos[0].url, "asset://asset-group-video");
    assert.match(context.prompt, /保持人物服装一致/);

    const settings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: 10, generateAudio: false, watermark: true };
    const intent = buildVideoGenerationIntent("video-1", nodes, [{ id: "group-video-target", fromNodeId: "group-1", toNodeId: "video-1" }], "人物走进雨夜街道", settings);
    assert.deepEqual(intent.references, {
        images: [{ fileId: "file-image-1", sourceNodeId: "group-image", name: "人物参考" }],
        videos: [{ assetId: "asset-group-video", sourceNodeId: "group-video", name: "动作参考" }],
        audios: [],
    });
});

test("compiles Volcengine Canvas media as asset references", () => {
    const volcengineImage = { ...image, metadata: { ...image.metadata, materialSource: "volcengine", volcengineAssetId: "asset-image-1" } };
    const volcengineVideo = { id: "video-asset-1", type: "video", title: "动作参考", metadata: { materialSource: "volcengine", volcengineAssetId: "asset-video-1" } };
    const volcengineAudio = { id: "audio-asset-1", type: "audio", title: "配乐参考", metadata: { materialSource: "volcengine", volcengineAssetId: "asset-audio-1" } };
    const settings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: 10, generateAudio: false, watermark: true };

    assert.deepEqual(
        buildVideoGenerationIntent(
            "video-1",
            [volcengineImage, volcengineVideo, volcengineAudio, videoTarget],
            [
                { id: "connection-image", fromNodeId: "image-1", toNodeId: "video-1" },
                { id: "connection-video", fromNodeId: "video-asset-1", toNodeId: "video-1" },
                { id: "connection-audio", fromNodeId: "audio-asset-1", toNodeId: "video-1" },
            ],
            "人物走进雨夜街道",
            settings,
        ),
        {
            kind: "video.generate",
            prompt: "人物走进雨夜街道",
            references: {
                images: [{ assetId: "asset-image-1", sourceNodeId: "image-1", name: "人物参考" }],
                videos: [{ assetId: "asset-video-1", sourceNodeId: "video-asset-1", name: "动作参考" }],
                audios: [{ assetId: "asset-audio-1", sourceNodeId: "audio-asset-1", name: "配乐参考" }],
            },
            settings,
        },
    );
});

test("keeps Volcengine asset IDs in compatibility video references", () => {
    const volcengineImage = { ...image, metadata: { content: "", materialSource: "volcengine", volcengineAssetId: "asset-image-1" } };
    const volcengineVideo = { id: "video-asset-1", type: "video", title: "动作参考", metadata: { content: "", materialSource: "volcengine", volcengineAssetId: "asset-video-1" } };
    const volcengineAudio = { id: "audio-asset-1", type: "audio", title: "配乐参考", metadata: { content: "", materialSource: "volcengine", volcengineAssetId: "asset-audio-1" } };
    const context = buildNodeGenerationContext(
        "video-1",
        [volcengineImage, volcengineVideo, volcengineAudio, videoTarget],
        [
            { id: "connection-image", fromNodeId: "image-1", toNodeId: "video-1" },
            { id: "connection-video", fromNodeId: "video-asset-1", toNodeId: "video-1" },
            { id: "connection-audio", fromNodeId: "audio-asset-1", toNodeId: "video-1" },
        ],
        "让参考素材动起来",
    );

    assert.deepEqual([context.referenceImages[0].assetId, context.referenceVideos[0].assetId, context.referenceAudios[0].assetId], ["asset-image-1", "asset-video-1", "asset-audio-1"]);
});

test("does not hydrate a Volcengine asset through its preview URL", async () => {
    const context = buildNodeGenerationContext(
        "video-1",
        [{ ...image, metadata: { content: "", materialSource: "volcengine", volcengineAssetId: "asset-image-1" } }, videoTarget],
        [{ id: "connection-image", fromNodeId: "image-1", toNodeId: "video-1" }],
        "让参考素材动起来",
    );

    const hydrated = await hydrateNodeGenerationContext(context);
    assert.equal(hydrated.referenceImages[0].assetId, "asset-image-1");
    assert.equal(hydrated.referenceImages[0].dataUrl, "");
});

test("rejects connected first-party media without a platform file", () => {
    const settings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: 10, generateAudio: false, watermark: true };
    const localOnly = { ...image, metadata: { ...image.metadata, fileId: undefined } };
    assertTranslatedError(() => buildVideoGenerationIntent("video-1", [localOnly, videoTarget], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "prompt", settings), "canvas.generation.errors.resourceNotUploaded", {
        name: image.title,
    });
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
                durationSeconds: { type: "duration", min: 4, max: 30, default: 10 },
                videoMode: { type: "enum", values: ["reference", "frames"], default: "reference" },
                generateAudio: { type: "boolean", default: true },
                watermark: { type: "boolean", default: false },
            },
        },
    };
    const config = { videoMode: "frames", model: profile.id, size: "9:16", vquality: "1080p", videoSeconds: "24", videoGenerateAudio: "true", videoWatermark: "false", videoNegativePrompt: "  低质量，模糊  ", quality: "high" };
    const run = prepareFirstPartyCanvasVideoRun({ nodeId: "video-1", nodes: [image, videoTarget], connections: [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], prompt: "prompt", config, profile, clientRequestId: "request-stable" });
    assert.equal(run.command.clientRequestId, "request-stable");
    assert.equal(run.command.modelProfileId, "stable-profile");
    assert.equal(run.command.intent.negativePrompt, "低质量，模糊");
    assert.equal(run.command.intent.settings.durationSeconds, 24);
    assert.equal(run.command.intent.settings.videoMode, "frames");
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

    const cappedRun = prepareFirstPartyCanvasVideoRun({
        nodeId: "video-1",
        nodes: [image, videoTarget],
        connections: [],
        prompt: "prompt",
        config,
        profile: { ...profile, capabilities: { ...profile.capabilities, settings: { ...profile.capabilities.settings, durationSeconds: { ...profile.capabilities.settings.durationSeconds, max: 20 } } } },
        clientRequestId: "request-capped",
    });
    assert.equal(cappedRun.command.intent.settings.durationSeconds, 20);
});

test("compiles profile-bounded duration for first-party Canvas Drama runs", () => {
    const target = { ...videoTarget, title: "典当行退婚", metadata: { dramaAssetRoles: { "image-1": "character" } } };
    const profile = {
        id: "drama-profile",
        intents: ["video.short-drama"],
        capabilities: {
            cancellation: true,
            settings: {
                aspectRatio: { type: "enum", values: ["9:16"], default: "9:16" },
                resolution: { type: "enum", values: ["1080p"], default: "1080p" },
                durationSeconds: { type: "duration", min: 4, max: 30, default: 10, allowAuto: true },
                quality: { type: "enum", values: ["high"], default: "high" },
            },
        },
    };
    const input = {
        nodeId: "video-1",
        nodes: [image, target],
        connections: [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }],
        prompt: "人物：林尘。分镜1-1：林尘在典当行擦拭柜台。",
        config: { model: profile.id, size: "9:16", vquality: "1080p", videoSeconds: "24", quality: "high" },
        profile,
        clientRequestId: "drama-24",
    };

    const run = prepareFirstPartyCanvasVideoRun(input);
    assert.equal(run.command.intent.kind, "video.short-drama");
    assert.equal(run.command.intent.settings.durationSeconds, 24);

    const cappedRun = prepareFirstPartyCanvasVideoRun({
        ...input,
        profile: { ...profile, capabilities: { ...profile.capabilities, settings: { ...profile.capabilities.settings, durationSeconds: { ...profile.capabilities.settings.durationSeconds, max: 20 } } } },
        clientRequestId: "drama-capped",
    });
    assert.equal(cappedRun.command.intent.settings.durationSeconds, 20);
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

test("compiles Volcengine Drama images as asset references", () => {
    const volcengineImage = { ...image, metadata: { ...image.metadata, materialSource: "volcengine", volcengineAssetId: "asset-drama-image-1" } };
    const target = {
        ...videoTarget,
        title: "典当行退婚",
        metadata: { dramaAssetRoles: { "image-1": "character" } },
    };
    const settings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: "auto", quality: "high" };

    assert.deepEqual(buildShortDramaGenerationIntent("video-1", [volcengineImage, target], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "人物：林尘。分镜1-1：林尘在典当行擦拭柜台，神情淡然。", settings), {
        kind: "video.short-drama",
        title: "典当行退婚",
        script: "人物：林尘。分镜1-1：林尘在典当行擦拭柜台，神情淡然。",
        assets: [{ sourceNodeId: "image-1", role: "character", name: "人物参考", reference: { assetId: "asset-drama-image-1", sourceNodeId: "image-1", name: "人物参考" } }],
        settings,
    });
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
    assertTranslatedError(
        () => buildShortDramaGenerationIntent("video-1", [image, { ...videoTarget, title: "" }], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "脚本", settings),
        "canvas.generation.errors.shortDramaTitleRequired",
    );
    assertTranslatedError(
        () => buildShortDramaGenerationIntent("video-1", [image, { ...videoTarget, title: "短剧" }], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "", settings),
        "canvas.generation.errors.shortDramaScriptRequired",
    );
    assertTranslatedError(
        () => buildShortDramaGenerationIntent("video-1", [image, { ...videoTarget, title: "短剧", metadata: {} }], [{ id: "connection-1", fromNodeId: "image-1", toNodeId: "video-1" }], "完整脚本", settings),
        "canvas.generation.errors.shortDramaRoleRequired",
        { name: image.title },
    );
});

function assertTranslatedError(callback, key, options) {
    assert.throws(callback, (error) => {
        assert.equal(error.message, i18n.t(key, options));
        return true;
    });
}

test("numbers connected text blocks in reference order without changing the user prompt or media", async () => {
    const language = i18n.language;
    await i18n.changeLanguage("zh-CN");
    try {
        const target = { id: "out", type: "image", title: "输出", metadata: {} };
        const texts = [
            { id: "text-b", type: "text", title: "场景", metadata: { content: "第二段\n包含换行" } },
            { id: "text-a", type: "text", title: "人物", metadata: { content: "第一段" } },
        ];
        const context = buildNodeGenerationContext(
            "out",
            [...texts, image, target],
            [
                { id: "a", fromNodeId: "text-a", toNodeId: "out" },
                { id: "i", fromNodeId: image.id, toNodeId: "out" },
                { id: "b", fromNodeId: "text-b", toNodeId: "out" },
            ],
            "结合文本1和文本2生成",
        );
        assert.equal(context.prompt, "结合文本1和文本2生成\n\n【文本1】\n第一段\n\n【文本2】\n第二段\n包含换行");
        assert.equal(context.textCount, 2);
        assert.equal(context.referenceImages[0].fileId, "file-image-1");
    } finally {
        await i18n.changeLanguage(language);
    }
});
