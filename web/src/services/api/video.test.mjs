import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { defaultConfig } from "../../stores/use-config-store.ts";
import i18n from "../../i18n/index.ts";
import { buildVideoGenerationPayload, pollVideoGenerationTask } from "./video.ts";

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
