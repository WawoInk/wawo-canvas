import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { buildVideoGenerationPayload } from "./video.ts";

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
    const model = "vidu_r2v_new_ns-oversea";
    const accepted = "差".repeat(500);
    assert.deepEqual((await buildVideoGenerationPayload(config(model, accepted), model, "人物走进雨夜街道")).metadata, {
        extra_params: { negative_prompt: accepted },
    });
    await assert.rejects(() => buildVideoGenerationPayload(config(model, `${accepted}差`), model, "人物走进雨夜街道"), /负向提示词不能超过 500 个字符/);
});
