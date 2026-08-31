import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { BrainstormTurnResult } from "./brainstorm-agent";
import type { BrainstormAgentAssistantMessage, BrainstormAgentRuntime, BrainstormAgentState, BrainstormAgentUserMessage, BrainstormConversation } from "./use-brainstorm-agent";

const conversation = (id: string, currentMessageId = ""): BrainstormConversation => ({ id, projectId: "project-1", title: id, currentMessageId, createdAt: "created", updatedAt: "updated" });
const userMessage = (id: string, conversationId: string, parentId = ""): BrainstormAgentUserMessage => ({
    id,
    projectId: "project-1",
    conversationId,
    parentId,
    role: "user" as const,
    content: id,
    output: [],
    revision: 1,
    createdAt: "created",
    updatedAt: "updated",
});
const assistantMessage = (id: string, conversationId: string, status: BrainstormAgentAssistantMessage["status"], revision = 1): BrainstormAgentAssistantMessage => ({
    id,
    projectId: "project-1",
    conversationId,
    parentId: "user-1",
    role: "assistant" as const,
    status,
    clientRequestId: "request-1",
    output: status === "awaiting_approval" ? [{ type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "awaiting_approval" as const, content: "请批准" }] : [],
    revision,
    createdAt: "created",
    updatedAt: "updated",
});

function findAssistant(messages: BrainstormAgentState["messages"], id: string) {
    return messages.find((message): message is BrainstormAgentAssistantMessage => message.role === "assistant" && message.id === id);
}

let accountId = "user-1";
let listConversations: (projectId: string, query?: { page?: number; pageSize?: number }) => Promise<{ items: BrainstormConversation[]; total: number }> = async (_projectId) => ({
    items: [conversation("conversation-1")],
    total: 1,
});
let listMessages: (
    projectId: string,
    conversationId: string,
    query?: { page?: number; pageSize?: number },
) => Promise<{ conversation: BrainstormConversation; items: Array<BrainstormAgentUserMessage | BrainstormAgentAssistantMessage>; total: number }> = async (_projectId, conversationId) => ({
    conversation: conversation(conversationId),
    items: [],
    total: 0,
});
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
    createStoryboardBrainstormConversation: (...args: Parameters<typeof createConversation>) => {
        apiCalls.push(["create-conversation", ...args]);
        return createConversation(...args);
    },
    renameStoryboardBrainstormConversation: (...args: Parameters<typeof renameConversation>) => {
        apiCalls.push(["rename-conversation", ...args]);
        return renameConversation(...args);
    },
    deleteStoryboardBrainstormConversation: (...args: Parameters<typeof deleteConversation>) => {
        apiCalls.push(["delete-conversation", ...args]);
        return deleteConversation(...args);
    },
    fetchStoryboardBrainstormMessages: (...args: Parameters<typeof listMessages>) => listMessages(...args),
    createStoryboardBrainstormTurn: (...args: Parameters<typeof createTurn>) => {
        apiCalls.push(["turn", ...args]);
        return createTurn(...args);
    },
    updateStoryboardBrainstormAssistant: (...args: Parameters<typeof updateAssistant>) => {
        apiCalls.push(["update", ...args]);
        return updateAssistant(...args);
    },
    continueStoryboardBrainstormAssistant: (...args: Parameters<typeof continueAssistant>) => {
        apiCalls.push(["continue", ...args]);
        return continueAssistant(...args);
    },
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

    assert.deepEqual(apiCalls, [["update", "project-1", "conversation-1", "assistant-pending", { expectedRevision: 2, status: "interrupted", output: [] }]]);
    assert.equal(findAssistant(current.messages, "assistant-pending")?.status, "interrupted");
    assert.deepEqual(
        current.awaitingApproval.map((message) => message.id),
        ["assistant-awaiting"],
    );
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
    assert.deepEqual(
        (current.messages as Array<{ id: string }>).map((message) => message.id),
        ["user-project-2"],
    );
    await unmount(mounted);

    const conversationOne = deferred<Awaited<ReturnType<typeof listMessages>>>();
    listConversations = async () => ({ items: [conversation("conversation-1"), conversation("conversation-2")], total: 2 });
    listMessages = async (_projectId, conversationId) => (conversationId === "conversation-1" ? conversationOne.promise : { conversation: conversation("conversation-2"), items: [userMessage("user-2", "conversation-2")], total: 1 });

    const switched = await mount();
    await act(async () => current.selectConversation("conversation-2"));
    await flush();
    conversationOne.resolve({ conversation: conversation("conversation-1"), items: [userMessage("stale-user", "conversation-1")], total: 1 });
    await flush();

    assert.equal(current.currentConversationId, "conversation-2");
    assert.deepEqual(
        (current.messages as Array<{ id: string }>).map((message) => message.id),
        ["user-2"],
    );
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

    assert.deepEqual(
        (current.messages as Array<{ id: string }>).map((message) => message.id),
        [payload.userMessage.id, payload.assistantMessageId],
    );
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
    await assert.rejects(() => current.send("同会话第二条"), /正在执行/);
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

test("文本 delta 只留在内存，工具边界 checkpoint，结束时持久化完整有序 output", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    createTurn = async (_projectId, conversationId, input) => ({
        conversation: conversation(conversationId, input.assistantMessageId),
        userMessage: userMessage(input.userMessage!.id, conversationId),
        assistantMessage: assistantMessage(input.assistantMessageId, conversationId, "pending"),
    });
    updateAssistant = async (_projectId, conversationId, id, input) => ({
        ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1),
        output: input.output,
    });
    const beforeTool = deferred<void>();
    const afterCall = deferred<void>();
    const output = [
        { type: "text" as const, text: "先拉近镜头" },
        { type: "tool_call" as const, callId: "call-1", name: "save_memory", arguments: "{}" },
        { type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "succeeded" as const, content: "已保存" },
    ];
    runTurn = async (_input, { onEvent }) => {
        onEvent({ type: "status", status: "streaming" });
        onEvent({ type: "text_delta", delta: "先拉" });
        await beforeTool.promise;
        onEvent({ type: "output_item", item: output[0] });
        onEvent({ type: "output_item", item: output[1] });
        await afterCall.promise;
        onEvent({ type: "output_item", item: output[2] });
        return { ...completed, content: "先拉近镜头", output };
    };

    const mounted = await mount();
    await act(async () => void (await current.send("调整镜头")));
    await flush();

    assert.equal(current.runs["conversation-1"].streamedText, "先拉");
    assert.equal(apiCalls.filter((call) => call[0] === "update").length, 0);
    beforeTool.resolve();
    await flush();

    const checkpoints = apiCalls.filter((call) => call[0] === "update");
    assert.equal(checkpoints.length, 1);
    assert.deepEqual(checkpoints[0][4], { expectedRevision: 1, status: "streaming", output: output.slice(0, 2) });
    assert.equal(current.runs["conversation-1"].streamedText, "");
    afterCall.resolve();
    await flush();

    const persisted = apiCalls.filter((call) => call[0] === "update");
    assert.equal(persisted.length, 3);
    assert.deepEqual(persisted[1][4], { expectedRevision: 2, status: "streaming", output });
    assert.deepEqual(persisted[2][4], { expectedRevision: 3, status: "completed", output });
    assert.deepEqual((current.messages.at(-1) as { output: unknown }).output, output);
    await unmount(mounted);
});

test("停止生成依次暴露 requested 和服务端确认后的 confirmed", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    createTurn = async (_projectId, conversationId, input) => ({
        conversation: conversation(conversationId, input.assistantMessageId),
        userMessage: userMessage(input.userMessage!.id, conversationId),
        assistantMessage: assistantMessage(input.assistantMessageId, conversationId, "pending"),
    });
    const cancelledSave = deferred<ReturnType<typeof assistantMessage>>();
    updateAssistant = async (_projectId, conversationId, id, input) => (input.status === "cancelled" ? cancelledSave.promise : { ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1), output: input.output });
    runTurn = async (_input, { signal, onEvent }) =>
        new Promise<BrainstormTurnResult>((resolve) => {
            signal.addEventListener(
                "abort",
                () => {
                    onEvent({ type: "status", status: "cancelled" });
                    resolve({ ...completed, status: "cancelled", error: { code: "ABORTED", message: "cancelled" } });
                },
                { once: true },
            );
        });

    const mounted = await mount();
    await act(async () => void (await current.send("开始")));
    let stopping!: Promise<string>;
    await act(async () => {
        stopping = current.stop();
        await Promise.resolve();
    });
    assert.equal(current.runs["conversation-1"].stopState, "requested");

    const assistantId = current.runs["conversation-1"].assistantMessageId;
    cancelledSave.resolve(assistantMessage(assistantId, "conversation-1", "cancelled", 2));
    let outcome = "";
    await act(async () => {
        outcome = await stopping;
    });
    assert.equal(outcome, "confirmed");
    assert.equal(current.runs["conversation-1"].stopState, "confirmed");
    assert.equal(findAssistant(current.messages, assistantId)?.status, "cancelled");
    await unmount(mounted);
});

test("取消持久化失败时报告 failed，不能把 Assistant 伪装成 stopped", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    createTurn = async (_projectId, conversationId, input) => ({
        conversation: conversation(conversationId, input.assistantMessageId),
        userMessage: userMessage(input.userMessage!.id, conversationId),
        assistantMessage: assistantMessage(input.assistantMessageId, conversationId, "pending"),
    });
    updateAssistant = async (_projectId, conversationId, id, input) => {
        if (input.status === "cancelled") throw new Error("cancel persistence failed");
        return { ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1), output: input.output };
    };
    runTurn = async (_input, { signal, onEvent }) =>
        new Promise<BrainstormTurnResult>((resolve) => {
            signal.addEventListener(
                "abort",
                () => {
                    onEvent({ type: "status", status: "cancelled" });
                    resolve({ ...completed, status: "cancelled", error: { code: "ABORTED", message: "cancelled" } });
                },
                { once: true },
            );
        });

    const mounted = await mount();
    await act(async () => void (await current.send("开始")));
    let outcome = "";
    await act(async () => {
        outcome = await current.stop();
    });

    const run = current.runs["conversation-1"];
    assert.equal(outcome, "failed");
    assert.equal(run.stopState, "failed");
    assert.notEqual(run.status, "cancelled");
    assert.notEqual(findAssistant(current.messages, run.assistantMessageId)?.status, "cancelled");
    await unmount(mounted);
});

test("regenerate 创建 sibling，continue 复用 Assistant，retry 等同 regenerate", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    const original = { ...assistantMessage("assistant-old", "conversation-1", "completed", 3), output: [{ type: "text" as const, text: "原回答" }] };
    listConversations = async () => ({ items: [conversation("conversation-1", original.id)], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1", original.id), items: [userMessage("user-1", "conversation-1"), original], total: 2 });
    createTurn = async (_projectId, conversationId, input) => ({
        conversation: conversation(conversationId, input.assistantMessageId),
        assistantMessage: { ...assistantMessage(input.assistantMessageId, conversationId, "pending"), parentId: "user-1" },
    });
    continueAssistant = async (_projectId, conversationId, id, input) => ({
        conversation: conversation(conversationId, id),
        assistantMessage: { ...assistantMessage(id, conversationId, "pending", input.expectedRevision + 1), output: original.output },
    });
    updateAssistant = async (_projectId, conversationId, id, input) => ({
        ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1),
        output: input.output,
    });
    const runtimeInputs: Array<{ mode: string; assistantMessage: { id: string; output: unknown[] } }> = [];
    runTurn = async (input) => {
        runtimeInputs.push(input);
        return { ...completed, content: "续写", output: [...input.assistantMessage.output, { type: "text", text: `-${input.mode}` }] };
    };

    const mounted = await mount();
    let siblingId = "";
    await act(async () => {
        siblingId = (await current.regenerate("assistant-old")).id;
    });
    await flush();
    assert.notEqual(siblingId, "assistant-old");
    assert.ok(current.messages.some((message) => message.id === "assistant-old"));
    assert.ok(current.messages.some((message) => message.id === siblingId));

    await act(async () => void (await current.continueAssistant("assistant-old")));
    await flush();
    await act(async () => void (await current.retry("assistant-old")));
    await flush();

    const turnCalls = apiCalls.filter((call) => call[0] === "turn");
    assert.deepEqual(
        turnCalls.map((call) => ({ mode: (call[3] as { mode: string }).mode, target: (call[3] as { targetMessageId: string }).targetMessageId })),
        [
            { mode: "regenerate", target: "assistant-old" },
            { mode: "regenerate", target: "assistant-old" },
        ],
    );
    const continuation = apiCalls.find((call) => call[0] === "continue");
    assert.equal(continuation?.[3], "assistant-old");
    assert.equal((continuation?.[4] as { expectedRevision: number }).expectedRevision, 3);
    assert.deepEqual(
        runtimeInputs.map((input) => input.mode),
        ["regenerate", "continue", "regenerate"],
    );
    assert.equal(runtimeInputs[1].assistantMessage.id, "assistant-old");
    assert.deepEqual((current.messages.find((message) => message.id === "assistant-old") as { output: unknown[] }).output, [
        { type: "text", text: "原回答" },
        { type: "text", text: "-continue" },
    ]);
    await unmount(mounted);
});

test("持久化的 awaiting approval 可由注入 runtime 在原 Assistant 上恢复", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    const awaiting = {
        ...assistantMessage("assistant-awaiting", "conversation-1", "awaiting_approval", 4),
        output: [
            { type: "tool_call" as const, callId: "call-1", name: "save_memory", arguments: "{}" },
            { type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "awaiting_approval" as const, content: "请批准" },
        ],
    };
    listConversations = async () => ({ items: [conversation("conversation-1", awaiting.id)], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1", awaiting.id), items: [userMessage("user-1", "conversation-1"), awaiting], total: 2 });
    updateAssistant = async (_projectId, conversationId, id, input) => ({
        ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1),
        output: input.output,
    });
    const resumed = [awaiting.output[0], { type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "succeeded" as const, content: "已批准" }, { type: "text" as const, text: "已继续" }];
    const runtimeInputs: unknown[] = [];
    runTurn = async (input) => {
        runtimeInputs.push(input);
        return { ...completed, content: "已继续", output: resumed };
    };

    const mounted = await mount();
    await act(async () => current.resolveApproval("assistant-awaiting", "approved"));
    await flush();

    const claimed = { ...awaiting, status: "streaming" as const, revision: 5 };
    assert.deepEqual(runtimeInputs[0], {
        mode: "approval",
        decision: "approved",
        projectId: "project-1",
        conversation: conversation("conversation-1", awaiting.id),
        messages: [userMessage("user-1", "conversation-1"), claimed],
        assistantMessage: claimed,
    });
    const finalUpdate = apiCalls.filter((call) => call[0] === "update").at(-1);
    assert.equal(finalUpdate?.[3], "assistant-awaiting");
    assert.deepEqual(finalUpdate?.[4], { expectedRevision: 5, status: "completed", output: resumed });
    assert.deepEqual((current.messages.at(-1) as { output: unknown }).output, resumed);
    await unmount(mounted);
});

test("账号切换会中止本地 run 并忽略迟到的 runtime 结果", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation(accountId === "user-1" ? "conversation-1" : "conversation-2")], total: 1 });
    listMessages = async (_projectId, conversationId) => ({
        conversation: conversation(conversationId),
        items: conversationId === "conversation-2" ? [userMessage("account-2-message", conversationId)] : [],
        total: conversationId === "conversation-2" ? 1 : 0,
    });
    createTurn = async (_projectId, conversationId, input) => ({
        conversation: conversation(conversationId, input.assistantMessageId),
        userMessage: userMessage(input.userMessage!.id, conversationId),
        assistantMessage: assistantMessage(input.assistantMessageId, conversationId, "pending"),
    });
    updateAssistant = async (_projectId, conversationId, id, input) => ({
        ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1),
        output: input.output,
    });
    const late = deferred<BrainstormTurnResult>();
    let aborted = false;
    runTurn = async (_input, { signal }) => {
        signal.addEventListener("abort", () => {
            aborted = true;
        });
        return late.promise;
    };

    const mounted = await mount();
    await act(async () => void (await current.send("账号一运行")));
    accountId = "user-2";
    await act(async () => mounted.root.render(<Harness projectId="project-1" />));
    await flush();
    late.resolve(completed);
    await flush();

    assert.equal(aborted, true);
    assert.equal(apiCalls.filter((call) => call[0] === "update").length, 0);
    assert.equal(current.currentConversationId, "conversation-2");
    assert.deepEqual(
        (current.messages as Array<{ id: string }>).map((message) => message.id),
        ["account-2-message"],
    );
    await unmount(mounted);
});

test("分页加载完整 Conversation 和 Message，最新待审批消息可恢复", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    const conversationPages: number[] = [];
    const messagePages: number[] = [];
    const awaiting = assistantMessage("assistant-latest", "conversation-1", "awaiting_approval", 4);
    listConversations = async (_projectId, query) => {
        const page = query?.page || 1;
        conversationPages.push(page);
        return page === 1 ? { items: [conversation("conversation-1", awaiting.id)], total: 2 } : { items: [conversation("conversation-2")], total: 2 };
    };
    listMessages = async (_projectId, conversationId, query) => {
        const page = query?.page || 1;
        messagePages.push(page);
        return page === 1 ? { conversation: conversation(conversationId, awaiting.id), items: [userMessage("user-old", conversationId)], total: 2 } : { conversation: conversation(conversationId, awaiting.id), items: [awaiting], total: 2 };
    };

    const mounted = await mount();

    assert.deepEqual(conversationPages, [1, 2]);
    assert.deepEqual(messagePages, [1, 2]);
    assert.deepEqual(
        current.conversations.map((item) => item.id),
        ["conversation-1", "conversation-2"],
    );
    assert.deepEqual(
        current.awaitingApproval.map((item) => item.id),
        [awaiting.id],
    );
    await unmount(mounted);
});

test("Hook 管理 Conversation 创建、重命名和删除", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async (_projectId, conversationId) => ({ conversation: conversation(conversationId), items: [], total: 0 });
    createConversation = async (_projectId, input) => ({ ...conversation(input.id), title: input.title });
    renameConversation = async (_projectId, id, title) => ({ ...conversation(id), title });

    const mounted = await mount();
    let created!: BrainstormConversation;
    await act(async () => {
        created = await current.createConversation("角色方向");
    });
    assert.equal(current.currentConversationId, created.id);
    assert.equal(current.conversations.find((item) => item.id === created.id)?.title, "角色方向");

    await act(async () => void (await current.renameConversation(created.id, "人物冲突")));
    assert.equal(current.conversations.find((item) => item.id === created.id)?.title, "人物冲突");

    await act(async () => void (await current.deleteConversation(created.id)));
    assert.equal(current.currentConversationId, "conversation-1");
    assert.equal(
        current.conversations.some((item) => item.id === created.id),
        false,
    );
    assert.deepEqual(
        apiCalls.map((call) => call[0]),
        ["create-conversation", "rename-conversation", "delete-conversation"],
    );
    await unmount(mounted);
});

test("Runtime 异常会把服务端 Placeholder 持久化为 failed", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    runTurn = async () => {
        throw new Error("模型调用失败");
    };

    const mounted = await mount();
    await act(async () => void (await current.send("开始")));
    await flush();

    const failed = apiCalls.find((call) => call[0] === "update" && (call[4] as { status?: string }).status === "failed");
    assert.ok(failed);
    assert.equal(findAssistant(current.messages, current.runs["conversation-1"].assistantMessageId)?.status, "failed");
    await unmount(mounted);
});

test("Runtime resolved failed 会持久化部分输出并保留可读 Runner 错误", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    createTurn = async (_projectId, conversationId, input) => ({
        conversation: conversation(conversationId, input.assistantMessageId),
        userMessage: userMessage(input.userMessage!.id, conversationId),
        assistantMessage: assistantMessage(input.assistantMessageId, conversationId, "pending"),
    });
    updateAssistant = async (_projectId, conversationId, id, input) => ({
        ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1),
        output: input.output,
    });
    const partialOutput = [{ type: "text" as const, text: "已完成的部分" }];
    runTurn = async () => ({
        ...completed,
        status: "failed",
        content: "已完成的部分",
        output: partialOutput,
        error: { code: "TOOL_ROUND_LIMIT", message: "工具调用已达到 4 轮上限" },
    });

    const mounted = await mount();
    await act(async () => void (await current.send("继续分析")));
    await flush();

    const run = current.runs["conversation-1"];
    const failed = apiCalls.filter((call) => call[0] === "update").at(-1);
    assert.deepEqual(failed?.[4], { expectedRevision: 1, status: "failed", output: partialOutput });
    assert.equal(findAssistant(current.messages, run.assistantMessageId)?.status, "failed");
    assert.deepEqual(findAssistant(current.messages, run.assistantMessageId)?.output, partialOutput);
    assert.equal(run.error, "工具调用已达到 4 轮上限");
    await unmount(mounted);
});

test("Runtime resolved cancelled 不会显示为失败错误", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    createTurn = async (_projectId, conversationId, input) => ({
        conversation: conversation(conversationId, input.assistantMessageId),
        userMessage: userMessage(input.userMessage!.id, conversationId),
        assistantMessage: assistantMessage(input.assistantMessageId, conversationId, "pending"),
    });
    updateAssistant = async (_projectId, conversationId, id, input) => ({
        ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1),
        output: input.output,
    });
    runTurn = async () => ({
        ...completed,
        status: "cancelled",
        error: { code: "ABORTED", message: "Brainstorm turn was cancelled." },
    });

    const mounted = await mount();
    await act(async () => void (await current.send("开始")));
    await flush();

    assert.equal(current.runs["conversation-1"].status, "cancelled");
    assert.equal(current.runs["conversation-1"].error, "");
    await unmount(mounted);
});

test("awaiting approval Tool Result 与状态在同一次 checkpoint 持久化", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    const done = deferred<BrainstormTurnResult>();
    const call = { type: "tool_call" as const, callId: "call-1", name: "save_memory", arguments: "{}" };
    const awaiting = { type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "awaiting_approval" as const, content: "请批准" };
    runTurn = async (_input, { onEvent }) => {
        onEvent({ type: "status", status: "streaming" });
        onEvent({ type: "output_item", item: call });
        onEvent({ type: "output_item", item: awaiting });
        return done.promise;
    };

    const mounted = await mount();
    await act(async () => void (await current.send("保存设定")));
    await flush();

    const checkpoints = apiCalls.filter((item) => item[0] === "update");
    assert.deepEqual(checkpoints[1][4], { expectedRevision: 2, status: "awaiting_approval", output: [call, awaiting] });
    done.resolve({
        ...completed,
        status: "awaiting_approval",
        content: "",
        output: [call, awaiting],
        call,
        continuation: { context: { messages: [], tools: [], diagnostics: completed.diagnostics }, messages: [], output: [call, awaiting], pendingCalls: [call], toolRounds: 0 },
    });
    await flush();
    await unmount(mounted);
});

test("审批先用 Assistant revision CAS 占用，再执行 runtime", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    const awaiting = assistantMessage("assistant-awaiting", "conversation-1", "awaiting_approval", 4);
    listConversations = async () => ({ items: [conversation("conversation-1", awaiting.id)], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1", awaiting.id), items: [userMessage("user-1", "conversation-1"), awaiting], total: 2 });
    const claimed = deferred<ReturnType<typeof assistantMessage>>();
    updateAssistant = async (_projectId, conversationId, id, input) =>
        input.status === "streaming" && input.expectedRevision === 4 ? claimed.promise : { ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1), output: input.output };
    let runtimeCalls = 0;
    runTurn = async () => {
        runtimeCalls += 1;
        return completed;
    };

    const mounted = await mount();
    let resolving!: Promise<void>;
    await act(async () => {
        resolving = current.resolveApproval(awaiting.id, "approved");
        await Promise.resolve();
    });
    assert.equal(runtimeCalls, 0);
    assert.deepEqual(apiCalls.find((call) => call[0] === "update")?.[4], { expectedRevision: 4, status: "streaming", output: awaiting.output });

    claimed.resolve({ ...awaiting, status: "streaming", revision: 5 });
    await act(async () => resolving);
    await flush();
    assert.equal(runtimeCalls, 1);
    await unmount(mounted);
});

test("scope 切换发生在 checkpoint 等待期间时不会发送旧 scope 终态", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async (projectId) => ({ items: [{ ...conversation(projectId === "project-1" ? "conversation-1" : "conversation-2"), projectId }], total: 1 });
    listMessages = async (projectId, conversationId) => ({ conversation: { ...conversation(conversationId), projectId }, items: [], total: 0 });
    const checkpoint = deferred<ReturnType<typeof assistantMessage>>();
    updateAssistant = async (projectId, conversationId, id, input) => {
        if (projectId === "project-1" && input.status === "streaming") return checkpoint.promise;
        return { ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1), projectId, output: input.output };
    };
    const call = { type: "tool_call" as const, callId: "call-1", name: "read_scene", arguments: "{}" };
    runTurn = async (_input, { onEvent }) => {
        onEvent({ type: "status", status: "streaming" });
        onEvent({ type: "output_item", item: call });
        return { ...completed, output: [call] };
    };

    const mounted = await mount("project-1");
    await act(async () => void (await current.send("读取场次")));
    await flush();
    await act(async () => mounted.root.render(<Harness projectId="project-2" />));
    await flush();
    checkpoint.resolve({ ...assistantMessage("old-assistant", "conversation-1", "streaming", 2), output: [call] });
    await flush();

    assert.equal(
        apiCalls.some((item) => item[0] === "update" && item[1] === "project-1" && (item[4] as { status?: string }).status === "completed"),
        false,
    );
    await unmount(mounted);
});

test("Conversation 正在确认 Turn 时重新加载不会误标 interrupted", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({
        conversation: conversation("conversation-1", "assistant-pending"),
        items: [userMessage("user-pending", "conversation-1"), assistantMessage("assistant-pending", "conversation-1", "pending")],
        total: 2,
    });
    const confirmed = deferred<Awaited<ReturnType<typeof createTurn>>>();
    createTurn = async () => confirmed.promise;

    const mounted = await mount();
    let sending!: Promise<BrainstormAgentAssistantMessage>;
    await act(async () => {
        sending = current.send("开始");
        await Promise.resolve();
    });
    apiCalls.length = 0;
    await act(async () => void (await current.selectConversation("conversation-1")));
    assert.equal(
        apiCalls.some((item) => item[0] === "update" && (item[4] as { status?: string }).status === "interrupted"),
        false,
    );

    confirmed.resolve({
        conversation: conversation("conversation-1", "assistant-pending"),
        userMessage: userMessage("user-pending", "conversation-1"),
        assistantMessage: assistantMessage("assistant-pending", "conversation-1", "pending"),
    });
    await act(async () => void (await sending));
    await flush();
    await unmount(mounted);
});

test("已进入 streaming 的审批刷新后按不可附着规则标记 interrupted", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    const call = { type: "tool_call" as const, callId: "call-1", name: "save_memory", arguments: "{}" };
    const awaiting = { type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "awaiting_approval" as const, content: "请批准" };
    const stranded = { ...assistantMessage("assistant-stranded", "conversation-1", "streaming", 5), output: [call, awaiting] };
    listConversations = async () => ({ items: [conversation("conversation-1", stranded.id)], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1", stranded.id), items: [userMessage("user-1", "conversation-1"), stranded], total: 2 });

    const mounted = await mount();

    assert.deepEqual(apiCalls.find((item) => item[0] === "update")?.[4], { expectedRevision: 5, status: "interrupted", output: [call, awaiting] });
    assert.deepEqual(current.awaitingApproval, []);
    await unmount(mounted);
});

test("Runtime 异常会等待 checkpoint 并保留之后产生的部分文本", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    const checkpoint = deferred<ReturnType<typeof assistantMessage>>();
    const call = { type: "tool_call" as const, callId: "call-1", name: "read_scene", arguments: "{}" };
    updateAssistant = async (_projectId, conversationId, id, input) =>
        input.status === "streaming" && input.expectedRevision === 1 ? checkpoint.promise : { ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1), output: input.output };
    runTurn = async (_input, { onEvent }) => {
        onEvent({ type: "status", status: "streaming" });
        onEvent({ type: "output_item", item: call });
        onEvent({ type: "text_delta", delta: "部分回答" });
        throw new Error("上游中断");
    };

    const mounted = await mount();
    await act(async () => void (await current.send("继续")));
    await flush();
    assert.equal(apiCalls.filter((item) => item[0] === "update").length, 1);

    checkpoint.resolve({ ...assistantMessage(current.runs["conversation-1"].assistantMessageId, "conversation-1", "streaming", 2), output: [call] });
    await flush();

    const failed = apiCalls.find((item) => item[0] === "update" && (item[4] as { status?: string }).status === "failed");
    assert.deepEqual(failed?.[4], { expectedRevision: 2, status: "failed", output: [call, { type: "text", text: "部分回答" }] });
    await unmount(mounted);
});

test("审批续跑 checkpoint 会移除旧 awaiting result", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    const call = { type: "tool_call" as const, callId: "call-1", name: "save_memory", arguments: "{}" };
    const awaiting = { type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "awaiting_approval" as const, content: "请批准" };
    const succeeded = { type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "succeeded" as const, content: "已保存" };
    const assistant = { ...assistantMessage("assistant-awaiting", "conversation-1", "awaiting_approval", 4), output: [call, awaiting] };
    listConversations = async () => ({ items: [conversation("conversation-1", assistant.id)], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1", assistant.id), items: [userMessage("user-1", "conversation-1"), assistant], total: 2 });
    updateAssistant = async (_projectId, conversationId, id, input) => ({
        ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1),
        output: input.output,
    });
    const done = deferred<BrainstormTurnResult>();
    runTurn = async (_input, { onEvent }) => {
        onEvent({ type: "output_item", item: succeeded });
        return done.promise;
    };

    const mounted = await mount();
    await act(async () => void (await current.resolveApproval(assistant.id, "approved")));
    await flush();

    const checkpoint = apiCalls.filter((item) => item[0] === "update").at(-1);
    assert.deepEqual(checkpoint?.[4], { expectedRevision: 5, status: "streaming", output: [call, succeeded] });
    done.resolve({ ...completed, output: [call, succeeded] });
    await flush();
    await unmount(mounted);
});

test("同页审批把 Runner continuation 传回 runtime", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    updateAssistant = async (_projectId, conversationId, id, input) => ({
        ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1),
        output: input.output,
    });
    const call = { type: "tool_call" as const, callId: "call-1", name: "save_memory", arguments: "{}" };
    const awaiting = { type: "tool_result" as const, callId: "call-1", name: "save_memory", status: "awaiting_approval" as const, content: "请批准" };
    const continuation = {
        context: { messages: [], tools: [], diagnostics: completed.diagnostics },
        messages: [],
        output: [call, awaiting],
        pendingCalls: [call],
        toolRounds: 1,
    };
    const inputs: Array<Parameters<BrainstormAgentRuntime["run"]>[0]> = [];
    runTurn = async (input) => {
        inputs.push(input);
        return input.mode === "append" ? { ...completed, status: "awaiting_approval", output: [call, awaiting], call, continuation } : completed;
    };

    const mounted = await mount();
    await act(async () => void (await current.send("保存设定")));
    await flush();
    const assistantId = current.runs["conversation-1"].assistantMessageId;
    await act(async () => void (await current.resolveApproval(assistantId, "approved")));
    await flush();

    assert.equal(inputs[1].mode, "approval");
    assert.equal(inputs[1].continuation, continuation);
    await unmount(mounted);
});

test("Runtime 已失败后才请求 Stop 不会把失败改写为 cancelled", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1")], total: 1 });
    listMessages = async () => ({ conversation: conversation("conversation-1"), items: [], total: 0 });
    const checkpoint = deferred<ReturnType<typeof assistantMessage>>();
    const call = { type: "tool_call" as const, callId: "call-1", name: "read_scene", arguments: "{}" };
    updateAssistant = async (_projectId, conversationId, id, input) => (input.status === "streaming" ? checkpoint.promise : { ...assistantMessage(id, conversationId, input.status, input.expectedRevision + 1), output: input.output });
    runTurn = async (_input, { onEvent }) => {
        onEvent({ type: "status", status: "streaming" });
        onEvent({ type: "output_item", item: call });
        throw new Error("模型失败");
    };

    const mounted = await mount();
    await act(async () => void (await current.send("开始")));
    await flush();
    let stopping!: Promise<string>;
    await act(async () => {
        stopping = current.stop();
        await Promise.resolve();
    });
    checkpoint.resolve({ ...assistantMessage(current.runs["conversation-1"].assistantMessageId, "conversation-1", "streaming", 2), output: [call] });
    let outcome = "";
    await act(async () => {
        outcome = await stopping;
    });

    assert.equal(outcome, "failed");
    assert.equal(current.runs["conversation-1"].status, "failed");
    assert.equal(
        apiCalls.some((item) => item[0] === "update" && (item[4] as { status?: string }).status === "cancelled"),
        false,
    );
    await unmount(mounted);
});

test("连续选择 Conversation 时旧请求不能提前结束新请求的 loading", async () => {
    apiCalls.length = 0;
    accountId = "user-1";
    listConversations = async () => ({ items: [conversation("conversation-1"), conversation("conversation-2")], total: 2 });
    const older = deferred<Awaited<ReturnType<typeof listMessages>>>();
    const newer = deferred<Awaited<ReturnType<typeof listMessages>>>();
    let loads = 0;
    listMessages = async (_projectId, conversationId) => {
        loads += 1;
        if (loads === 1) return { conversation: conversation("conversation-1"), items: [], total: 0 };
        return conversationId === "conversation-2" ? older.promise : newer.promise;
    };

    const mounted = await mount();
    let olderSelection!: Promise<void>;
    let newerSelection!: Promise<void>;
    await act(async () => {
        olderSelection = current.selectConversation("conversation-2");
        await Promise.resolve();
        newerSelection = current.selectConversation("conversation-1");
        await Promise.resolve();
    });
    assert.equal(current.isLoading, true);

    older.resolve({ conversation: conversation("conversation-2"), items: [userMessage("older", "conversation-2")], total: 1 });
    await act(async () => olderSelection);
    assert.equal(current.isLoading, true);

    newer.resolve({ conversation: conversation("conversation-1"), items: [userMessage("newer", "conversation-1")], total: 1 });
    await act(async () => newerSelection);
    assert.equal(current.isLoading, false);
    assert.deepEqual(
        current.messages.map((message) => message.id),
        ["newer"],
    );
    await unmount(mounted);
});
