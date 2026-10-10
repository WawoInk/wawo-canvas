import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { createAsyncImageEditTask, createAsyncImageTask, requestEdit, requestGeneration } from "./image.ts";

test("image quality is sent independently of the selected ratio size", async () => {
    const previousPost = axios.post;
    let body;
    axios.post = async (_url, value) => {
        body = value;
        return { data: { data: [{ b64_json: "aW1hZ2U=" }] } };
    };
    try {
        for (const quality of ["high", "xhigh", "max"]) {
            await requestGeneration({ ...defaultConfig, channelMode: "remote", model: "image", size: "1:1", quality }, "draw");
            assert.deepEqual({ quality: body.quality, size: body.size }, { quality, size: "1024x1024" });
        }
    } finally {
        axios.post = previousPost;
    }
});

test("unavailable local model selections are rejected before sending an image request", async () => {
    const previousPost = axios.post;
    let sent = false;
    axios.post = async () => {
        sent = true;
        return { data: { data: [{ b64_json: "aW1hZ2U=" }] } };
    };
    try {
        for (const model of ["missing::gpt-image-2", "default::removed-image", "removed-image"]) {
            await assert.rejects(() => requestGeneration({ ...defaultConfig, model }, "draw"), /selected model is unavailable|所选模型不可用/);
        }
        assert.equal(sent, false);
    } finally {
        axios.post = previousPost;
    }
});

test("image edits and async requests preserve maximum quality without changing resolution", async () => {
    const previousPost = axios.post;
    let body;
    axios.post = async (_url, value) => {
        body = value;
        return { data: { id: "image-task", data: [{ b64_json: "aW1hZ2U=" }] }, headers: {} };
    };
    const config = { ...defaultConfig, channelMode: "remote", model: "image", size: "2048x1152", quality: "max" };
    const reference = { id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" };
    try {
        for (const send of [() => requestEdit(config, "edit", [reference]), () => createAsyncImageTask(config, "draw"), () => createAsyncImageEditTask(config, "edit", [reference])]) {
            await send();
            const fields = body instanceof FormData ? Object.fromEntries(body) : body;
            assert.deepEqual({ quality: fields.quality, size: fields.size }, { quality: "max", size: "2048x1152" });
        }
    } finally {
        axios.post = previousPost;
    }
});

test("Gemini sends the selected resolution even when its model name lacks a version", async () => {
    const previousPost = axios.post;
    let body;
    axios.post = async (_url, value) => {
        body = value;
        return { data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }] } };
    };
    try {
        await requestGeneration(
            { ...defaultConfig, model: "gemini::banana-image", channels: [{ id: "gemini", name: "Gemini", baseUrl: "https://gemini.example", apiKey: "test-key", apiFormat: "gemini", models: ["banana-image"] }], size: "2048x1152", quality: "max" },
            "draw",
        );
        assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: "16:9", imageSize: "2K" });
    } finally {
        axios.post = previousPost;
    }
});

test("image requests have a ten-minute timeout and preserve caller cancellation", async () => {
    const previousPost = axios.post;
    let options;
    axios.post = async (_url, _body, value) => {
        options = value;
        return { data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }], data: [{ b64_json: "aW1hZ2U=" }] } };
    };
    const signal = new AbortController().signal;
    const reference = { id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" };
    try {
        for (const apiFormat of ["openai", "gemini"]) {
            const config = { ...defaultConfig, channels: [{ ...defaultConfig.channels[0], apiFormat }] };
            for (const send of [() => requestGeneration(config, "draw", { signal }), () => requestEdit(config, "edit", [reference], undefined, { signal })]) {
                await send();
                assert.equal(options.timeout, 600_000);
                assert.equal(options.signal, signal);
            }
        }
    } finally {
        axios.post = previousPost;
    }
});

test("image timeouts remain a concrete failure instead of a generic request error", async () => {
    const previousPost = axios.post;
    try {
        for (const code of ["ECONNABORTED", "ETIMEDOUT"]) {
            axios.post = async () => {
                throw new axios.AxiosError("provider timeout", code);
            };
            await assert.rejects(() => requestGeneration(defaultConfig, "draw"), /Image generation timed out|图片生成超时/);
        }
    } finally {
        axios.post = previousPost;
    }
});

test("remote Gemini image requests time out while retaining caller cancellation", async () => {
    const previousFetch = globalThis.fetch;
    const previousTimeout = AbortSignal.timeout;
    let timeoutController = new AbortController();
    AbortSignal.timeout = (milliseconds) => {
        assert.equal(milliseconds, 600_000);
        return timeoutController.signal;
    };
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    try {
        for (const reason of ["timeout", "cancel"]) {
            const controller = new AbortController();
            timeoutController = new AbortController();
            const request = requestGeneration({ ...defaultConfig, channelMode: "remote", channels: [{ ...defaultConfig.channels[0], apiFormat: "gemini" }] }, "draw", { signal: controller.signal });
            if (reason === "timeout") timeoutController.abort(new DOMException("Request timed out", "TimeoutError"));
            else controller.abort();
            await assert.rejects(request, reason === "timeout" ? /Image generation timed out|图片生成超时/ : /Request cancelled|请求已取消/);
        }
    } finally {
        globalThis.fetch = previousFetch;
        AbortSignal.timeout = previousTimeout;
    }
});
