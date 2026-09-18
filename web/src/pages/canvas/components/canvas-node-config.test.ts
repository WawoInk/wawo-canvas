import assert from "node:assert/strict";
import test from "node:test";

import type { PublicSettings } from "@/services/api/settings";
import type { AiConfig } from "@/stores/use-config-store";
import { audioConfigPatch, buildNodeConfig, videoConfigPatch } from "./canvas-node-config";
import type { CanvasNodeData } from "../types";

const defaults: AiConfig = {
    channelMode: "local",
    baseUrl: "",
    apiKey: "",
    apiFormat: "openai",
    channels: [],
    model: "default-image",
    imageModel: "default-image",
    videoModel: "default-video",
    textModel: "default-text",
    audioModel: "default-audio",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoMode: "reference",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoNegativePrompt: "",
    background: "",
    systemPrompt: "",
    imageRequestFormats: [],
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "auto",
    count: "1",
    canvasImageCount: "4",
};

const node = (metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    id: "node-1",
    type: "image" as CanvasNodeData["type"],
    title: "Node",
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    metadata,
});

const adminSettings: PublicSettings = {
    modelChannel: {
        availableModels: ["node-model", "global-image", "image-4k", "image-2k", "default-video", "default-text", "default-audio"],
        modelCosts: [],
        imageRequestFormats: [
            { model: "image-4k", format: "default", canvasRequestMode: "split", resolutions: ["4k"] },
            { model: "image-2k", format: "default", canvasRequestMode: "split", resolutions: ["1k", "2k"] },
        ],
        defaultModel: "default-text",
        defaultImageModel: "global-image",
        defaultVideoModel: "default-video",
        defaultTextModel: "default-text",
        defaultAudioModel: "default-audio",
        imageModels: ["node-model", "global-image", "image-4k", "image-2k"],
        videoModels: ["default-video"],
        textModels: ["default-text"],
        textModelProtocols: { "default-text": "openai" },
        audioModels: ["default-audio"],
        systemPrompt: "",
        allowCustomChannel: true,
    },
    auth: { allowRegister: true, linuxDo: { enabled: false } },
};

test("buildNodeConfig preserves node overrides and image canvas count", () => {
    const config = buildNodeConfig({ ...defaults, imageModel: "global-image", canvasImageCount: "3", background: "transparent" }, defaults, node({ model: "node-model", quality: "hd", count: 2, background: "" }), "image", adminSettings);
    assert.equal(config.model, "node-model");
    assert.equal(config.quality, "hd");
    assert.equal(config.count, "2");
    assert.equal(config.background, "");
});

test("reverse prompt configs use the administrator text model through the platform", () => {
    const config = buildNodeConfig({ ...defaults, textModel: "local-text" }, defaults, node({ model: "local-text" }), "text", {
        modelChannel: {
            availableModels: ["admin-text", "admin-text-alt", "image-only"],
            modelCosts: [],
            imageRequestFormats: [],
            defaultModel: "",
            defaultImageModel: "image-only",
            defaultVideoModel: "",
            defaultTextModel: "admin-text",
            defaultAudioModel: "",
            imageModels: ["image-only"],
            videoModels: [],
            textModels: ["admin-text", "admin-text-alt"],
            textModelProtocols: { "admin-text": "openai", "admin-text-alt": "xvanai" },
            audioModels: [],
            systemPrompt: "",
            allowCustomChannel: true,
        },
        auth: { allowRegister: true, linuxDo: { enabled: false } },
    });

    assert.equal(config.channelMode, "remote");
    assert.equal(config.model, "admin-text");
    assert.equal(config.textModel, "admin-text");
    assert.equal(config.apiFormat, "openai");
    assert.deepEqual(config.textModels, ["admin-text", "admin-text-alt"]);
});

test("canvas configs ignore local channels and use administrator models", () => {
    const canvasSettings: PublicSettings = {
        modelChannel: {
            availableModels: ["admin-image", "admin-text", "admin-audio"],
            modelCosts: [],
            imageRequestFormats: [],
            defaultModel: "admin-text",
            defaultImageModel: "admin-image",
            defaultVideoModel: "admin-video",
            defaultTextModel: "admin-text",
            defaultAudioModel: "admin-audio",
            imageModels: ["admin-image"],
            videoModels: ["admin-video"],
            textModels: ["admin-text"],
            textModelProtocols: { "admin-text": "xvanai" },
            audioModels: ["admin-audio"],
            systemPrompt: "admin prompt",
            allowCustomChannel: true,
        },
        auth: { allowRegister: true, linuxDo: { enabled: false } },
    };
    const config = buildNodeConfig(
        {
            ...defaults,
            channelMode: "local",
            baseUrl: "https://local.example/v1",
            apiKey: "local-key",
            imageModel: "local-image",
            imageModels: ["local-image"],
        },
        defaults,
        node({ model: "local-image" }),
        "image",
        canvasSettings,
    );

    assert.equal(config.channelMode, "remote");
    assert.equal(config.model, "admin-image");
    assert.equal(config.imageModel, "admin-image");
    assert.deepEqual(config.imageModels, ["admin-image"]);
    assert.equal(config.baseUrl, "");
    assert.equal(config.apiKey, "");
    assert.deepEqual(config.channels, []);
    for (const [mode, model] of [
        ["video", "admin-video"],
        ["text", "admin-text"],
        ["audio", "admin-audio"],
    ] as const) {
        const resolved = buildNodeConfig(defaults, defaults, node({ model: "local-model" }), mode, canvasSettings);
        assert.equal(resolved.channelMode, "remote");
        assert.equal(resolved.model, model);
    }

    const unavailable = buildNodeConfig(defaults, defaults, node({ model: "local-image" }), "image");
    assert.equal(unavailable.channelMode, "remote");
    assert.equal(unavailable.model, "");
    assert.deepEqual(unavailable.imageModels, []);
});

test("buildNodeConfig normalizes hidden image sizes without opening settings", () => {
    const config = buildNodeConfig(
        {
            ...defaults,
            channelMode: "remote",
            imageModel: "image-4k",
            imageRequestFormats: [
                { model: "image-4k", format: "default", canvasRequestMode: "split", resolutions: ["4k"] },
                { model: "image-2k", format: "default", canvasRequestMode: "split", resolutions: ["1k", "2k"] },
            ],
        },
        defaults,
        node({ model: "image-2k", size: "3840x2160" }),
        "image",
        adminSettings,
    );
    assert.equal(config.size, "1536x864");
});

test("buildNodeConfig maps media metadata to effective config", () => {
    const config = buildNodeConfig(
        defaults,
        defaults,
        node({ seconds: "12", generateAudio: "false", watermark: "true", negativePrompt: "低质量，模糊", audioVoice: "nova", audioFormat: "wav", audioSpeed: "1.25", audioInstructions: "calm" }),
        "video",
        adminSettings,
    );
    assert.equal(config.videoSeconds, "12");
    assert.equal(config.videoGenerateAudio, "false");
    assert.equal(config.videoWatermark, "true");
    assert.equal(config.videoNegativePrompt, "低质量，模糊");
    assert.equal(config.audioVoice, "nova");
    assert.equal(config.audioFormat, "wav");
    assert.equal(config.audioSpeed, "1.25");
    assert.equal(config.audioInstructions, "calm");
});

test("buildNodeConfig defaults canvas video audio generation off", () => {
    const config = buildNodeConfig(defaults, defaults, node(), "video", adminSettings);
    assert.equal(config.videoGenerateAudio, "false");
});

test("buildNodeConfig replaces smart duration with the canvas default", () => {
    const config = buildNodeConfig({ ...defaults, videoSeconds: "-1" }, defaults, node({ seconds: "-1" }), "video", adminSettings);
    assert.equal(config.videoSeconds, "6");
});

test("config patches map setting keys to node metadata", () => {
    assert.deepEqual(videoConfigPatch("videoSeconds", "10"), { seconds: "10" });
    assert.deepEqual(videoConfigPatch("videoGenerateAudio", "false"), { generateAudio: "false" });
    assert.deepEqual(videoConfigPatch("videoWatermark", "true"), { watermark: "true" });
    assert.deepEqual(videoConfigPatch("videoNegativePrompt", "低质量，模糊"), { negativePrompt: "低质量，模糊" });
    assert.deepEqual(videoConfigPatch("vquality", "1080"), { vquality: "1080" });
    assert.deepEqual(audioConfigPatch("audioVoice", "nova"), { audioVoice: "nova" });
    assert.deepEqual(audioConfigPatch("audioInstructions", "calm"), { audioInstructions: "calm" });
});

test("video mode belongs to each node and survives setting patches", () => {
    const metadata = videoConfigPatch("videoMode", "frames");
    const config = buildNodeConfig(defaults, defaults, node(metadata), "video", adminSettings);
    assert.equal(config.videoMode, "frames");
    assert.equal(buildNodeConfig(defaults, defaults, node({}), "video", adminSettings).videoMode, "reference");
});
