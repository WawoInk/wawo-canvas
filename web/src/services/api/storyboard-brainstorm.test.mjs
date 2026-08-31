import assert from "node:assert/strict";
import { test } from "node:test";

let token = "token-1";
const calls = [];
// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/i18n", () => ({ default: { t: (key) => key } }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: { getState: () => ({ token }) } }));
mock.module("@/services/api/request", () => ({
    apiGet: async (...args) => {
        calls.push(["get", ...args]);
        return { items: [], total: 0 };
    },
    apiPost: async (...args) => {
        calls.push(["post", ...args]);
        return args[1];
    },
    apiPut: async (...args) => {
        calls.push(["put", ...args]);
        return args[1];
    },
    apiDelete: async (...args) => {
        calls.push(["delete", ...args]);
        return { id: "deleted", deletedAt: "now" };
    },
}));

const {
    continueStoryboardBrainstormAssistant,
    createStoryboardBrainstormConversation,
    createStoryboardBrainstormTurn,
    createStoryboardMemory,
    deleteStoryboardBrainstormConversation,
    deleteStoryboardMemory,
    fetchStoryboardBrainstormConversations,
    fetchStoryboardBrainstormMessages,
    fetchStoryboardMemories,
    renameStoryboardBrainstormConversation,
    updateStoryboardBrainstormAssistant,
    updateStoryboardMemory,
} = await import("./storyboard-brainstorm.ts?api-test");

test("分页列表使用当前登录令牌和编码后的 scoped 路径", async () => {
    calls.length = 0;
    token = "token-1";

    await fetchStoryboardBrainstormConversations("project/a", { page: 2, pageSize: 25 });
    await fetchStoryboardBrainstormMessages("project/a", "conversation/b", { page: 3, pageSize: 40 });
    await fetchStoryboardMemories("project/a", { page: 4, pageSize: 50 });

    assert.deepEqual(calls, [
        ["get", "/api/v1/storyboards/project%2Fa/conversations", { page: 2, pageSize: 25 }, "token-1"],
        ["get", "/api/v1/storyboards/project%2Fa/conversations/conversation%2Fb/messages", { page: 3, pageSize: 40 }, "token-1"],
        ["get", "/api/v1/storyboards/project%2Fa/memories", { page: 4, pageSize: 50 }, "token-1"],
    ]);
});

test("Conversation CRUD 透传服务端合同", async () => {
    calls.length = 0;

    await createStoryboardBrainstormConversation("project/a", { id: "conversation-1", title: "第一幕" });
    await renameStoryboardBrainstormConversation("project/a", "conversation/b", "雨夜重逢");
    await deleteStoryboardBrainstormConversation("project/a", "conversation/b");

    assert.deepEqual(calls, [
        ["post", "/api/v1/storyboards/project%2Fa/conversations", { id: "conversation-1", title: "第一幕" }, "token-1"],
        ["put", "/api/v1/storyboards/project%2Fa/conversations/conversation%2Fb/title", { title: "雨夜重逢" }, "token-1"],
        ["delete", "/api/v1/storyboards/project%2Fa/conversations/conversation%2Fb", "token-1"],
    ]);
});

test("append 和 regenerate Turn payload 原样提交", async () => {
    calls.length = 0;
    const append = {
        mode: "append",
        clientRequestId: "request-1",
        parentMessageId: "assistant/parent",
        userMessage: { id: "user-1", content: "补充雨势" },
        assistantMessageId: "assistant-2",
    };
    const regenerate = {
        mode: "regenerate",
        clientRequestId: "request-2",
        targetMessageId: "assistant/old",
        assistantMessageId: "assistant-3",
    };

    await createStoryboardBrainstormTurn("project/a", "conversation/b", append);
    await createStoryboardBrainstormTurn("project/a", "conversation/b", regenerate);

    assert.deepEqual(calls, [
        ["post", "/api/v1/storyboards/project%2Fa/conversations/conversation%2Fb/turns", append, "token-1"],
        ["post", "/api/v1/storyboards/project%2Fa/conversations/conversation%2Fb/turns", regenerate, "token-1"],
    ]);
});

test("Assistant CAS 和 continue 使用 revision 合同", async () => {
    calls.length = 0;
    const update = {
        expectedRevision: 3,
        status: "awaiting_approval",
        output: [
            { type: "text", text: "先调整镜头" },
            { type: "tool_call", callId: "call-1", name: "save_memory", arguments: { scope: "scene" } },
        ],
    };
    const continuation = { clientRequestId: "continue-1", expectedRevision: 4 };

    await updateStoryboardBrainstormAssistant("project/a", "conversation/b", "assistant/c", update);
    await continueStoryboardBrainstormAssistant("project/a", "conversation/b", "assistant/c", continuation);

    assert.deepEqual(calls, [
        ["put", "/api/v1/storyboards/project%2Fa/conversations/conversation%2Fb/messages/assistant%2Fc/assistant", update, "token-1"],
        ["post", "/api/v1/storyboards/project%2Fa/conversations/conversation%2Fb/messages/assistant%2Fc/continue", continuation, "token-1"],
    ]);
});

test("Memory CRUD 使用 scoped 路径并透传确认后的 payload", async () => {
    calls.length = 0;
    const created = {
        id: "memory-1",
        kind: "character",
        scope: "scene",
        path: "scene-1",
        content: "主角惧怕雷声",
        tags: ["主角", "雷雨"],
        sourceMessageId: "assistant-1",
        operationId: "operation-1",
    };
    const updated = {
        kind: "character",
        scope: "project",
        path: "",
        content: "主角已经克服雷声恐惧",
        tags: ["主角"],
        sourceMessageId: "assistant-2",
        operationId: "operation-2",
    };

    await createStoryboardMemory("project/a", created);
    await updateStoryboardMemory("project/a", "memory/b", updated);
    await deleteStoryboardMemory("project/a", "memory/b");

    assert.deepEqual(calls, [
        ["post", "/api/v1/storyboards/project%2Fa/memories", created, "token-1"],
        ["put", "/api/v1/storyboards/project%2Fa/memories/memory%2Fb", updated, "token-1"],
        ["delete", "/api/v1/storyboards/project%2Fa/memories/memory%2Fb", "token-1"],
    ]);
});

test("未登录时在发送请求前拒绝访问", () => {
    calls.length = 0;
    token = "";

    assert.throws(() => fetchStoryboardBrainstormConversations("project-1"), { message: "errors.authRequired" });
    assert.deepEqual(calls, []);
    token = "token-1";
});
