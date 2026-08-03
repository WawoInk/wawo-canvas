import assert from "node:assert/strict";
import test from "node:test";

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

test("buildNodeConfig preserves node overrides and image canvas count", () => {
    const config = buildNodeConfig({ ...defaults, imageModel: "global-image", canvasImageCount: "3", background: "transparent" }, defaults, node({ model: "node-model", quality: "hd", count: 2, background: "" }), "image");
    assert.equal(config.model, "node-model");
    assert.equal(config.quality, "hd");
    assert.equal(config.count, "2");
    assert.equal(config.background, "");
});

test("buildNodeConfig maps media metadata to effective config", () => {
    const config = buildNodeConfig(defaults, defaults, node({ seconds: "12", generateAudio: "false", watermark: "true", negativePrompt: "低质量，模糊", audioVoice: "nova", audioFormat: "wav", audioSpeed: "1.25", audioInstructions: "calm" }), "video");
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
    const config = buildNodeConfig(defaults, defaults, node(), "video");
    assert.equal(config.videoGenerateAudio, "false");
});

test("buildNodeConfig replaces smart duration with the canvas default", () => {
    const config = buildNodeConfig({ ...defaults, videoSeconds: "-1" }, defaults, node({ seconds: "-1" }), "video");
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
