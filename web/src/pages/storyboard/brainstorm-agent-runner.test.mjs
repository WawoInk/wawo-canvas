import assert from "node:assert/strict";
import { test } from "node:test";

import { resumeBrainstormTurn, runBrainstormTurn } from "./brainstorm-agent-runner.ts";

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
    const completion = queueCompletion({ content: "我先查看。", toolCalls: [call], usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } }, { content: "完成。", toolCalls: [], usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 } });
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
    assert.deepEqual(completion.requests[1].messages, [...context.messages, { type: "message", role: "assistant", content: "我先查看。" }, call, toolResult]);
});

test("executes tools sequentially, skips calls after a failure, and feeds every result back", async () => {
    const first = { type: "tool_call", callId: "call-1", name: "read_scene", arguments: "{}" };
    const second = { type: "tool_call", callId: "call-2", name: "read_shot", arguments: "{}" };
    const completion = queueCompletion({ content: "", toolCalls: [first, second] }, { content: "读取失败，请检查场次。", toolCalls: [] });
    const executed = [];
    const result = await runBrainstormTurn(
        {
            ...context,
            tools: [
                { name: "read_scene", description: "", parameters: {}, risk: "read", approval: "auto" },
                { name: "read_shot", description: "", parameters: {}, risk: "read", approval: "auto" },
            ],
        },
        {
            complete: completion.complete,
            executeTool: async (call) => {
                executed.push(call.callId);
                return { status: "failed", content: "场次不存在", sideEffect: "none" };
            },
        },
    );

    const failed = { type: "tool_result", callId: "call-1", name: "read_scene", status: "failed", content: "场次不存在", sideEffect: "none" };
    const skipped = { type: "tool_result", callId: "call-2", name: "read_shot", status: "skipped", content: "Skipped because a previous tool call failed." };
    assert.deepEqual(executed, ["call-1"]);
    assert.deepEqual(result.output, [first, failed, second, skipped, { type: "text", text: "读取失败，请检查场次。" }]);
    assert.deepEqual(completion.requests[1].messages, [...context.messages, first, failed, second, skipped]);
});

test("suspends an approval-required tool and resumes after approval", async () => {
    const call = { type: "tool_call", callId: "write-1", name: "save_memory", arguments: '{"content":"雨夜"}' };
    const tool = { name: "save_memory", description: "Save memory", parameters: {}, risk: "write", approval: "required" };
    const completion = queueCompletion({ content: "建议保存。", toolCalls: [call] }, { content: "已保存。", toolCalls: [] });
    let executions = 0;
    const dependencies = {
        complete: completion.complete,
        executeTool: async () => {
            executions += 1;
            return { status: "succeeded", content: "saved", sideEffect: "write" };
        },
    };
    const result = await runBrainstormTurn({ ...context, tools: [tool] }, dependencies);

    assert.equal(executions, 0);
    assert.equal(result.status, "awaiting_approval");
    assert.deepEqual(result.call, call);
    assert.equal(result.output.at(-1).status, "awaiting_approval");

    const resumed = await resumeBrainstormTurn(result.continuation, "approved", dependencies);
    assert.equal(executions, 1);
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.content, "建议保存。已保存。");
    assert.equal(completion.requests.length, 2);
    assert.deepEqual(completion.requests[1].messages.at(-1), {
        type: "tool_result",
        callId: "write-1",
        name: "save_memory",
        status: "succeeded",
        content: "saved",
        sideEffect: "write",
    });
});

test("resumes an approval-required tool with a rejected result without executing it", async () => {
    const call = { type: "tool_call", callId: "write-1", name: "save_memory", arguments: "{}" };
    const completion = queueCompletion({ content: "", toolCalls: [call] }, { content: "已取消保存。", toolCalls: [] });
    let executions = 0;
    const dependencies = {
        complete: completion.complete,
        executeTool: async () => {
            executions += 1;
            return { status: "succeeded", content: "unexpected" };
        },
    };
    const pending = await runBrainstormTurn(
        { ...context, tools: [{ name: "save_memory", description: "", parameters: {}, risk: "write", approval: "required" }] },
        dependencies,
    );
    const resumed = await resumeBrainstormTurn(pending.continuation, "rejected", dependencies);

    assert.equal(executions, 0);
    assert.equal(resumed.status, "completed");
    assert.equal(resumed.content, "已取消保存。");
    assert.deepEqual(completion.requests[1].messages.at(-1), {
        type: "tool_result",
        callId: "write-1",
        name: "save_memory",
        status: "rejected",
        content: "Tool execution was rejected by the user.",
        sideEffect: "none",
    });
});

test("rejects an unregistered tool without invoking the executor", async () => {
    const call = { type: "tool_call", callId: "call-unknown", name: "delete_everything", arguments: "{}" };
    const completion = queueCompletion({ content: "", toolCalls: [call] }, { content: "该工具不可用。", toolCalls: [] });
    let executions = 0;
    const result = await runBrainstormTurn(context, {
        complete: completion.complete,
        executeTool: async () => {
            executions += 1;
            return { status: "succeeded", content: "unexpected" };
        },
    });

    assert.equal(executions, 0);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.output.slice(0, 2), [
        call,
        { type: "tool_result", callId: "call-unknown", name: "delete_everything", status: "failed", content: "Tool is not registered." },
    ]);
});

test("executes four tool batches and returns the round limit without a fifth completion", async () => {
    const calls = Array.from({ length: 4 }, (_, index) => ({ type: "tool_call", callId: `call-${index + 1}`, name: "read_scene", arguments: "{}" }));
    const completion = queueCompletion(...calls.map((call) => ({ content: "", toolCalls: [call] })));
    const events = [];
    const result = await runBrainstormTurn(
        { ...context, tools: [{ name: "read_scene", description: "", parameters: {}, risk: "read", approval: "auto" }] },
        {
            complete: completion.complete,
            executeTool: async (call) => ({ status: "succeeded", content: `result-${call.callId}`, sideEffect: "none" }),
        },
        { onEvent: (event) => events.push(event) },
    );

    assert.equal(completion.requests.length, 4);
    assert.equal(result.status, "failed");
    assert.equal(result.toolRounds, 4);
    assert.deepEqual(result.error, { code: "TOOL_ROUND_LIMIT", message: "Brainstorm tool loop reached the maximum of 4 rounds." });
    assert.deepEqual(
        result.output.map((item) => item.type),
        ["tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result", "tool_call", "tool_result"],
    );
    assert.deepEqual(events.at(-1), { type: "status", status: "failed" });
});

test("retries one retryable completion failure before any output", async () => {
    const completion = queueCompletion(
        () => {
            throw new Error("temporary network failure");
        },
        { content: "重试成功", toolCalls: [] },
    );
    const events = [];
    const result = await runBrainstormTurn(
        context,
        {
            complete: completion.complete,
            executeTool: noTool,
            isRetryableCompletionError: (error) => error instanceof Error && error.message.includes("temporary"),
        },
        { onEvent: (event) => events.push(event) },
    );

    assert.equal(completion.requests.length, 2);
    assert.equal(result.status, "completed");
    assert.equal(result.content, "重试成功");
    assert.deepEqual(
        events.filter((event) => event.type === "retry"),
        [{ type: "retry" }],
    );
});

test("does not retry after streamed text and preserves the partial response", async () => {
    const completion = queueCompletion((_options) => {
        _options.onEvent({ type: "text_delta", delta: "已生成部分" });
        throw new Error("stream disconnected");
    });
    const events = [];
    const result = await runBrainstormTurn(
        context,
        {
            complete: completion.complete,
            executeTool: noTool,
            isRetryableCompletionError: () => true,
        },
        { onEvent: (event) => events.push(event) },
    );

    assert.equal(completion.requests.length, 1);
    assert.deepEqual(result, {
        status: "failed",
        error: { code: "COMPLETION_FAILED", message: "stream disconnected" },
        content: "已生成部分",
        output: [{ type: "text", text: "已生成部分" }],
        diagnostics,
        toolRounds: 0,
    });
    assert.deepEqual(events.at(-2), { type: "output_item", item: { type: "text", text: "已生成部分" } });
    assert.deepEqual(events.at(-1), { type: "status", status: "failed" });
});

test("does not retry after a streamed tool-call delta", async () => {
    const completion = queueCompletion((options) => {
        options.onEvent({ type: "tool_call_delta", callId: "call-1", name: "read_scene", argumentsDelta: "{" });
        throw new Error("tool stream disconnected");
    });
    const result = await runBrainstormTurn(context, {
        complete: completion.complete,
        executeTool: noTool,
        isRetryableCompletionError: () => true,
    });

    assert.equal(completion.requests.length, 1);
    assert.equal(result.status, "failed");
    assert.deepEqual(result.output, []);
});

test("turns a thrown tool error into a failed result and continues the model loop", async () => {
    const first = { type: "tool_call", callId: "call-1", name: "read_scene", arguments: "{}" };
    const second = { type: "tool_call", callId: "call-2", name: "read_shot", arguments: "{}" };
    const completion = queueCompletion({ content: "", toolCalls: [first, second] }, { content: "工具失败已说明。", toolCalls: [] });
    const executed = [];
    const result = await runBrainstormTurn(
        {
            ...context,
            tools: [
                { name: "read_scene", description: "", parameters: {}, risk: "read", approval: "auto" },
                { name: "read_shot", description: "", parameters: {}, risk: "read", approval: "auto" },
            ],
        },
        {
            complete: completion.complete,
            executeTool: async (call) => {
                executed.push(call.callId);
                throw new Error("lookup exploded");
            },
        },
    );

    assert.deepEqual(executed, ["call-1"]);
    assert.deepEqual(result.output.slice(0, 4), [
        first,
        { type: "tool_result", callId: "call-1", name: "read_scene", status: "failed", content: "lookup exploded" },
        second,
        { type: "tool_result", callId: "call-2", name: "read_shot", status: "skipped", content: "Skipped because a previous tool call failed." },
    ]);
    assert.equal(result.status, "completed");
});

test("skips an approval-required call when an earlier call in the batch failed", async () => {
    const first = { type: "tool_call", callId: "call-1", name: "read_scene", arguments: "{}" };
    const second = { type: "tool_call", callId: "call-2", name: "save_memory", arguments: "{}" };
    const completion = queueCompletion({ content: "", toolCalls: [first, second] }, { content: "未保存。", toolCalls: [] });
    const result = await runBrainstormTurn(
        {
            ...context,
            tools: [
                { name: "read_scene", description: "", parameters: {}, risk: "read", approval: "auto" },
                { name: "save_memory", description: "", parameters: {}, risk: "write", approval: "required" },
            ],
        },
        {
            complete: completion.complete,
            executeTool: async () => ({ status: "failed", content: "missing" }),
        },
    );

    assert.equal(result.status, "completed");
    assert.deepEqual(result.output[3], { type: "tool_result", callId: "call-2", name: "save_memory", status: "skipped", content: "Skipped because a previous tool call failed." });
});

test("suspends when an executor reports that approval is required", async () => {
    const call = { type: "tool_call", callId: "call-1", name: "conditional_write", arguments: "{}" };
    const result = await runBrainstormTurn(
        { ...context, tools: [{ name: "conditional_write", description: "", parameters: {}, risk: "write", approval: "auto" }] },
        {
            complete: queueCompletion({ content: "", toolCalls: [call] }).complete,
            executeTool: async () => ({ status: "awaiting_approval", content: "Dynamic approval required.", sideEffect: "none" }),
        },
    );

    assert.equal(result.status, "awaiting_approval");
    assert.deepEqual(result.call, call);
    assert.deepEqual(result.output, [call, { type: "tool_result", callId: "call-1", name: "conditional_write", status: "awaiting_approval", content: "Dynamic approval required.", sideEffect: "none" }]);
});

test("preserves streamed text when completion is cancelled", async () => {
    const controller = new AbortController();
    const completion = queueCompletion((options) => {
        options.onEvent({ type: "text_delta", delta: "保留这部分" });
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
    });
    const result = await runBrainstormTurn(
        context,
        {
            complete: completion.complete,
            executeTool: noTool,
            isRetryableCompletionError: () => true,
        },
        { signal: controller.signal },
    );

    assert.deepEqual(result, {
        status: "cancelled",
        error: { code: "ABORTED", message: "Brainstorm turn was cancelled." },
        content: "保留这部分",
        output: [{ type: "text", text: "保留这部分" }],
        diagnostics,
        toolRounds: 0,
    });
    assert.equal(completion.requests.length, 1);
});

test("cancels during tool execution and keeps the tool pair complete", async () => {
    const call = { type: "tool_call", callId: "call-1", name: "read_scene", arguments: "{}" };
    const completion = queueCompletion({ content: "正在读取。", toolCalls: [call] });
    const events = [];
    const result = await runBrainstormTurn(
        { ...context, tools: [{ name: "read_scene", description: "", parameters: {}, risk: "read", approval: "auto" }] },
        {
            complete: completion.complete,
            executeTool: async () => {
                throw new DOMException("Aborted", "AbortError");
            },
        },
        { onEvent: (event) => events.push(event) },
    );

    assert.equal(completion.requests.length, 1);
    assert.deepEqual(result, {
        status: "cancelled",
        error: { code: "ABORTED", message: "Brainstorm turn was cancelled." },
        content: "正在读取。",
        output: [{ type: "text", text: "正在读取。" }, call, { type: "tool_result", callId: "call-1", name: "read_scene", status: "failed", content: "Brainstorm turn was cancelled." }],
        diagnostics,
        toolRounds: 1,
    });
    assert.deepEqual(events.at(-1), { type: "status", status: "cancelled" });
});

test("retries at most once per turn", async () => {
    const completion = queueCompletion(
        () => {
            throw new Error("temporary one");
        },
        () => {
            throw new Error("temporary two");
        },
        { content: "must not run", toolCalls: [] },
    );
    const events = [];
    const result = await runBrainstormTurn(context, { complete: completion.complete, executeTool: noTool, isRetryableCompletionError: () => true }, { onEvent: (event) => events.push(event) });

    assert.equal(completion.requests.length, 2);
    assert.equal(result.status, "failed");
    assert.equal(result.error.message, "temporary two");
    assert.equal(events.filter((event) => event.type === "retry").length, 1);
});

test("does not retry a later completion after a write side effect", async () => {
    const call = { type: "tool_call", callId: "call-1", name: "write_tool", arguments: "{}" };
    const completion = queueCompletion(
        { content: "", toolCalls: [call] },
        () => {
            throw new Error("temporary after write");
        },
        { content: "must not run", toolCalls: [] },
    );
    const result = await runBrainstormTurn(
        { ...context, tools: [{ name: "write_tool", description: "", parameters: {}, risk: "write", approval: "auto" }] },
        {
            complete: completion.complete,
            executeTool: async () => ({ status: "succeeded", content: "written", sideEffect: "write" }),
            isRetryableCompletionError: () => true,
        },
    );

    assert.equal(completion.requests.length, 2);
    assert.equal(result.status, "failed");
    assert.equal(result.error.message, "temporary after write");
});

test("does not start tool execution when cancellation wins after completion", async () => {
    const controller = new AbortController();
    const call = { type: "tool_call", callId: "call-1", name: "read_scene", arguments: "{}" };
    let executions = 0;
    const result = await runBrainstormTurn(
        { ...context, tools: [{ name: "read_scene", description: "", parameters: {}, risk: "read", approval: "auto" }] },
        {
            complete: async () => {
                controller.abort();
                return { content: "", toolCalls: [call] };
            },
            executeTool: async () => {
                executions += 1;
                return { status: "succeeded", content: "unexpected" };
            },
        },
        { signal: controller.signal },
    );

    assert.equal(executions, 0);
    assert.equal(result.status, "cancelled");
    assert.deepEqual(result.output, [call, { type: "tool_result", callId: "call-1", name: "read_scene", status: "failed", content: "Brainstorm turn was cancelled." }]);
});
