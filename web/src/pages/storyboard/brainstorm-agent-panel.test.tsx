import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { BrainstormAgentAssistantMessage, BrainstormAgentState, BrainstormAgentUserMessage, BrainstormConversation } from "./use-brainstorm-agent";
import type { StoryboardRecord } from "./storyboard";

const calls = {
    runtime: [] as unknown[],
    send: [] as string[],
    stop: 0,
    approvals: [] as Array<[string, string]>,
    retry: [] as string[],
    continue: [] as string[],
    create: 0,
};

const noop = async () => {};
const state: BrainstormAgentState = {
    conversations: [],
    currentConversationId: "",
    messages: [],
    messagesByConversation: {},
    awaitingApproval: [],
    runs: {},
    isLoading: false,
    error: "",
    selectConversation: noop,
    createConversation: async () => {
        calls.create += 1;
        return { id: "conversation-new", projectId: "project-1", title: "新对话", currentMessageId: "", createdAt: "", updatedAt: "" };
    },
    renameConversation: async () => ({ id: "conversation-1", projectId: "project-1", title: "新名称", currentMessageId: "", createdAt: "", updatedAt: "" }),
    deleteConversation: noop,
    send: async (content) => {
        calls.send.push(content);
        return {} as never;
    },
    regenerate: async () => ({}) as never,
    continueAssistant: async (id) => {
        calls.continue.push(id);
        return {} as never;
    },
    retry: async (id) => {
        calls.retry.push(id);
        return {} as never;
    },
    resolveApproval: async (id, decision) => {
        calls.approvals.push([id, decision]);
    },
    stop: async () => {
        calls.stop += 1;
        return "confirmed";
    },
};

let model = "text-model";
let configReady = true;
let currentState = state;
let openConfigCount = 0;

// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/stores/use-config-store", () => ({
    useEffectiveConfig: () => ({ model, textModel: model }),
    useConfigStore: (selector: (value: unknown) => unknown) => selector({ isAiConfigReady: () => configReady, openConfigDialog: () => (openConfigCount += 1) }),
}));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (value: unknown) => unknown) => selector({ user: { id: "user-1", username: "导演" } }) }));
mock.module("./brainstorm-agent-runtime", () => ({
    createBrainstormAgentRuntime: (options: unknown) => {
        calls.runtime.push(options);
        return { run: async () => ({}) };
    },
}));
mock.module("./use-brainstorm-agent", () => ({ useBrainstormAgent: () => currentState }));
mock.module("./brainstorm-agent-conversations", () => ({
    BrainstormAgentConversations: ({ onCreate }: { onCreate: () => void }) => (
        <div data-testid="conversations">
            对话列表<button onClick={onCreate}>侧栏新建</button>
        </div>
    ),
}));
mock.module("./brainstorm-memory-manager", () => ({
    BrainstormMemoryManager: ({ refreshKey }: { refreshKey?: number }) => <div data-testid="memory-manager">Memory {refreshKey || 0}</div>,
}));

const { App } = await import("antd");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BrainstormAgentPanel } = await import("./brainstorm-agent-panel");

async function mount(project: StoryboardRecord | null, onProjectUpdated = () => {}, disabled = false, onActiveChange = (_active: boolean) => {}) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentPanel project={project} onProjectUpdated={onProjectUpdated} onActiveChange={onActiveChange} disabled={disabled} />
            </App>,
        ),
    );
    return { container, root };
}

test("未选择分镜项目时显示明确空态", async () => {
    const { container, root } = await mount(null);
    assert.match(container.textContent || "", /请先选择分镜项目/);
    assert.equal(container.querySelector("textarea"), null);
    await act(async () => root.unmount());
    container.remove();
});

const conversation: BrainstormConversation = { id: "conversation-1", projectId: "project-1", title: "雨夜冲突", currentMessageId: "", createdAt: "", updatedAt: "" };
const project: StoryboardRecord = {
    id: "project-1",
    title: "雾港",
    source: "雨夜，林岚追进废弃码头。",
    options: { aspectRatio: "16:9", targetDurationSec: 60, style: "黑色电影", maxSegmentDurationSec: 15, maxShotDurationSec: 8, dialogueMustBeExact: true, allowMusic: true },
    model: "text-model",
    sourceHash: "sha256:project-1",
    status: "ready",
    revision: 4,
    directorPlan: { schemaVersion: "1.0", title: "雾港", sourceType: "script", scenes: [] },
    document: {
        schemaVersion: "1.0",
        title: "雾港",
        sourceType: "script",
        aspectRatio: "16:9",
        targetDurationSec: 60,
        scenes: [
            {
                id: "scene-stable",
                sceneNo: 1,
                sourceRefs: ["雨夜"],
                location: "废弃码头",
                time: "夜",
                characters: ["林岚"],
                emotion: "紧张",
                segments: [
                    {
                        id: "segment-stable",
                        segmentNo: 1,
                        durationSec: 6,
                        assetIds: [],
                        shots: [{ id: "shot-stable", shotNo: 1, visual: "林岚冲入雨幕", durationSec: 6, framing: "中景", camera: "跟拍", dialogue: "", sound: "雨声", sourceRefs: ["雨夜"] }],
                    },
                ],
            },
        ],
    },
    validation: { status: "passed", errors: [], warnings: [] },
    createdAt: 1,
    updatedAt: 2,
};

function reset(overrides: Partial<BrainstormAgentState> = {}) {
    calls.runtime.length = 0;
    calls.send.length = 0;
    calls.stop = 0;
    calls.approvals.length = 0;
    calls.retry.length = 0;
    calls.continue.length = 0;
    calls.create = 0;
    model = "text-model";
    configReady = true;
    openConfigCount = 0;
    const messages = overrides.messages || [];
    const activeConversation = { ...conversation, currentMessageId: messages.at(-1)?.id || "" };
    currentState = {
        ...state,
        conversations: [activeConversation],
        currentConversationId: activeConversation.id,
        messagesByConversation: { [activeConversation.id]: messages },
        ...overrides,
    };
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function click(element: Element) {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function button(name: string) {
    const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.replace(/\s/g, "") === name.replace(/\s/g, "") || item.getAttribute("aria-label") === name);
    assert.ok(match, `未找到按钮：${name}`);
    return match;
}

function setInput(element: HTMLTextAreaElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function selectOption(label: string, option: string) {
    const target = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    assert.ok(target, `未找到选择器：${label}`);
    await act(async () => click(target.closest(".ant-select") || target));
    await flush();
    const item = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((value) => value.textContent?.includes(option) && value.getAttribute("aria-selected") !== "true");
    assert.ok(item, `未找到选项：${option}`);
    await act(async () => click(item));
    await flush();
}

function userMessage(id: string, content: string, parentId = ""): BrainstormAgentUserMessage {
    return { id, projectId: project.id, conversationId: conversation.id, parentId, role: "user", content, output: [], revision: 1, createdAt: "", updatedAt: "" };
}

function assistantMessage(id: string, status: BrainstormAgentAssistantMessage["status"], output: BrainstormAgentAssistantMessage["output"], parentId = "user-1"): BrainstormAgentAssistantMessage {
    return { id, projectId: project.id, conversationId: conversation.id, parentId, role: "assistant", status, output, clientRequestId: `request-${id}`, revision: 1, createdAt: "", updatedAt: "" };
}

test("Skill 和稳定 ID Focus 会更新 Runtime 合同", async () => {
    reset();
    const { root, container } = await mount(project);
    const initial = calls.runtime.at(-1) as { skillId: string; focus: unknown };
    assert.equal(initial.skillId, "divergent_ideation");
    assert.deepEqual(initial.focus, { kind: "project" });

    await selectOption("脑暴技能", "视觉叙事");
    assert.equal((calls.runtime.at(-1) as { skillId: string }).skillId, "visual_storytelling");
    await selectOption("当前焦点", "镜头 1");
    assert.deepEqual((calls.runtime.at(-1) as { focus: unknown }).focus, { kind: "shot", sceneId: "scene-stable", segmentId: "segment-stable", shotId: "shot-stable" });

    await act(async () => root.unmount());
    container.remove();
});

test("Composer 支持 Cmd/Ctrl+Enter 发送，并可停止活动回复", async () => {
    reset();
    const mounted = await mount(project);
    const composer = mounted.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="脑暴消息"]');
    assert.ok(composer);
    await act(async () => setInput(composer, "  让冲突更强  "));
    await act(async () => composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true })));
    await flush();
    assert.deepEqual(calls.send, ["让冲突更强"]);

    currentState = {
        ...currentState,
        runs: {
            [conversation.id]: { assistantMessageId: "assistant-stream", status: "streaming", output: [], streamedText: "", retrying: false, active: true, stopState: "idle", error: "" },
        },
    };
    await act(async () =>
        mounted.root.render(
            <App>
                <BrainstormAgentPanel project={project} />
            </App>,
        ),
    );
    await act(async () => click(button("停止")));
    await flush();
    assert.equal(calls.stop, 1);

    await act(async () => mounted.root.unmount());
    mounted.container.remove();
});

test("消息区显示 Tool 影响范围，并明确批准或拒绝", async () => {
    const pending = assistantMessage("assistant-approval", "awaiting_approval", [
        { type: "text", text: "建议缩短这个镜头。" },
        {
            type: "tool_call",
            callId: "call-1",
            name: "storyboard_apply_patch",
            arguments: JSON.stringify({ projectId: project.id, expectedRevision: 4, operations: [{ target: "shot", sceneId: "scene-stable", segmentId: "segment-stable", shotId: "shot-stable", field: "durationSec", value: 4 }] }),
        },
        { type: "tool_result", callId: "call-1", name: "storyboard_apply_patch", status: "awaiting_approval", content: "等待用户批准", sideEffect: "write" },
    ]);
    reset({ messages: [userMessage("user-1", "压缩节奏"), pending], awaitingApproval: [pending] });
    const mounted = await mount(project);

    assert.match(mounted.container.textContent || "", /建议缩短这个镜头/);
    assert.match(mounted.container.textContent || "", /镜头 shot-stable · durationSec/);
    assert.match(mounted.container.textContent || "", /片段 segment-stable · durationSec/);
    assert.match(mounted.container.textContent || "", /等待批准/);
    await act(async () => click(button("批准")));
    await flush();
    await act(async () => click(button("拒绝")));
    await flush();
    assert.deepEqual(calls.approvals, [
        [pending.id, "approved"],
        [pending.id, "rejected"],
    ]);

    await act(async () => mounted.root.unmount());
    mounted.container.remove();
});

test("活动 Assistant 将已确认 output 与流式 delta 连续显示", async () => {
    const streaming = assistantMessage("assistant-stream", "streaming", []);
    reset({
        messages: [userMessage("user-1", "给我一个版本"), streaming],
        runs: {
            [conversation.id]: { assistantMessageId: streaming.id, status: "streaming", output: [{ type: "text", text: "先让角色" }], streamedText: "失去退路", retrying: false, active: true, stopState: "idle", error: "" },
        },
    });
    const { container, root } = await mount(project);
    assert.match(container.textContent || "", /先让角色/);
    assert.match(container.textContent || "", /失去退路/);
    assert.match(container.textContent || "", /生成中/);
    await act(async () => root.unmount());
    container.remove();
});

test("终态显示完成、失败、已取消和已中断，并提供重新生成与继续", async () => {
    const messages = [
        assistantMessage("assistant-completed", "completed", [{ type: "text", text: "完成文本" }]),
        assistantMessage("assistant-failed", "failed", [{ type: "text", text: "失败前文本" }]),
        assistantMessage("assistant-cancelled", "cancelled", [{ type: "text", text: "取消前文本" }]),
        assistantMessage("assistant-interrupted", "interrupted", [{ type: "text", text: "中断前文本" }]),
    ];
    reset({ messages, conversations: [{ ...conversation, currentMessageId: "assistant-interrupted" }] });
    const mounted = await mount(project);
    assert.match(mounted.container.textContent || "", /已中断/);

    currentState = { ...currentState, conversations: [{ ...conversation, currentMessageId: "assistant-completed" }] };
    await act(async () =>
        mounted.root.render(
            <App>
                <BrainstormAgentPanel project={project} />
            </App>,
        ),
    );
    assert.match(mounted.container.textContent || "", /已完成/);
    await act(async () => click(button("继续")));

    currentState = { ...currentState, conversations: [{ ...conversation, currentMessageId: "assistant-failed" }] };
    await act(async () =>
        mounted.root.render(
            <App>
                <BrainstormAgentPanel project={project} />
            </App>,
        ),
    );
    assert.match(mounted.container.textContent || "", /失败/);
    await act(async () => click(button("重新生成")));
    await flush();
    assert.deepEqual(calls.continue, ["assistant-completed"]);
    assert.deepEqual(calls.retry, ["assistant-failed"]);

    currentState = { ...currentState, conversations: [{ ...conversation, currentMessageId: "assistant-cancelled" }] };
    await act(async () =>
        mounted.root.render(
            <App>
                <BrainstormAgentPanel project={project} />
            </App>,
        ),
    );
    assert.match(mounted.container.textContent || "", /已取消/);

    await act(async () => mounted.root.unmount());
    mounted.container.remove();
});

test("Memory 标签集成刷新，Project 写入通知 Studio", async () => {
    reset();
    let updated = 0;
    const mounted = await mount(project, () => (updated += 1));
    const runtime = calls.runtime.at(-1) as { onProjectChanged?: () => void; onMemoryChanged?: () => void };
    assert.ok(runtime);
    await act(async () => runtime.onProjectChanged?.());
    await act(async () => runtime.onMemoryChanged?.());
    assert.equal(updated, 1);

    await act(async () => click(button("Memory")));
    await flush();
    assert.equal(mounted.container.querySelector('[data-testid="memory-manager"]')?.textContent, "Memory 1");

    await act(async () => mounted.root.unmount());
    mounted.container.remove();
});

test("无模型、加载、错误和空对话都有可操作状态", async () => {
    reset();
    model = "";
    configReady = false;
    let mounted = await mount(project);
    assert.match(mounted.container.textContent || "", /请先配置文本模型/);
    await act(async () => click(button("打开模型配置")));
    assert.equal(openConfigCount, 1);
    await act(async () => mounted.root.unmount());
    mounted.container.remove();

    reset({ isLoading: true });
    mounted = await mount(project);
    assert.match(mounted.container.textContent || "", /正在加载脑暴对话/);
    await act(async () => mounted.root.unmount());
    mounted.container.remove();

    reset({ error: "服务暂时不可用" });
    mounted = await mount(project);
    assert.match(mounted.container.textContent || "", /服务暂时不可用/);
    await act(async () => mounted.root.unmount());
    mounted.container.remove();

    reset({ conversations: [], currentConversationId: "" });
    mounted = await mount(project);
    assert.match(mounted.container.textContent || "", /还没有脑暴对话/);
    await act(async () => click(button("新建对话")));
    await flush();
    assert.equal(calls.create, 1);
    await act(async () => mounted.root.unmount());
    mounted.container.remove();
});

test("Conversation 侧栏通过折叠入口打开", async () => {
    reset();
    const mounted = await mount(project);
    assert.equal(document.body.querySelector('[data-testid="conversations"]'), null);
    await act(async () => click(button("对话")));
    await flush();
    assert.match(document.body.querySelector('[data-testid="conversations"]')?.textContent || "", /对话列表/);
    await act(async () => mounted.root.unmount());
    mounted.container.remove();
});

test("只展示 currentMessageId 沿 parentId 回溯的当前分支", async () => {
    const oldSibling = assistantMessage("assistant-old", "completed", [{ type: "text", text: "旧分支不应显示" }]);
    const newSibling = assistantMessage("assistant-new", "completed", [{ type: "text", text: "当前分支回答" }]);
    const followUser = userMessage("user-follow", "继续追问", newSibling.id);
    const followAssistant = assistantMessage("assistant-follow", "completed", [{ type: "text", text: "当前分支结论" }], followUser.id);
    const messages = [userMessage("user-1", "根问题"), oldSibling, newSibling, followUser, followAssistant];
    reset({ messages, conversations: [{ ...conversation, currentMessageId: followAssistant.id }] });

    const { container, root } = await mount(project);
    assert.match(container.textContent || "", /当前分支回答/);
    assert.match(container.textContent || "", /继续追问/);
    assert.match(container.textContent || "", /当前分支结论/);
    assert.doesNotMatch(container.textContent || "", /旧分支不应显示/);
    await act(async () => root.unmount());
    container.remove();
});

test("当前 Conversation 的 run error 优先且不显示其他 Conversation 的共享错误", async () => {
    reset({
        error: "其他对话失败",
        runs: {
            "conversation-other": { assistantMessageId: "assistant-other", status: "failed", output: [], streamedText: "", retrying: false, active: false, stopState: "idle", error: "其他对话失败" },
        },
    });
    const mounted = await mount(project);
    assert.doesNotMatch(mounted.container.textContent || "", /其他对话失败/);

    currentState = {
        ...currentState,
        runs: {
            ...currentState.runs,
            [conversation.id]: { assistantMessageId: "assistant-current", status: "failed", output: [], streamedText: "", retrying: false, active: false, stopState: "idle", error: "当前对话失败" },
        },
    };
    await act(async () =>
        mounted.root.render(
            <App>
                <BrainstormAgentPanel project={project} />
            </App>,
        ),
    );
    assert.match(mounted.container.textContent || "", /当前对话失败/);
    assert.doesNotMatch(mounted.container.textContent || "", /其他对话失败/);
    await act(async () => mounted.root.unmount());
    mounted.container.remove();
});

test("pending storyboard_remember 明确标注 Memory Candidate，并显示已保存 revision", async () => {
    const pending = assistantMessage("assistant-memory", "awaiting_approval", [
        { type: "tool_call", callId: "call-memory", name: "storyboard_remember", arguments: JSON.stringify({ projectId: project.id, kind: "constraint", scope: "scene", path: "scene-stable", content: "码头始终处于暴雨中", tags: ["天气"] }) },
        { type: "tool_result", callId: "call-memory", name: "storyboard_remember", status: "awaiting_approval", content: "等待保存", sideEffect: "write" },
    ]);
    reset({ messages: [userMessage("user-1", "记住天气"), pending], awaitingApproval: [pending] });
    const { container, root } = await mount(project);
    assert.match(container.textContent || "", /Memory Candidate/);
    assert.match(container.textContent || "", /码头始终处于暴雨中/);
    assert.match(container.textContent || "", /基于已保存 revision 4/);
    await act(async () => root.unmount());
    container.remove();
});

test("分镜生成期间禁用 Agent 输入与上下文切换", async () => {
    reset();
    const { container, root } = await mount(project, () => {}, true);

    assert.equal(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="脑暴消息"]')?.disabled, true);
    for (const select of container.querySelectorAll<HTMLElement>(".ant-select")) assert.match(select.className, /ant-select-disabled/);

    await act(async () => root.unmount());
    container.remove();
});

test("分镜生成开始后仍可停止已经活动的 Brainstorm Turn", async () => {
    const streaming = assistantMessage("assistant-disabled-stop", "streaming", []);
    reset({
        messages: [userMessage("user-1", "先开始脑暴"), streaming],
        runs: {
            [conversation.id]: { assistantMessageId: streaming.id, status: "streaming", output: [], streamedText: "正在生成", retrying: false, active: true, stopState: "idle", error: "" },
        },
    });
    const { root } = await mount(project, () => {}, true);

    await act(async () => click(button("停止")));
    assert.equal(calls.stop, 1);

    await act(async () => root.unmount());
    document.body.innerHTML = "";
});

test("向 Studio 上报任意 Conversation 的活动状态并在卸载时清理", async () => {
    reset({
        runs: {
            "conversation-other": { assistantMessageId: "assistant-other", status: "streaming", output: [], streamedText: "", retrying: false, active: true, stopState: "idle", error: "" },
        },
    });
    const states: boolean[] = [];
    const { root } = await mount(
        project,
        () => {},
        false,
        (active) => states.push(active),
    );
    assert.equal(states.at(-1), true);

    await act(async () => root.unmount());
    assert.equal(states.at(-1), false);
    document.body.innerHTML = "";
});
