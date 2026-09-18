import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultConfig } from "../../stores/use-config-store.ts";
import { requestImageQuestion, requestToolResponse } from "./image.ts";

const messages = [{ role: "user", content: "继续" }];
const tools = [
    {
        type: "function",
        function: {
            name: "save_note",
            description: "保存笔记",
            parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
        },
    },
];

function modelConfig(apiFormat, channelMode = "local") {
    const channelId = `${apiFormat}-${channelMode}-compat-test`;
    const model = apiFormat === "gemini" ? "gemini-compat-test" : "gpt-compat-test";
    return {
        ...defaultConfig,
        channelMode,
        model: `${channelId}::${model}`,
        textModel: `${channelId}::${model}`,
        channels: [{ id: channelId, name: "Compat Test", baseUrl: "https://provider.test/v1", apiKey: "test-key", apiFormat, models: [model] }],
    };
}

function sseResponse(payloads) {
    const body = payloads.map((payload) => `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
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

test("OpenAI tool call metadata split across SSE events is accumulated for argument deltas and the final call", async () => {
    const events = [];
    const result = await withFetch(
        async () =>
            sseResponse([
                { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-split", type: "function" }] }, finish_reason: null }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "save_note" } }] }, finish_reason: null }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"note":"' } }] }, finish_reason: null }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '完成"}' } }] }, finish_reason: "tool_calls" }] },
                "[DONE]",
            ]),
        () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }),
    );

    assert.deepEqual(result.toolCalls, [{ id: "call-split", type: "function", function: { name: "save_note", arguments: '{"note":"完成"}' } }]);
    assert.deepEqual(
        events.filter((event) => event.type === "tool_call_delta"),
        [
            { type: "tool_call_delta", index: 0, id: "call-split", argumentsDelta: "", arguments: "" },
            { type: "tool_call_delta", index: 0, id: "call-split", name: "save_note", argumentsDelta: "", arguments: "" },
            { type: "tool_call_delta", index: 0, id: "call-split", name: "save_note", argumentsDelta: '{"note":"', arguments: '{"note":"' },
            { type: "tool_call_delta", index: 0, id: "call-split", name: "save_note", argumentsDelta: '完成"}', arguments: '{"note":"完成"}' },
        ],
    );
});

test("interleaved OpenAI tool call indexes keep independent metadata and arguments", async () => {
    const events = [];
    const result = await withFetch(
        async () =>
            sseResponse([
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    { index: 0, id: "call-a", type: "function", function: { name: "save_note", arguments: '{"note":"A' } },
                                    { index: 1, id: "call-b", type: "function", function: { name: "save_note", arguments: '{"note":"B' } },
                                ],
                            },
                            finish_reason: null,
                        },
                    ],
                },
                { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '2"}' } }] }, finish_reason: null }] },
                { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1"}' } }] }, finish_reason: "tool_calls" }] },
                "[DONE]",
            ]),
        () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }),
    );

    assert.deepEqual(result.toolCalls, [
        { id: "call-a", type: "function", function: { name: "save_note", arguments: '{"note":"A1"}' } },
        { id: "call-b", type: "function", function: { name: "save_note", arguments: '{"note":"B2"}' } },
    ]);
    assert.deepEqual(
        events.filter((event) => event.type === "tool_call_delta").map(({ index, id, name, arguments: args }) => ({ index, id, name, arguments: args })),
        [
            { index: 0, id: "call-a", name: "save_note", arguments: '{"note":"A' },
            { index: 1, id: "call-b", name: "save_note", arguments: '{"note":"B' },
            { index: 1, id: "call-b", name: "save_note", arguments: '{"note":"B2"}' },
            { index: 0, id: "call-a", name: "save_note", arguments: '{"note":"A1"}' },
        ],
    );
});

test("OpenAI compatibility streams without usage or finish reason still expose legacy content and toolCalls", async () => {
    const events = [];
    const legacyDeltas = [];
    const result = await withFetch(
        async () => sseResponse([{ choices: [{ delta: { content: "兼容回复" } }] }, "[DONE]"]),
        () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", (content) => legacyDeltas.push(content), { onEvent: (event) => events.push(event) }),
    );

    assert.equal(result.content, "兼容回复");
    assert.deepEqual(result.toolCalls, []);
    assert.equal(result.usage, undefined);
    assert.equal(result.finishReason, undefined);
    assert.deepEqual(legacyDeltas, ["兼容回复"]);
    assert.equal(
        events.some((event) => event.type === "usage"),
        false,
    );
    assert.equal(events.at(-1)?.type, "done");
    assert.deepEqual(events.at(-1)?.result, result);
});

test("remote Gemini forwards the original AbortSignal on a successful non-stream request", async () => {
    const controller = new AbortController();
    const result = await withFetch(
        async (input, init) => {
            assert.equal(input, "/api/v1/chat/completions");
            assert.strictEqual(init.signal, controller.signal);
            assert.equal(init.headers.Accept, "text/event-stream");
            const body = JSON.parse(init.body);
            assert.equal(body.model, "gemini-compat-test");
            assert.equal(body.stream, true);
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "远程成功" }] } }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        },
        () => requestToolResponse(modelConfig("gemini", "remote"), messages, tools, "auto", undefined, { signal: controller.signal }),
    );

    assert.equal(result.content, "远程成功");
    assert.deepEqual(result.toolCalls, []);
});

test("observing an error event never converts a rejected model request into success", async () => {
    const events = [];
    await withFetch(
        async () => {
            throw new Error("socket closed");
        },
        () =>
            assert.rejects(
                () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }),
                (error) => {
                    assert.equal(error instanceof Error ? error.message : String(error), "socket closed");
                    return true;
                },
            ),
    );

    assert.equal(events.at(-1)?.type, "error");
    assert.equal(events.at(-1)?.error?.message, "socket closed");
    assert.equal(
        events.some((event) => event.type === "done"),
        false,
    );
});

test("OpenAI JSON fallback with a readable body uses the non-stream result contract", async () => {
    const events = [];
    const result = await withFetch(
        async () =>
            new Response(
                JSON.stringify({
                    choices: [{ message: { role: "assistant", content: "JSON 回复", tool_calls: [] }, finish_reason: "stop" }],
                    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }),
    );

    assert.equal(result.content, "JSON 回复");
    assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 });
    assert.equal(result.finishReason, "stop");
    assert.equal(events.at(-1)?.type, "done");
});

test("OpenAI DONE terminates parsing and usage opt-in is explicit", async () => {
    let requestBody;
    const events = [];
    const result = await withFetch(
        async (_input, init) => {
            requestBody = JSON.parse(init.body);
            return sseResponse([{ choices: [{ delta: { content: "保留" } }] }, "[DONE]", { choices: [{ delta: { content: "忽略" } }] }]);
        },
        () => requestToolResponse(modelConfig("openai"), messages, tools, "auto", undefined, { includeUsage: true, onEvent: (event) => events.push(event) }),
    );

    assert.deepEqual(requestBody.stream_options, { include_usage: true });
    assert.equal(result.content, "保留");
    assert.deepEqual(
        events.filter((event) => event.type === "text_delta").map((event) => event.delta),
        ["保留"],
    );
    assert.equal(events.filter((event) => event.type === "done").length, 1);
});

test("Canvas reverse prompts send the reference image through the metered platform chat route", async () => {
    let request;
    const result = await withFetch(
        async (input, init) => {
            request = { input, init, body: JSON.parse(init.body) };
            return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "电影感夜景" }, finish_reason: "stop" }] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        },
        () =>
            requestImageQuestion(
                { ...defaultConfig, channelMode: "remote", channels: [], model: "admin-text", textModel: "admin-text", apiFormat: "openai" },
                [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "反推提示词" },
                            { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
                        ],
                    },
                ],
                () => undefined,
                { source: "canvas", includeUsage: true },
            ),
    );

    assert.equal(result, "电影感夜景");
    assert.equal(request.input, "/api/v1/chat/completions");
    assert.equal(new Headers(request.init.headers).get("X-Source"), "canvas");
    assert.deepEqual(request.body.stream_options, { include_usage: true });
    assert.deepEqual(request.body.messages[0].content, [
        { type: "text", text: "反推提示词" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
    ]);
});

test("provider error finish reasons reject without done", async () => {
    for (const [apiFormat, payload] of [
        ["openai", { choices: [{ delta: {}, finish_reason: "error" }] }],
        ["gemini", { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] }],
    ]) {
        const events = [];
        await withFetch(
            async () => sseResponse([payload, "[DONE]"]),
            () => assert.rejects(() => requestToolResponse(modelConfig(apiFormat), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }), new RegExp(apiFormat === "openai" ? "error" : "MALFORMED_FUNCTION_CALL", "i")),
        );
        assert.equal(events.at(-1)?.type, "error");
        assert.equal(
            events.some((event) => event.type === "done"),
            false,
        );
    }
});

test("bodyless SSE rejects clearly instead of parsing an empty JSON fallback", async () => {
    const events = [];
    await withFetch(
        async () => new Response(null, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
        () => assert.rejects(() => requestToolResponse(modelConfig("openai"), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }), /流响应缺少响应体/),
    );
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(
        events.some((event) => event.type === "done"),
        false,
    );
});

test("remote Gemini proxy error envelopes reject without done", async () => {
    const events = [];
    await withFetch(
        async () => new Response(JSON.stringify({ code: 1, data: null, msg: "余额不足" }), { status: 200, headers: { "Content-Type": "application/json" } }),
        () => assert.rejects(() => requestToolResponse(modelConfig("gemini", "remote"), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }), /余额不足/),
    );
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(
        events.some((event) => event.type === "done"),
        false,
    );
});

test("OpenAI tool calls without provider ids receive a local final id", async () => {
    const result = await withFetch(
        async () => sseResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "save_note", arguments: '{"note":"完成"}' } }] }, finish_reason: "tool_calls" }] }, "[DONE]"]),
        () => requestToolResponse(modelConfig("openai"), messages, tools),
    );

    assert.equal(result.toolCalls.length, 1);
    assert.match(result.toolCalls[0].id, /.+/);
    assert.equal(result.toolCalls[0].function.arguments, '{"note":"完成"}');
});

test("DONE resolves even when the upstream keeps the connection open", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n'));
            },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );

    const result = await withFetch(
        async () => response,
        () => Promise.race([requestToolResponse(modelConfig("openai"), messages, tools), new Promise((_, reject) => setTimeout(() => reject(new Error("DONE 未结束请求")), 100))]),
    );
    assert.equal(result.content, "完成");
});

test("Gemini keeps tool_calls when STOP arrives in a later chunk", async () => {
    const result = await withFetch(
        async () => sseResponse([{ candidates: [{ content: { parts: [{ functionCall: { id: "gemini-split", name: "save_note", args: { note: "完成" } } }] } }] }, { candidates: [{ finishReason: "STOP" }] }]),
        () => requestToolResponse(modelConfig("gemini"), messages, tools),
    );

    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.finishReason, "tool_calls");
});

test("OpenAI JSON fallback adds an id when a compatible provider omits it", async () => {
    const result = await withFetch(
        async () =>
            new Response(
                JSON.stringify({
                    choices: [{ message: { role: "assistant", content: null, tool_calls: [{ type: "function", function: { name: "save_note", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        () => requestToolResponse(modelConfig("openai"), messages, tools),
    );

    assert.match(result.toolCalls[0].id, /.+/);
    assert.equal(result.toolCalls[0].function.name, "save_note");
});

test("non-standard JSON content types still use the JSON fallback", async () => {
    const result = await withFetch(
        async () =>
            new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "纯文本标头 JSON" }, finish_reason: "stop" }] }), {
                status: 200,
                headers: { "Content-Type": "text/plain" },
            }),
        () => requestToolResponse(modelConfig("openai"), messages, tools),
    );

    assert.equal(result.content, "纯文本标头 JSON");
    assert.equal(result.finishReason, "stop");
});

test("remote Gemini SSE uses the unified text, tool, usage, and done contract", async () => {
    const events = [];
    const result = await withFetch(
        async (input, init) => {
            assert.equal(input, "/api/v1/chat/completions");
            const body = JSON.parse(init.body);
            assert.equal(body.model, "gemini-compat-test");
            assert.equal(body.stream, true);
            return sseResponse([
                { candidates: [{ content: { parts: [{ text: "远程" }] } }] },
                {
                    candidates: [{ content: { parts: [{ functionCall: { id: "remote-call", name: "save_note", args: { note: "完成" } } }] }, finishReason: "STOP" }],
                    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
                },
                "[DONE]",
            ]);
        },
        () => requestToolResponse(modelConfig("gemini", "remote"), messages, tools, "auto", undefined, { onEvent: (event) => events.push(event) }),
    );

    assert.equal(result.content, "远程");
    assert.equal(result.finishReason, "tool_calls");
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    assert.equal(result.toolCalls[0].id, "remote-call");
    assert.equal(
        events.some((event) => event.type === "text_delta"),
        true,
    );
    assert.equal(
        events.some((event) => event.type === "tool_call_delta"),
        true,
    );
    assert.equal(
        events.some((event) => event.type === "usage"),
        true,
    );
    assert.equal(events.at(-1)?.type, "done");
});
