import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeBrainstormSummaryCheckpoint, planBrainstormSummaryCheckpoint } from "./brainstorm-agent-summary.ts";

const user = (id, parentId, content) => ({ id, parentId, role: "user", content });
const assistant = (id, parentId, output, usage) => ({ id, parentId, role: "assistant", status: "completed", output, usage });

test("plans a branch checkpoint through a User Message and merges prior Summary metadata", () => {
    const messages = [
        user("u1", null, "已被旧摘要覆盖"),
        assistant("a1", "u1", [{ type: "text", text: "OLDER_ASSISTANT" }], { outputTokens: 11 }),
        user("u2", "a1", "需要进入新摘要"),
        assistant("a2", "u2", [{ type: "tool_call", callId: "read-1", name: "read_scene", arguments: "{}" }]),
        assistant("a3", "a2", [{ type: "tool_result", callId: "read-1", name: "read_scene", status: "succeeded", content: "RESULT" }]),
        user("u3", "a3", "保留最近一轮"),
        assistant("a4", "u3", [{ type: "text", text: "RECENT_ASSISTANT" }]),
    ];
    const previous = {
        id: "summary-1",
        fromMessageId: "u0",
        throughMessageId: "u1",
        content: "OLD_SUMMARY",
        tokenCount: 12,
        sourceTokenCount: 40,
        coveredMessageCount: 2,
        model: "model-old",
    };

    const plan = planBrainstormSummaryCheckpoint({ messages, previous, triggerTokens: 1, retainTokens: 10_000, model: "model-new" });
    assert.ok(plan);
    assert.equal(plan.throughMessageId, "u2");
    assert.equal(messages.find((message) => message.id === plan.throughMessageId).role, "user");
    assert.deepEqual(
        plan.messages.map((message) => message.id),
        ["a1", "u2"],
    );
    assert.deepEqual(plan.retainedMessageIds, ["a2", "a3", "u3", "a4"]);
    assert.equal(plan.previousSummary, "OLD_SUMMARY");
    assert.equal(plan.model, "model-new");

    const checkpoint = mergeBrainstormSummaryCheckpoint(plan, { id: "summary-2", content: " MERGED_SUMMARY ", tokenCount: 17 });
    assert.deepEqual(checkpoint, {
        id: "summary-2",
        fromMessageId: "u0",
        throughMessageId: "u2",
        content: "MERGED_SUMMARY",
        tokenCount: 17,
        sourceTokenCount: plan.sourceTokenCount,
        coveredMessageCount: 4,
        model: "model-new",
    });
});

test("never chooses a User boundary that splits a Tool Call and Tool Result", () => {
    const messages = [
        user("u1", null, "开始"),
        assistant("a-call", "u1", [{ type: "tool_call", callId: "pair", name: "read_scene", arguments: "{}" }]),
        user("u2", "a-call", "不要在这里截断"),
        assistant("a-result", "u2", [{ type: "tool_result", callId: "pair", name: "read_scene", status: "succeeded", content: "RESULT" }]),
        user("u3", "a-result", "允许在这里截断"),
        assistant("a3", "u3", [{ type: "text", text: "TAIL" }]),
    ];

    const plan = planBrainstormSummaryCheckpoint({ messages, triggerTokens: 1, retainTokens: 70, model: "model-1" });
    assert.ok(plan);
    assert.equal(plan.throughMessageId, "u3");
    const summarized = new Set(plan.messages.map((message) => message.id));
    assert.equal(summarized.has("a-call"), summarized.has("a-result"));
});

test("does not plan compression below the trigger or without a User boundary", () => {
    assert.equal(planBrainstormSummaryCheckpoint({ messages: [user("u1", null, "短消息")], triggerTokens: 10_000, retainTokens: 100, model: "model-1" }), null);
    assert.equal(
        planBrainstormSummaryCheckpoint({ messages: [assistant("a1", null, [{ type: "text", text: "没有用户边界" }])], triggerTokens: 1, retainTokens: 1, model: "model-1" }),
        null,
    );
});

test("counts the previous checkpoint toward the compression trigger before merging it", () => {
    const messages = [user("u1", null, "旧边界"), assistant("a1", "u1", [{ type: "text", text: "新增回答" }]), user("u2", "a1", "新增问题")];
    const plan = planBrainstormSummaryCheckpoint({
        messages,
        previous: { id: "summary-1", throughMessageId: "u1", content: "OLD_SUMMARY", tokenCount: 600 },
        triggerTokens: 500,
        retainTokens: 10_000,
        model: "model-1",
    });

    assert.ok(plan);
    assert.equal(plan.previousSummary, "OLD_SUMMARY");
    assert.equal(plan.throughMessageId, "u2");
});
