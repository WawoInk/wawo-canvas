import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { requestToolResponse } from "./image.ts";

const messages = [{ role: "user", content: "继续" }];
const tools = [{ type: "function", function: { name: "save_note", description: "保存笔记", parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] } } }];

function modelConfig(apiFormat) {
    const channelId = `${apiFormat}-test`;
    const model = apiFormat === "gemini" ? "gemini-test" : "gpt-test";
    return {
        ...defaultConfig,
        channelMode: "local",
        model: `${channelId}::${model}`,
        textModel: `${channelId}::${model}`,
        channels: [{ id: channelId, name: "Test", baseUrl: "https://provider.test/v1", apiKey: "test-key", apiFormat, models: [model] }],
    };
}

function sseResponse(payloads, newline = "\r\n") {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(payloads.map((payload) => `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}${newline}${newline}`).join(""));
    return new Response(
        new ReadableStream({
            start(controller) {
                for (let index = 0; index < bytes.length; index += 1) controller.enqueue(bytes.slice(index, index + 1));
                controller.close();
            },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
}

async function withFetch(fetchImpl, run) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
        return await run();
    } finally {
        globalThis.fetch = previousFetch;
    }
}

test("OpenAI SSE emits unified text, tool argument, usage, and done events across arbitrary byte boundaries", async () => {
    const events = [];
    const legacyDeltas = [];
    const result = await withFetch(
        async () =>
            sseResponse([
                { choices: [{ delta: { content: "你" }, finish_reason: null }] },
                { choices: [{ delta: { content: "好" }, finish_reason: null }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "save_note", arguments: '{"note":"' } }] }, finish_reason: null }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '完成"}' } }] }, finish_reason: "tool_calls" }] },
                { choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } },
                "[DONE]",
            ]),
        () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", (content) => legacyDeltas.push(content), { onEvent: (event) => events.push(event) }),
    );

    assert.deepEqual(legacyDeltas, ["你", "你好"]);
    assert.deepEqual(result, {
        content: "你好",
        toolCalls: [{ id: "call-1", type: "function", function: { name: "save_note", arguments: '{"note":"完成"}' } }],
        usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
        finishReason: "tool_calls",
    });
    assert.deepEqual(events.slice(0, -1), [
        { type: "phase", phase: "requesting" },
        { type: "phase", phase: "streaming" },
        { type: "text_delta", delta: "你", content: "你" },
        { type: "text_delta", delta: "好", content: "你好" },
        { type: "tool_call_delta", index: 0, id: "call-1", name: "save_note", argumentsDelta: '{"note":"', arguments: '{"note":"' },
        { type: "tool_call_delta", index: 0, id: "call-1", name: "save_note", argumentsDelta: '完成"}', arguments: '{"note":"完成"}' },
        { type: "usage", inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    ]);
    assert.equal(events.at(-1)?.type, "done");
    assert.deepEqual(events.at(-1)?.result, result);
});

test("Gemini functionCall and usage map to the same unified event semantics", async () => {
    const events = [];
    const result = await withFetch(
        async () =>
            sseResponse([
                { candidates: [{ content: { parts: [{ text: "收到" }] } }] },
                {
                    candidates: [{ content: { parts: [{ functionCall: { id: "gemini-call-1", name: "save_note", args: { note: "完成" } } }] }, finishReason: "STOP" }],
                    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
                },
            ]),
        () => requestToolResponse(modelConfig("gemini"), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }),
    );

    assert.deepEqual(result, {
        content: "收到",
        toolCalls: [{ id: "gemini-call-1", type: "function", function: { name: "save_note", arguments: '{"note":"完成"}' } }],
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        finishReason: "tool_calls",
    });
    assert.deepEqual(events.slice(0, -1), [
        { type: "phase", phase: "requesting" },
        { type: "phase", phase: "streaming" },
        { type: "text_delta", delta: "收到", content: "收到" },
        { type: "tool_call_delta", index: 0, id: "gemini-call-1", name: "save_note", argumentsDelta: '{"note":"完成"}', arguments: '{"note":"完成"}' },
        { type: "usage", inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    ]);
    assert.equal(events.at(-1)?.type, "done");
    assert.deepEqual(events.at(-1)?.result, result);
});

test("stream business errors emit error without done and reject with the upstream message", async () => {
    const events = [];
    await withFetch(
        async () => sseResponse([{ error: { message: "quota exceeded" } }]),
        () =>
            assert.rejects(
                () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }),
                (error) => {
                    assert.equal(error instanceof Error ? error.message : String(error), "quota exceeded");
                    return true;
                },
            ),
    );

    assert.deepEqual(
        events.slice(0, 2),
        [
            { type: "phase", phase: "requesting" },
            { type: "phase", phase: "streaming" },
        ],
    );
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.at(-1)?.error?.message, "quota exceeded");
    assert.equal(events.some((event) => event.type === "done"), false);
});

test("AbortError emits abort and remains distinguishable from ordinary failures", async () => {
    const events = [];
    const controller = new AbortController();
    controller.abort();

    await withFetch(
        async (_input, init) => {
            assert.strictEqual(init.signal, controller.signal);
            throw controller.signal.reason;
        },
        () =>
            assert.rejects(
                () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", undefined, { signal: controller.signal, onEvent: (event) => events.push(event) }),
                (error) => {
                    assert.equal(error?.name, "AbortError");
                    return true;
                },
            ),
    );

    assert.deepEqual(events.slice(0, 1), [{ type: "phase", phase: "requesting" }]);
    assert.equal(events.at(-1)?.type, "abort");
    assert.equal(events.at(-1)?.error?.name, "AbortError");
    assert.equal(events.some((event) => event.type === "error" || event.type === "done"), false);
});

test("bodyless OpenAI responses still emit normalized deltas, usage, and done", async () => {
    const events = [];
    const legacyDeltas = [];
    const payload = {
        choices: [{ message: { role: "assistant", content: "完整回复", tool_calls: [] }, finish_reason: "length" }],
        usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
    };
    const result = await withFetch(
        async () => ({ ok: true, body: null, json: async () => payload }),
        () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", (content) => legacyDeltas.push(content), { onEvent: (event) => events.push(event) }),
    );

    assert.deepEqual(legacyDeltas, ["完整回复"]);
    assert.deepEqual(result, {
        content: "完整回复",
        toolCalls: [],
        usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
        finishReason: "length",
    });
    assert.deepEqual(events.slice(0, -1), [
        { type: "phase", phase: "requesting" },
        { type: "phase", phase: "streaming" },
        { type: "text_delta", delta: "完整回复", content: "完整回复" },
        { type: "usage", inputTokens: 4, outputTokens: 6, totalTokens: 10 },
    ]);
    assert.equal(events.at(-1)?.type, "done");
    assert.deepEqual(events.at(-1)?.result, result);
});
