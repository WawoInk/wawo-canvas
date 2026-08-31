import assert from "node:assert/strict";
import { test } from "node:test";

import { runBrainstormTurn } from "./brainstorm-agent-runner.ts";

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
        { type: "message", role: "system", content: "system" },
        { type: "message", role: "user", content: "brainstorm" },
    ],
    tools: [],
    diagnostics,
};

const noTool = async () => {
    throw new Error("unexpected tool execution");
};

function queueCompletion(...steps) {
    const requests = [];
    return {
        requests,
        complete: async (request, options) => {
            requests.push(structuredClone(request));
            const step = steps.shift();
            if (!step) throw new Error("completion queue exhausted");
            return typeof step === "function" ? step(options) : step;
        },
    };
}

test("streams and preserves a completed text response", async () => {
    const events = [];
    const result = await runBrainstormTurn(
        context,
        {
            complete: async (_request, options) => {
                options.onEvent({ type: "text_delta", delta: "你好" });
                options.onEvent({ type: "text_delta", delta: "，世界" });
                return { content: "你好，世界", toolCalls: [], usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 } };
            },
            executeTool: noTool,
        },
        { onEvent: (event) => events.push(event) },
    );

    assert.deepEqual(result, {
        status: "completed",
        content: "你好，世界",
        output: [{ type: "text", text: "你好，世界" }],
        diagnostics,
        toolRounds: 0,
        usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
    });
    assert.deepEqual(events, [
        { type: "status", status: "streaming" },
        { type: "text_delta", delta: "你好" },
        { type: "text_delta", delta: "，世界" },
        { type: "output_item", item: { type: "text", text: "你好，世界" } },
        { type: "status", status: "completed" },
    ]);
});

test("executes a read tool and replays the complete pair before continuing", async () => {
    const call = { type: "tool_call", callId: "call-1", name: "read_scene", arguments: '{"sceneId":"scene-1"}' };
    const tool = { name: "read_scene", description: "Read one scene", parameters: { type: "object" }, risk: "read", approval: "auto" };
    const completion = queueCompletion(
        { content: "我先查看。", toolCalls: [call], usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } },
        { content: "完成。", toolCalls: [], usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 } },
    );
    const executed = [];
    const result = await runBrainstormTurn(
        { ...context, tools: [tool] },
        {
            complete: completion.complete,
            executeTool: async (received, options) => {
                executed.push([received, options.definition]);
                return { status: "succeeded", content: "场次内容", sideEffect: "none" };
            },
        },
    );

    const toolResult = { type: "tool_result", callId: "call-1", name: "read_scene", status: "succeeded", content: "场次内容", sideEffect: "none" };
    assert.deepEqual(result, {
        status: "completed",
        content: "我先查看。完成。",
        output: [{ type: "text", text: "我先查看。" }, call, toolResult, { type: "text", text: "完成。" }],
        diagnostics,
        toolRounds: 1,
        usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
    });
    assert.deepEqual(executed, [[call, tool]]);
    assert.deepEqual(completion.requests[1].messages, [
        ...context.messages,
        { type: "message", role: "assistant", content: "我先查看。" },
        call,
        toolResult,
    ]);
});
