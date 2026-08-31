import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";
import type { BrainstormConversation } from "./use-brainstorm-agent";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { App } = await import("antd");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BrainstormAgentConversations } = await import("./brainstorm-agent-conversations");

const conversations: BrainstormConversation[] = [
    {
        id: "conversation-a",
        projectId: "project-1",
        title: "人物设定",
        currentMessageId: "message-a",
        createdAt: "2026-08-30T07:00:00.000Z",
        updatedAt: "2026-08-30T08:00:00.000Z",
    },
    {
        id: "conversation-b",
        projectId: "project-1",
        title: "第一幕冲突",
        currentMessageId: "message-b",
        createdAt: "2026-08-30T09:00:00.000Z",
        updatedAt: "2026-08-30T10:00:00.000Z",
    },
];

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

async function flush() {
    await act(async () => {
        await Promise.resolve();
    });
}

test("显示历史对话、标记当前会话并支持新建", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let createCount = 0;

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations
                    conversations={conversations}
                    currentConversationId="conversation-a"
                    onCreate={() => {
                        createCount += 1;
                    }}
                    onSelect={() => {}}
                    onRename={() => {}}
                    onDelete={() => {}}
                />
            </App>,
        ),
    );

    assert.equal(button(container, "人物设定").getAttribute("aria-pressed"), "true");
    assert.equal(button(container, "第一幕冲突").getAttribute("aria-pressed"), "false");
    await act(async () => click(button(container, "新建对话")));
    await flush();
    assert.equal(createCount, 1);

    await act(async () => root.unmount());
    container.remove();
});

test("切换会话会提交所选会话 ID", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const selected: string[] = [];

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations conversations={conversations} currentConversationId="conversation-a" onCreate={() => {}} onSelect={(id) => selected.push(id)} onRename={() => {}} onDelete={() => {}} />
            </App>,
        ),
    );

    await act(async () => click(button(container, "第一幕冲突")));
    await flush();
    assert.deepEqual(selected, ["conversation-b"]);

    await act(async () => root.unmount());
    container.remove();
});

function input(element: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

test("可以内联重命名对话", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const renamed: Array<[string, string]> = [];

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations conversations={conversations} currentConversationId="conversation-a" onCreate={() => {}} onSelect={() => {}} onRename={(id, title) => renamed.push([id, title])} onDelete={() => {}} />
            </App>,
        ),
    );

    await act(async () => click(button(container, "重命名人物设定")));
    const editor = container.querySelector<HTMLInputElement>('input[aria-label="会话名称"]');
    assert.ok(editor);
    assert.equal(editor.value, "人物设定");
    await act(async () => input(editor, "  人物小传  "));
    await act(async () => click(button(container, "保存名称")));
    await flush();

    assert.deepEqual(renamed, [["conversation-a", "人物小传"]]);
    assert.equal(container.querySelector('input[aria-label="会话名称"]'), null);

    await act(async () => root.unmount());
    container.remove();
});

test("删除对话需要二次确认", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const deleted: string[] = [];

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations conversations={conversations} currentConversationId="conversation-a" onCreate={() => {}} onSelect={() => {}} onRename={() => {}} onDelete={(id) => deleted.push(id)} />
            </App>,
        ),
    );

    await act(async () => click(button(container, "删除人物设定")));
    assert.match(document.body.textContent || "", /删除后将无法恢复/);
    assert.deepEqual(deleted, []);
    await act(async () => click(button(document.body, "确认删除")));
    await flush();
    assert.deepEqual(deleted, ["conversation-a"]);

    await act(async () => root.unmount());
    container.remove();
});

test("没有历史对话时显示空态", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations conversations={[]} currentConversationId="" onCreate={() => {}} onSelect={() => {}} onRename={() => {}} onDelete={() => {}} />
            </App>,
        ),
    );

    assert.match(container.textContent || "", /暂无对话/);

    await act(async () => root.unmount());
    container.remove();
});

test("加载中显示提示并禁用新建", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations conversations={conversations} currentConversationId="conversation-a" loading onCreate={() => {}} onSelect={() => {}} onRename={() => {}} onDelete={() => {}} />
            </App>,
        ),
    );

    assert.match(container.textContent || "", /正在加载对话/);
    assert.equal((button(container, "新建对话") as HTMLButtonElement).disabled, true);

    await act(async () => root.unmount());
    container.remove();
});

test("disabled 会阻止所有会话操作", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let calls = 0;

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations
                    conversations={conversations}
                    currentConversationId="conversation-a"
                    disabled
                    onCreate={() => {
                        calls += 1;
                    }}
                    onSelect={() => {
                        calls += 1;
                    }}
                    onRename={() => {
                        calls += 1;
                    }}
                    onDelete={() => {
                        calls += 1;
                    }}
                />
            </App>,
        ),
    );

    for (const name of ["新建对话", "人物设定", "重命名人物设定", "删除人物设定"]) {
        const action = button(container, name) as HTMLButtonElement;
        assert.equal(action.disabled, true, `${name} 应禁用`);
        await act(async () => click(action));
    }
    await flush();
    assert.equal(calls, 0);

    await act(async () => root.unmount());
    container.remove();
});

test("异步操作期间不会重复提交", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let createCount = 0;
    let finish!: () => void;

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations
                    conversations={conversations}
                    currentConversationId="conversation-a"
                    onCreate={() => {
                        createCount += 1;
                        return new Promise<void>((resolve) => {
                            finish = resolve;
                        });
                    }}
                    onSelect={() => {}}
                    onRename={() => {}}
                    onDelete={() => {}}
                />
            </App>,
        ),
    );

    const create = button(container, "新建对话") as HTMLButtonElement;
    await act(async () => {
        click(create);
        click(create);
        await Promise.resolve();
    });
    assert.equal(createCount, 1);
    assert.equal(create.disabled, true);

    finish();
    await flush();
    assert.equal((button(container, "新建对话") as HTMLButtonElement).disabled, false);

    await act(async () => root.unmount());
    container.remove();
});

test("操作失败时显示中文错误提示", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations conversations={conversations} currentConversationId="conversation-a" onCreate={() => Promise.reject(new Error("failed"))} onSelect={() => {}} onRename={() => {}} onDelete={() => {}} />
            </App>,
        ),
    );

    await act(async () => click(button(container, "新建对话")));
    await flush();
    assert.match(document.body.textContent || "", /新建对话失败/);

    await act(async () => root.unmount());
    container.remove();
});

test("运行中的会话仍允许切换，但不能被重命名或删除", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const selected: string[] = [];

    await act(async () =>
        root.render(
            <App>
                <BrainstormAgentConversations
                    conversations={conversations}
                    currentConversationId="conversation-a"
                    runningConversationIds={["conversation-a"]}
                    onCreate={() => {}}
                    onSelect={(id) => selected.push(id)}
                    onRename={() => {}}
                    onDelete={() => {}}
                />
            </App>,
        ),
    );

    assert.equal((button(container, "第一幕冲突") as HTMLButtonElement).disabled, false);
    assert.equal((button(container, "重命名人物设定") as HTMLButtonElement).disabled, true);
    assert.equal((button(container, "删除人物设定") as HTMLButtonElement).disabled, true);
    await act(async () => click(button(container, "第一幕冲突")));
    await flush();
    assert.deepEqual(selected, ["conversation-b"]);

    await act(async () => root.unmount());
    container.remove();
});
