import assert from "node:assert/strict";
import { test } from "node:test";

const { mock } = await import("bun:test");

let creditRefreshes = 0;
mock.module("@/services/credit-balance-sync", () => ({
    queueCreditBalanceRefresh: () => {
        creditRefreshes += 1;
    },
}));

const { defaultConfig } = await import("../../stores/use-config-store.ts");
const { useUserStore } = await import("../../stores/use-user-store.ts");
const { requestToolResponse } = await import("../../services/api/image.ts");
const { runBrainstormTurn } = await import("./brainstorm-agent-runner.ts");

const diagnostics = {
    limitTokens: 1000,
    reservedOutputTokens: 200,
    usedTokens: 100,
    toolSchemaTokens: 10,
    estimated: true,
    summary: "missing",
    items: [],
};

const context = {
    messages: [
        { type: "message", role: "system", content: "你是分镜头脑风暴助手。" },
        { type: "message", role: "user", content: "给我一个开场。" },
    ],
    tools: [],
    diagnostics,
};

const unexpectedTool = async () => {
    throw new Error("unexpected tool execution");
};

function providerConfig(channelMode, { channelId, model, baseUrl, apiKey }) {
    const selectedModel = `${channelId}::${model}`;
    return {
        ...defaultConfig,
        channelMode,
        model: selectedModel,
        textModel: selectedModel,
        channels: [{ id: channelId, name: `${channelMode} test`, baseUrl, apiKey, apiFormat: "openai", models: [model] }],
    };
}

function sseResponse(payloads) {
    const body = payloads.map((payload) => `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function completion(config, source) {
    return async (request, options) => {
        const result = await requestToolResponse(
            { ...config, model: config.textModel || config.model, systemPrompt: "" },
            request.messages.map((message) => ({ role: message.role, content: message.content })),
            [],
            "auto",
            undefined,
            {
                signal: options.signal,
                includeUsage: true,
                ...(source ? { source } : {}),
                onEvent: (event) => {
                    if (event.type === "text_delta") options.onEvent({ type: "text_delta", delta: event.delta });
                    else if (event.type === "usage") options.onEvent({ type: "usage", usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens } });
                },
            },
        );
        return { content: result.content, toolCalls: [], ...(result.usage ? { usage: result.usage } : {}), ...(result.finishReason ? { finishReason: result.finishReason } : {}) };
    };
}

async function withStubbedFetch(token, fetchImpl, run) {
    const previousFetch = globalThis.fetch;
    const previousToken = useUserStore.getState().token;
    let fetchCalls = 0;
    useUserStore.setState({ token });
    globalThis.fetch = async (...args) => {
        fetchCalls += 1;
        return fetchImpl(...args);
    };
    try {
        return { value: await run(), fetchCalls };
    } finally {
        globalThis.fetch = previousFetch;
        useUserStore.setState({ token: previousToken });
    }
}

test("Local Provider completes one streamed Brainstorm Turn with only the provider URL and key", async () => {
    const platformToken = "platform-session-token";
    const localProviderKey = "local-provider-key";
    const config = providerConfig("local", {
        channelId: "local-provider",
        model: "local-brainstorm-model",
        baseUrl: "https://local-provider.test/v1",
        apiKey: localProviderKey,
    });
    const events = [];
    creditRefreshes = 0;

    const { value: result, fetchCalls } = await withStubbedFetch(
        platformToken,
        async (input, init) => {
            assert.equal(input, "https://local-provider.test/v1/chat/completions");
            assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${localProviderKey}`);
            assert.equal(new Headers(init.headers).get("X-Source"), null);
            assert.equal(`${input}\n${JSON.stringify(init)}`.includes(platformToken), false);
            assert.deepEqual(JSON.parse(init.body), {
                model: "local-brainstorm-model",
                messages: [
                    { role: "system", content: "你是分镜头脑风暴助手。" },
                    { role: "user", content: "给我一个开场。" },
                ],
                stream: true,
                stream_options: { include_usage: true },
            });
            return sseResponse([
                { choices: [{ delta: { content: "本地" }, finish_reason: null }] },
                {
                    choices: [{ delta: { content: "灵感" }, finish_reason: "stop" }],
                    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
                },
                "[DONE]",
            ]);
        },
        () => runBrainstormTurn(context, { complete: completion(config), executeTool: unexpectedTool }, { onEvent: (event) => events.push(event) }),
    );

    assert.equal(fetchCalls, 1);
    assert.deepEqual(
        events.filter((event) => event.type === "text_delta"),
        [
            { type: "text_delta", delta: "本地" },
            { type: "text_delta", delta: "灵感" },
        ],
    );
    assert.deepEqual(result, {
        status: "completed",
        content: "本地灵感",
        output: [{ type: "text", text: "本地灵感" }],
        diagnostics,
        toolRounds: 0,
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
    assert.equal(creditRefreshes, 0);
});

test("Remote Provider completes one streamed Brainstorm Turn with the platform session token and queues a credit refresh", async () => {
    const platformToken = "platform-session-token";
    const localProviderKey = "must-not-send-local-provider-key";
    const config = providerConfig("remote", {
        channelId: "remote-provider",
        model: "remote-brainstorm-model",
        baseUrl: "https://local-provider-must-not-be-called.test/v1",
        apiKey: localProviderKey,
    });
    const events = [];
    creditRefreshes = 0;

    const { value: result, fetchCalls } = await withStubbedFetch(
        platformToken,
        async (input, init) => {
            assert.equal(input, "/api/v1/chat/completions");
            assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${platformToken}`);
            assert.equal(new Headers(init.headers).get("X-Source"), "brainstorm_agent");
            assert.equal(`${input}\n${JSON.stringify(init)}`.includes(localProviderKey), false);
            assert.deepEqual(JSON.parse(init.body), {
                model: "remote-brainstorm-model",
                messages: [
                    { role: "system", content: "你是分镜头脑风暴助手。" },
                    { role: "user", content: "给我一个开场。" },
                ],
                stream: true,
                stream_options: { include_usage: true },
            });
            return sseResponse([
                { choices: [{ delta: { content: "远程" }, finish_reason: null }] },
                {
                    choices: [{ delta: { content: "灵感" }, finish_reason: "stop" }],
                    usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
                },
                "[DONE]",
            ]);
        },
        () => runBrainstormTurn(context, { complete: completion(config, "brainstorm_agent"), executeTool: unexpectedTool }, { onEvent: (event) => events.push(event) }),
    );

    assert.equal(fetchCalls, 1);
    assert.deepEqual(
        events.filter((event) => event.type === "text_delta"),
        [
            { type: "text_delta", delta: "远程" },
            { type: "text_delta", delta: "灵感" },
        ],
    );
    assert.deepEqual(result, {
        status: "completed",
        content: "远程灵感",
        output: [{ type: "text", text: "远程灵感" }],
        diagnostics,
        toolRounds: 0,
        usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
    });
    assert.equal(creditRefreshes, 1);
});
