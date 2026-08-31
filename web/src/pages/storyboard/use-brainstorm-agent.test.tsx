import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { BrainstormTurnResult } from "./brainstorm-agent";
import type { BrainstormAgentRuntime, BrainstormAgentState } from "./use-brainstorm-agent";

const conversation = (id: string, currentMessageId = "") => ({ id, projectId: "project-1", title: id, currentMessageId, createdAt: "created", updatedAt: "updated" });
const userMessage = (id: string, conversationId: string, parentId = "") => ({
    id,
    projectId: "project-1",
    conversationId,
    parentId,
    role: "user" as const,
    content: id,
    revision: 1,
    createdAt: "created",
    updatedAt: "updated",
});
const assistantMessage = (id: string, conversationId: string, status: "pending" | "streaming" | "awaiting_approval" | "completed" | "failed" | "cancelled" | "interrupted", revision = 1) => ({
    id,
    projectId: "project-1",
    conversationId,
    parentId: "user-1",
    role: "assistant" as const,
    status,
    output: status === "awaiting_approval" ? [{ type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "awaiting_approval" as const, content: "请批准" }] : [],
    revision,
    createdAt: "created",
    updatedAt: "updated",
});

let accountId = "user-1";
let listConversations = async (_projectId: string) => ({ items: [conversation("conversation-1")], total: 1 });
let listMessages = async (_projectId: string, conversationId: string) => ({ conversation: conversation(conversationId), items: [], total: 0 });
let createConversation = async (_projectId: string, input: { id: string; title: string }) => conversation(input.id);
let renameConversation = async (_projectId: string, id: string, title: string) => ({ ...conversation(id), title });
let deleteConversation = async (_projectId: string, id: string) => ({ id, deletedAt: "now" });
let createTurn = async (_projectId: string, conversationId: string, input: { mode: string; userMessage?: { id: string; content: string }; assistantMessageId: string }) => ({
    conversation: conversation(conversationId, input.assistantMessageId),
    ...(input.userMessage ? { userMessage: userMessage(input.userMessage.id, conversationId) } : {}),
    assistantMessage: assistantMessage(input.assistantMessageId, conversationId, "pending"),
});
let updateAssistant = async (_projectId: string, conversationId: string, id: string, input: { status: Parameters<typeof assistantMessage>[2]; expectedRevision: number; output: ReturnType<typeof assistantMessage>["output"] }) => ({
    ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1),
    output: input.output,
});
let continueAssistant = async (_projectId: string, conversationId: string, id: string, input: { expectedRevision: number }) => ({
    conversation: conversation(conversationId, id),
    assistantMessage: assistantMessage(id, conversationId, "pending", input.expectedRevision + 1),
});
const apiCalls: unknown[][] = [];

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: unknown) => unknown) => selector({ user: accountId ? { id: accountId } : null }) }));
mock.module("@/services/api/storyboard-brainstorm", () => ({
    fetchStoryboardBrainstormConversations: (...args: Parameters<typeof listConversations>) => listConversations(...args),
    createStoryboardBrainstormConversation: (...args: Parameters<typeof createConversation>) => createConversation(...args),
    renameStoryboardBrainstormConversation: (...args: Parameters<typeof renameConversation>) => renameConversation(...args),
    deleteStoryboardBrainstormConversation: (...args: Parameters<typeof deleteConversation>) => deleteConversation(...args),
    fetchStoryboardBrainstormMessages: (...args: Parameters<typeof listMessages>) => listMessages(...args),
    createStoryboardBrainstormTurn: (...args: Parameters<typeof createTurn>) => {
        apiCalls.push(["turn", ...args]);
        return createTurn(...args);
    },
    updateStoryboardBrainstormAssistant: (...args: Parameters<typeof updateAssistant>) => {
        apiCalls.push(["update", ...args]);
        return updateAssistant(...args);
    },
    continueStoryboardBrainstormAssistant: (...args: Parameters<typeof continueAssistant>) => continueAssistant(...args),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useBrainstormAgent } = await import("./use-brainstorm-agent");

const completed: BrainstormTurnResult = {
    status: "completed",
    content: "",
    output: [],
    diagnostics: { limitTokens: 1, reservedOutputTokens: 0, usedTokens: 0, toolSchemaTokens: 0, estimated: false, summary: "missing", items: [] },
    toolRounds: 0,
};
let runTurn: BrainstormAgentRuntime["run"] = async () => completed;
const runtime: BrainstormAgentRuntime = { run: (...args) => runTurn(...args) };
let current!: BrainstormAgentState;

function Harness({ projectId }: { projectId: string }) {
    current = useBrainstormAgent(projectId, runtime);
    return null;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function mount(projectId = "project-1") {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<Harness projectId={projectId} />));
    await flush();
    return { container, root };
}

async function unmount(target: Awaited<ReturnType<typeof mount>>) {
    await act(async () => target.root.unmount());
    target.container.remove();
}

test("加载时把孤立 active Assistant 标记为 interrupted，并保留待审批消息", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({
        conversation: conversation("conversation-1", "assistant-awaiting"),
        items: [userMessage("user-1", "conversation-1"), assistantMessage("assistant-pending", "conversation-1", "pending", 2), assistantMessage("assistant-awaiting", "conversation-1", "awaiting_approval", 4)],
        total: 3,
    });

    const mounted = await mount();

    assert.deepEqual(apiCalls, [
        ["update", "project-1", "conversation-1", "assistant-pending", { expectedRevision: 2, status: "interrupted", output: [] }],
    ]);
    assert.equal(current.messages.find((message) => message.id === "assistant-pending")?.status, "interrupted");
    assert.deepEqual(current.awaitingApproval.map((message) => message.id), ["assistant-awaiting"]);
    await unmount(mounted);
});

test("项目和会话切换后忽略迟到的加载结果", async () => {
    accountId = "user-1";
    const projectOne = deferred<{ items: ReturnType<typeof conversation>[]; total: number }>();
    listConversations = async (projectId) => (projectId === "project-1" ? projectOne.promise : { items: [{ ...conversation("conversation-2"), projectId }], total: 1 });
    listMessages = async (projectId, conversationId) => ({
        conversation: { ...conversation(conversationId), projectId },
        items: [userMessage(projectId === "project-2" ? "user-project-2" : "user-project-1", conversationId)],
        total: 1,
    });

    const mounted = await mount("project-1");
    await act(async () => mounted.root.render(<Harness projectId="project-2" />));
    await flush();
    projectOne.resolve({ items: [conversation("stale-conversation")], total: 1 });
    await flush();

    assert.equal(current.currentConversationId, "conversation-2");
    assert.deepEqual(current.messages.map((message) => message.id), ["user-project-2"]);
    await unmount(mounted);

    const conversationOne = deferred<Awaited<ReturnType<typeof listMessages>>>();
    listConversations = async () => ({ items: [conversation("conversation-1"), conversation("conversation-2")], total: 2 });
    listMessages = async (_projectId, conversationId) =>
        conversationId === "conversation-1"
            ? conversationOne.promise
            : { conversation: conversation("conversation-2"), items: [userMessage("user-2", "conversation-2")], total: 1 };

    const switched = await mount();
    await act(async () => current.selectConversation("conversation-2"));
    await flush();
    conversationOne.resolve({ conversation: conversation("conversation-1"), items: [userMessage("stale-user", "conversation-1")], total: 1 });
    await flush();

    assert.equal(current.currentConversationId, "conversation-2");
    assert.deepEqual(current.messages.map((message) => message.id), ["user-2"]);
    await unmount(switched);
});

test("只在服务端确认 Turn 后插入消息并启动 runtime", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    const confirmed = deferred<Awaited<ReturnType<typeof createTurn>>>();
    createTurn = async () => confirmed.promise;
    const running = deferred<BrainstormTurnResult>();
    const runtimeInputs: unknown[] = [];
    runTurn = async (input) => {
        runtimeInputs.push(input);
        return running.promise;
    };

    const mounted = await mount();
    let sending!: Promise<unknown>;
    await act(async () => {
        sending = current.send("让雨夜冲突更强");
        await Promise.resolve();
    });

    assert.deepEqual(current.messages, []);
    assert.deepEqual(runtimeInputs, []);
    const payload = apiCalls.at(-1)?.[3] as { userMessage: { id: string; content: string }; assistantMessageId: string };
    confirmed.resolve({
        conversation: conversation("conversation-1", payload.assistantMessageId),
        userMessage: userMessage(payload.userMessage.id, "conversation-1"),
        assistantMessage: assistantMessage(payload.assistantMessageId, "conversation-1", "pending"),
    });
    await act(async () => void (await sending));
    await flush();

    assert.deepEqual(current.messages.map((message) => message.id), [payload.userMessage.id, payload.assistantMessageId]);
    assert.equal(runtimeInputs.length, 1);
    assert.equal(current.runs["conversation-1"]?.active, true);
    running.resolve(completed);
    await flush();
    await unmount(mounted);
});

test("同一 Conversation 只允许一个本地 Turn，不同 Conversation 可并行", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1"), conversation("conversation-2")], total: 2 });
    listMessages = async (_projectId, conversationId) => ({ conversation: conversation(conversationId), items: [], total: 0 });
    createTurn = async (_projectId, conversationId, input) => ({
        conversation: conversation(conversationId, input.assistantMessageId),
        ...(input.userMessage ? { userMessage: userMessage(input.userMessage.id, conversationId) } : {}),
        assistantMessage: assistantMessage(input.assistantMessageId, conversationId, "pending"),
    });
    const pending = new Map<string, ReturnType<typeof deferred<BrainstormTurnResult>>>();
    runTurn = async (input) => {
        const value = deferred<BrainstormTurnResult>();
        pending.set(input.conversation.id, value);
        return value.promise;
    };

    const mounted = await mount();
    await act(async () => void (await current.send("第一条")));
    await assert.rejects(() => current.send("同会话第二条"), /active Turn/);
    await act(async () => void (await current.selectConversation("conversation-2")));
    await act(async () => void (await current.send("另一会话")));

    assert.equal(current.runs["conversation-1"]?.active, true);
    assert.equal(current.runs["conversation-2"]?.active, true);
    assert.equal(apiCalls.filter((call) => call[0] === "turn").length, 2);
    pending.get("conversation-1")?.resolve(completed);
    pending.get("conversation-2")?.resolve(completed);
    await flush();
    await unmount(mounted);
});
