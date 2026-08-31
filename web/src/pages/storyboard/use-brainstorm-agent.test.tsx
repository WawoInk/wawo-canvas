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
    createStoryboardBrainstormTurn: (...args: Parameters<typeof createTurn>) => createTurn(...args),
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
