import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { defaultConfig } from "../../stores/use-config-store.ts";
import i18n from "../../i18n/index.ts";
import { buildVideoGenerationPayload, createVideoGenerationTask, pollVideoGenerationTask } from "./video.ts";

const config = (model, videoNegativePrompt = "") => ({
    ...defaultConfig,
    model,
    videoModel: model,
    size: "16:9",
    vquality: "720",
    videoSeconds: "6",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoNegativePrompt,
});

const expectedBasePayload = (model) => ({
    model,
    content: [{ type: "text", text: "人物走进雨夜街道" }],
    ratio: "16:9",
    resolution: "720p",
    duration: 6,
    generate_audio: true,
    watermark: false,
});

test("keeps the existing video payload unchanged without a negative prompt", async () => {
    assert.deepEqual(await buildVideoGenerationPayload(config("vidu_i2v_new_ns"), "vidu_i2v_new_ns", "人物走进雨夜街道"), expectedBasePayload("vidu_i2v_new_ns"));
    assert.deepEqual(await buildVideoGenerationPayload(config("vidu_i2v_new_ns", "   "), "vidu_i2v_new_ns", "人物走进雨夜街道"), expectedBasePayload("vidu_i2v_new_ns"));
});

test("adds the negative prompt metadata without model version branching", async () => {
    for (const model of ["vidu_hq_i2v-oversea", "vidu_i2v_new_ns-oversea", "seedance-1-5-pro"]) {
        assert.deepEqual(await buildVideoGenerationPayload(config(model, "  低质量，模糊  "), model, "人物走进雨夜街道"), {
            ...expectedBasePayload(model),
            metadata: { extra_params: { negative_prompt: "低质量，模糊" } },
        });
    }
});

test("accepts 500 negative-prompt characters and rejects more", async () => {
    await i18n.changeLanguage("en-US");
    const model = "vidu_r2v_new_ns-oversea";
    const accepted = "差".repeat(500);
    assert.deepEqual((await buildVideoGenerationPayload(config(model, accepted), model, "人物走进雨夜街道")).metadata, {
        extra_params: { negative_prompt: accepted },
    });
    await assert.rejects(() => buildVideoGenerationPayload(config(model, `${accepted}差`), model, "人物走进雨夜街道"), /negative prompt cannot exceed 500 characters/i);
});

test("keeps asset URLs intact across OpenAI, Sora, and Seedance compatibility payloads", async () => {
    const imageUrl = "asset://image-reference-001";
    const videoUrl = "asset://video-reference-001";
    const audioUrl = "asset://audio-reference-001";
    const references = [{ id: "image-reference", name: "image.png", type: "image/png", url: "https://preview.example/image.png", dataUrl: "data:image/png;base64,should-not-be-used", storageKey: "local-image-storage-key", assetId: "image-reference-001" }];
    const videoReferences = [{ id: "video-reference", name: "video.mp4", type: "video/mp4", url: "https://preview.example/video.mp4", storageKey: "local-video-storage-key", assetId: "video-reference-001" }];
    const audioReferences = [{ id: "audio-reference", name: "audio.mp3", type: "audio/mpeg", url: "https://preview.example/audio.mp3", storageKey: "local-audio-storage-key", assetId: "audio-reference-001" }];

    for (const model of ["grok-imagine-video", "sora-2", "doubao-seedance-2.0"]) {
        const payload = await buildVideoGenerationPayload(config(model), model, "让参考素材动起来", references, videoReferences, audioReferences);
        assert.deepEqual(payload.content.slice(-3), [
            { type: "image_url", image_url: { url: imageUrl }, role: "reference_image" },
            { type: "video_url", video_url: { url: videoUrl }, role: "reference_video" },
            { type: "audio_url", audio_url: { url: audioUrl }, role: "reference_audio" },
        ]);
        const serialized = JSON.stringify(payload);
        assert.equal(serialized.includes("should-not-be-used"), false);
        assert.equal(serialized.includes("local-image-storage-key"), false);
        assert.equal(serialized.includes("local-video-storage-key"), false);
        assert.equal(serialized.includes("local-audio-storage-key"), false);
    }
});

test("preserves an asset incompatibility detail from the compatibility video service", async (t) => {
    const downstreamMessage = "Volcengine asset is unsupported by this downstream";
    const server = createServer((_request, response) => {
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: { code: "ASSET_REFERENCE_UNSUPPORTED", message: downstreamMessage } }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const localConfig = {
        ...config("seedance-local"),
        channelMode: "local",
        baseUrl,
        apiKey: "test-key",
        channels: [{ id: "test-channel", name: "Test", baseUrl, apiKey: "test-key", apiFormat: "openai", models: ["seedance-local"] }],
    };

    await assert.rejects(
        () => createVideoGenerationTask(localConfig, "让参考图动起来", [{ id: "image-reference", name: "image.png", type: "image/png", url: "asset://image-reference-001", dataUrl: "data:image/png;base64,not-used" }]),
        (error) => {
            assert.equal(error instanceof Error ? error.message : String(error), downstreamMessage);
            return true;
        },
    );
});

test("reports the concrete compatibility task failure instead of the coarse provider message", async (t) => {
    const responses = [
        { id: "expired-task", status: "expired", error: { message: "上游拒绝生成" } },
        { id: "cancelled-task", status: "cancelled", error: { message: "上游拒绝生成" } },
        { id: "timeout-task", status: "failed", error: { code: "TASK_TIMEOUT", message: "上游拒绝生成" } },
    ];
    const server = createServer((_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(responses.shift()));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const localConfig = {
        ...config("seedance-local"),
        channelMode: "local",
        baseUrl,
        apiKey: "test-key",
        channels: [{ id: "test-channel", name: "Test", baseUrl, apiKey: "test-key", apiFormat: "openai", models: ["seedance-local"] }],
    };
    const language = i18n.language;
    try {
        await i18n.changeLanguage("zh-CN");
        assert.deepEqual(await pollVideoGenerationTask(localConfig, { id: "expired-task", model: "seedance-local" }), { status: "failed", error: "视频任务已过期" });
        assert.deepEqual(await pollVideoGenerationTask(localConfig, { id: "cancelled-task", model: "seedance-local" }), { status: "failed", error: "视频生成已取消" });
        assert.deepEqual(await pollVideoGenerationTask(localConfig, { id: "timeout-task", model: "seedance-local" }), { status: "failed", error: "视频生成超时" });
    } finally {
        await i18n.changeLanguage(language);
    }
});

test("reports the HTTP failure reason instead of the coarse response message", async (t) => {
    const responses = [
        { status: 504, body: { msg: "后端服务失败" } },
        { status: 429, body: { msg: "操作失败" } },
        { status: 503, body: { msg: "后端服务未启用" } },
        { status: 500, body: { msg: "操作失败" } },
        { status: 401, body: { msg: "操作失败" } },
        { status: 403, body: { msg: "操作失败" } },
        { status: 404, body: { msg: "操作失败" } },
        { status: 400, body: { error: { code: "SENSITIVE_CONTENT", message: "content policy violation" } } },
        { status: 400, body: { error: { code: "INVALID_PARAMETER", message: "invalid duration" } } },
    ];
    const server = createServer((_request, response) => {
        const current = responses.shift();
        response.statusCode = current.status;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(current.body));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const localConfig = {
        ...config("seedance-local"),
        channelMode: "local",
        channels: [{ id: "test-channel", name: "Test", baseUrl, apiKey: "test-key", apiFormat: "openai", models: ["seedance-local"] }],
    };
    const language = i18n.language;
    try {
        await i18n.changeLanguage("zh-CN");
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "timeout-task", model: "seedance-local" }), /视频任务查询超时/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "rate-limit-task", model: "seedance-local" }), /上游服务限流/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "unavailable-task", model: "seedance-local" }), /上游服务暂时不可用/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "failed-task", model: "seedance-local" }), /视频生成服务异常/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "auth-task", model: "seedance-local" }), /上游服务认证失败/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "permission-task", model: "seedance-local" }), /上游服务无访问权限/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "missing-task", model: "seedance-local" }), /上游任务或生成接口不存在/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "content-task", model: "seedance-local" }), /生成内容未通过安全审核/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "invalid-task", model: "seedance-local" }), /生成参数或输入无效/);
    } finally {
        await i18n.changeLanguage(language);
    }
});

test("keeps polling when the upstream task status temporarily returns conflict", async (t) => {
    const responses = [
        { status: 409, body: { msg: "Conflict" } },
        { status: 200, body: { id: "recovered-task", status: "succeeded", content: { video_url: "https://example.com/recovered.mp4" } } },
    ];
    const server = createServer((_request, response) => {
        const current = responses.shift();
        response.statusCode = current.status;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(current.body));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const localConfig = {
        ...config("seedance-local"),
        channelMode: "local",
        baseUrl,
        apiKey: "test-key",
        channels: [{ id: "test-channel", name: "Test", baseUrl, apiKey: "test-key", apiFormat: "openai", models: ["seedance-local"] }],
    };

    assert.deepEqual(await pollVideoGenerationTask(localConfig, { id: "recovered-task", model: "seedance-local" }), { status: "pending" });
    assert.deepEqual(await pollVideoGenerationTask(localConfig, { id: "recovered-task", model: "seedance-local" }), {
        status: "completed",
        result: { url: "https://example.com/recovered.mp4", mimeType: "video/mp4" },
    });
});

test("reports an unavailable upstream when the local video service cannot be reached", async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await new Promise((resolve) => server.close(resolve));

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const localConfig = {
        ...config("seedance-local"),
        channelMode: "local",
        channels: [{ id: "test-channel", name: "Test", baseUrl, apiKey: "test-key", apiFormat: "openai", models: ["seedance-local"] }],
    };
    const language = i18n.language;
    try {
        await i18n.changeLanguage("zh-CN");
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "network-task", model: "seedance-local" }), /上游服务暂时不可用/);
    } finally {
        await i18n.changeLanguage(language);
    }
});

test("replaces coarse business failure messages with the concrete video service stage", async (t) => {
    const responses = [
        { code: 1, data: null, msg: "后端服务未启用" },
        { code: 1, data: null, msg: "后端服务失败" },
        { code: 1, data: null, msg: "操作失败" },
    ];
    const server = createServer((_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(responses.shift()));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const localConfig = {
        ...config("seedance-local"),
        channelMode: "local",
        channels: [{ id: "test-channel", name: "Test", baseUrl, apiKey: "test-key", apiFormat: "openai", models: ["seedance-local"] }],
    };
    const language = i18n.language;
    try {
        await i18n.changeLanguage("zh-CN");
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "disabled-task", model: "seedance-local" }), /视频生成服务未配置或未启用/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "failed-task", model: "seedance-local" }), /视频生成服务异常/);
        await assert.rejects(() => pollVideoGenerationTask(localConfig, { id: "operation-task", model: "seedance-local" }), /视频任务查询失败/);
    } finally {
        await i18n.changeLanguage(language);
    }
});
