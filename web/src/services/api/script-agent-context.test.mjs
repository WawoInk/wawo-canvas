import assert from "node:assert/strict";
import { test } from "node:test";

import { buildScriptAgentConversationContext } from "./script-agent.ts";

const activeMessages = [
    { id: "m1", role: "user", content: "人物需要更克制", createdAt: "2026-08-30T00:00:00.000Z" },
    { id: "m2", role: "assistant", content: "可以减少直接表态", createdAt: "2026-08-30T00:01:00.000Z" },
];
const workspace = {
    messages: [{ id: "stale", role: "user", content: "顶层旧副本", createdAt: "2026-08-30T00:00:00.000Z" }],
    activeConversationId: "active",
    conversations: [
        { id: "active", title: "人物设定", messages: activeMessages, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:01:00.000Z" },
        { id: "other", title: "结局优化", messages: [{ id: "secret", role: "user", content: "另一个会话的秘密结局", createdAt: "2026-08-30T00:00:00.000Z" }], createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" },
    ],
};

test("Agent 上下文只包含当前会话的历史消息", () => {
    const context = buildScriptAgentConversationContext(workspace);

    assert.match(context, /用户：人物需要更克制/);
    assert.match(context, /助手：可以减少直接表态/);
    assert.doesNotMatch(context, /另一个会话的秘密结局/);
    assert.doesNotMatch(context, /顶层旧副本/);
});
