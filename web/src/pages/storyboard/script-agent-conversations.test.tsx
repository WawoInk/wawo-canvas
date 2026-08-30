import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";
import type { ScriptAgentWorkspaceRecord } from "./script-agent-storage";

if (typeof window === "undefined") GlobalRegistrator.register();

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { App } = await import("antd");
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ScriptAgentConversations } = await import("./script-agent-conversations");

const initialWorkspace: ScriptAgentWorkspaceRecord = {
    id: "project-1",
    projectId: "project-1",
    title: "雾城追凶",
    source: "原作素材",
    currentStage: "collecting_config",
    projectConfig: null,
    configDraft: {},
    storySkeleton: "",
    storySkeletonStatus: "empty",
    adaptationStrategy: "",
    adaptationStatus: "empty",
    scripts: [],
    messages: [{ id: "message-a", role: "user", content: "梳理人物关系", createdAt: "2026-08-29T00:00:00.000Z" }],
    conversations: [
        {
            id: "conversation-a",
            title: "人物设定",
            messages: [{ id: "message-a", role: "user", content: "梳理人物关系", createdAt: "2026-08-29T00:00:00.000Z" }],
            createdAt: "2026-08-29T00:00:00.000Z",
            updatedAt: "2026-08-29T00:00:00.000Z",
        },
        {
            id: "conversation-b",
            title: "第一幕修改",
            messages: [{ id: "message-b", role: "assistant", content: "保留开场冲突", createdAt: "2026-08-29T01:00:00.000Z" }],
            createdAt: "2026-08-29T01:00:00.000Z",
            updatedAt: "2026-08-29T01:00:00.000Z",
        },
    ],
    activeConversationId: "conversation-a",
    version: 1,
    updatedAt: "2026-08-29T01:00:00.000Z",
};

function click(element: Element) {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function button(container: ParentNode, name: string) {
    const match = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === name || item.getAttribute("aria-label") === name);
    assert.ok(match, `未找到按钮：${name}`);
    return match;
}

function input(element: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

function cloneWorkspace() {
    return structuredClone(initialWorkspace);
}

test("新建对话会创建独立会话并切换为当前会话", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let saved = cloneWorkspace();

    function Harness() {
        const [workspace, setWorkspace] = useState(saved);
        return (
            <App>
                <ScriptAgentConversations
                    workspace={workspace}
                    onChange={(next) => {
                        saved = next;
                        setWorkspace(next);
                    }}
                />
            </App>
        );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => click(button(container, "新建对话")));

    assert.equal(saved.conversations.length, 3);
    assert.notEqual(saved.activeConversationId, "conversation-a");
    assert.equal(saved.conversations.at(-1)?.title, "新对话");
    assert.deepEqual(saved.messages, []);

    await act(async () => root.unmount());
    container.remove();
});

test("切换历史对话会恢复该会话消息", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let saved = cloneWorkspace();

    function Harness() {
        const [workspace, setWorkspace] = useState(saved);
        return (
            <App>
                <ScriptAgentConversations
                    workspace={workspace}
                    onChange={(next) => {
                        saved = next;
                        setWorkspace(next);
                    }}
                />
            </App>
        );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => click(button(container, "第一幕修改")));

    assert.equal(saved.activeConversationId, "conversation-b");
    assert.deepEqual(saved.messages, saved.conversations[1].messages);
    assert.equal(saved.messages[0]?.content, "保留开场冲突");

    await act(async () => root.unmount());
    container.remove();
});

test("清空当前对话需要确认且不会影响其他会话", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let saved = cloneWorkspace();
    const otherMessages = structuredClone(saved.conversations[1].messages);

    function Harness() {
        const [workspace, setWorkspace] = useState(saved);
        return (
            <App>
                <ScriptAgentConversations
                    workspace={workspace}
                    onChange={(next) => {
                        saved = next;
                        setWorkspace(next);
                    }}
                />
            </App>
        );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => click(button(container, "清空对话记录")));

    assert.equal(saved.messages.length, 1);
    assert.match(document.body.textContent || "", /清空后将无法恢复/);

    await act(async () => click(button(document.body, "确认清空")));

    assert.deepEqual(saved.messages, []);
    assert.deepEqual(saved.conversations[0].messages, []);
    assert.deepEqual(saved.conversations[1].messages, otherMessages);
    assert.equal(saved.conversations.length, 2);

    await act(async () => root.unmount());
    container.remove();
});

test("可以重命名历史对话", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let saved = cloneWorkspace();

    function Harness() {
        const [workspace, setWorkspace] = useState(saved);
        return (
            <App>
                <ScriptAgentConversations
                    workspace={workspace}
                    onChange={(next) => {
                        saved = next;
                        setWorkspace(next);
                    }}
                />
            </App>
        );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => click(button(container, "重命名人物设定")));

    const editor = container.querySelector<HTMLInputElement>('input[aria-label="会话名称"]');
    assert.ok(editor);
    await act(async () => input(editor, "人物小传"));
    await act(async () => click(button(container, "保存名称")));

    assert.equal(saved.conversations[0].title, "人物小传");
    assert.equal(saved.activeConversationId, "conversation-a");
    assert.deepEqual(saved.messages, saved.conversations[0].messages);

    await act(async () => root.unmount());
    container.remove();
});
