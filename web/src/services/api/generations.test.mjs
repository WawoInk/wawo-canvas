import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGenerationCommand, buildVideoGenerationSettings, buildShortDramaGenerationSettings, generationStatusLabel, generationTaskId, pollGenerationTask, readGeneratedVideoFile, resolveCanvasVideoSubmission } from "./generation-contract.ts";

test("builds the first-party prompt-only video command", () => {
    assert.deepEqual(
        buildGenerationCommand({
            clientRequestId: "request-1",
            modelProfileId: "seedance-1-5-pro",
            source: "canvas",
            prompt: "人物走进雨夜街道",
        }),
        {
            commandVersion: 1,
            clientRequestId: "request-1",
            modelProfileId: "seedance-1-5-pro",
            source: "canvas",
            intent: { kind: "video.generate", prompt: "人物走进雨夜街道", references: { images: [], videos: [], audios: [] } },
        },
    );
});

test("builds Canvas settings from the public profile projection", () => {
    const profile = {
        id: "seedance-1-5-pro",
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["16:9", "9:16"], default: "16:9" },
                resolution: { type: "enum", values: ["720p"], default: "720p" },
                durationSeconds: { type: "duration", min: 4, max: 8, allowAuto: true, default: -1 },
                generateAudio: { type: "boolean", default: true },
                watermark: { type: "boolean", default: false },
            },
        },
    };

    assert.deepEqual(buildVideoGenerationSettings(profile, { aspectRatio: "21:9", resolution: "1080p", durationSeconds: 12, generateAudio: false, watermark: true }), {
        aspectRatio: "16:9",
        resolution: "720p",
        durationSeconds: 8,
        generateAudio: false,
        watermark: true,
    });
});

test("uses public Profile defaults for legacy Canvas nodes without video metadata", () => {
    const profile = {
        id: "seedance-1-5-pro",
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["adaptive", "16:9"], default: "adaptive" },
                resolution: { type: "enum", values: ["720p"], default: "720p" },
                durationSeconds: { type: "duration", min: 4, max: 12, allowAuto: true, default: -1 },
                generateAudio: { type: "boolean", default: true },
                watermark: { type: "boolean", default: false },
            },
        },
    };

    assert.deepEqual(buildVideoGenerationSettings(profile, {}), {
        aspectRatio: "adaptive",
        resolution: "720p",
        durationSeconds: -1,
        generateAudio: true,
        watermark: false,
    });
});

test("builds a first-party video command with typed platform settings", () => {
    const settings = { aspectRatio: "9:16", resolution: "1080p", durationSeconds: 10, generateAudio: false, watermark: true };
    const command = buildGenerationCommand({
        clientRequestId: "request-settings",
        modelProfileId: "seedance-1-5-pro",
        source: "canvas",
        prompt: "竖屏视频",
        settings,
    });

    assert.deepEqual(command.intent.settings, settings);
    const serialized = JSON.stringify(command);
    for (const providerField of ["ratio", "duration", "generate_audio"]) assert.equal(serialized.includes(`\"${providerField}\"`), false);
});

test("builds Drama settings with platform auto semantics", () => {
    const profile = {
        id: "vidu-q3-drama",
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["16:9", "9:16"], default: "9:16" },
                resolution: { type: "enum", values: ["1080p"], default: "1080p" },
                durationSeconds: { type: "duration", min: 8, max: 12, allowAuto: true, default: "auto" },
                quality: { type: "enum", values: ["standard", "high"], default: "high" },
            },
        },
    };

    assert.deepEqual(buildShortDramaGenerationSettings(profile, { aspectRatio: "16:9", resolution: "720p", durationSeconds: "auto", quality: "standard" }), {
        aspectRatio: "16:9",
        resolution: "1080p",
        durationSeconds: "auto",
        quality: "standard",
    });
    assert.deepEqual(buildShortDramaGenerationSettings(profile, { durationSeconds: 20 }), {
        aspectRatio: "9:16",
        resolution: "1080p",
        durationSeconds: 12,
        quality: "high",
    });
});

test("keeps first-party task identity compatible with old Canvas nodes", () => {
    assert.equal(generationTaskId({ generationTaskId: "platform-new", upstreamTaskId: "legacy-old" }), "platform-new");
    assert.equal(generationTaskId({ upstreamTaskId: "legacy-old" }), "legacy-old");
    assert.equal(generationTaskId({}), "");
    assert.equal(generationStatusLabel("queued"), "排队中");
    assert.equal(generationStatusLabel("running"), "生成中");
});

test("reports queued and running before returning a structured terminal task", async () => {
    const tasks = [{ status: "queued" }, { status: "running" }, { status: "failed", error: { code: "INVALID_SETTING", message: "设置无效", retryable: false, fieldPath: "intent.settings.durationSeconds", resourceId: "node-1" } }];
    const statuses = [];
    const terminal = await pollGenerationTask(
        async () => tasks.shift(),
        async () => {},
        (task) => statuses.push(task.status),
        3,
    );
    assert.deepEqual(statuses, ["queued", "running", "failed"]);
    assert.deepEqual(terminal.error, { code: "INVALID_SETTING", message: "设置无效", retryable: false, fieldPath: "intent.settings.durationSeconds", resourceId: "node-1" });
});

test("keeps polling through the 30-minute default window", async () => {
    let polls = 0;
    const terminal = await pollGenerationTask(
        async () => {
            polls += 1;
            return polls === 360 ? { status: "succeeded" } : { status: "running" };
        },
        async () => {},
    );

    assert.equal(polls, 360);
    assert.equal(terminal.status, "succeeded");
});

test("selects the Canvas video submission boundary without remote fallback", () => {
    assert.equal(resolveCanvasVideoSubmission("remote", { id: "seedance-1-5-pro" }), "first-party");
    assert.throws(() => resolveCanvasVideoSubmission("remote", undefined), /不支持第一方 Canvas 视频生成/);
    assert.equal(resolveCanvasVideoSubmission("local", undefined), "local-compatibility");
});

test("reads only normalized platform video results", () => {
    assert.deepEqual(readGeneratedVideoFile({ kind: "video", file: { fileId: "file-1", mimeType: "video/mp4", bytes: 42 } }), {
        fileId: "file-1",
        mimeType: "video/mp4",
        bytes: 42,
    });
    assert.deepEqual(readGeneratedVideoFile({ kind: "short-drama", file: { fileId: "file-2", mimeType: "video/mp4" }, shots: [{ index: 1, status: "success" }] }), {
        fileId: "file-2",
        mimeType: "video/mp4",
    });
    assert.equal(readGeneratedVideoFile({ kind: "video", file: { fileId: "", mimeType: "video/mp4" } }), null);
    assert.equal(readGeneratedVideoFile({ kind: "video", file: { fileId: "   ", mimeType: "video/mp4" } }), null);
    assert.equal(readGeneratedVideoFile({ videoUrl: "https://provider.example/signed.mp4" }), null);
    assert.equal(readGeneratedVideoFile({ content: { video_url: "https://provider.example/raw.mp4" } }), null);
});

test("builds a first-party video command with platform media references", () => {
    const references = {
        images: [{ fileId: "image-1", sourceNodeId: "node-image", name: "参考图" }],
        videos: [{ fileId: "video-1", sourceNodeId: "node-video", name: "参考视频" }],
        audios: [{ fileId: "audio-1", sourceNodeId: "node-audio", name: "参考音频" }],
    };

    const command = buildGenerationCommand({
        clientRequestId: "request-media",
        modelProfileId: "seedance-1-5-pro",
        source: "canvas",
        prompt: "组合这些素材",
        references,
    });

    assert.deepEqual(command.intent.references, references);
    assert.equal(JSON.stringify(command).includes("storageKey"), false);
    assert.equal(JSON.stringify(command).includes("dataUrl"), false);
    assert.equal(JSON.stringify(command).includes("image_url"), false);
});
