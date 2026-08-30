import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";
import type { ScriptAgentWorkspaceRecord } from "./script-agent-storage";

if (typeof window === "undefined") GlobalRegistrator.register();

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { App } = await import("antd");
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ScriptAgentWorkspacePanel } = await import("./script-agent-workspace-panel");

const initialWorkspace: ScriptAgentWorkspaceRecord = {
    id: "workspace-1",
    projectId: "project-1",
    title: "雾城追凶",
    source: "原作素材",
    currentStage: "awaiting_story_skeleton_decision",
    projectConfig: null,
    configDraft: {},
    storySkeleton: "旧故事骨架",
    storySkeletonStatus: "awaiting_user_decision",
    storySkeletonReview: undefined,
    adaptationStrategy: "旧改编策略",
    adaptationStatus: "approved",
    adaptationReview: undefined,
    scripts: [],
    messages: [],
    version: 1,
    updatedAt: "2026-08-29T00:00:00.000Z",
};

function click(element: Element) {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function input(element: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
}

test("用户可以编辑故事骨架并保存到工作区", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let saved: ScriptAgentWorkspaceRecord = initialWorkspace;

    function Harness() {
        const [workspace, setWorkspace] = useState<ScriptAgentWorkspaceRecord>(initialWorkspace);
        return (
            <App>
                <ScriptAgentWorkspacePanel
                    workspace={workspace}
                    running={false}
                    onChange={async (next) => {
                        saved = next;
                        setWorkspace(next);
                    }}
                    onAction={() => {}}
                    onCopyScript={() => {}}
                />
            </App>
        );
    }

    await act(async () => root.render(<Harness />));
    const edit = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "编辑");
    assert.ok(edit);

    await act(async () => click(edit));
    const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="故事骨架内容"]');
    assert.ok(editor);

    await act(async () => input(editor, "新故事骨架"));
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "保存");
    assert.ok(save);
    await act(async () => click(save));

    assert.equal(saved.storySkeleton, "新故事骨架");
    assert.match(container.textContent || "", /新故事骨架/);

    await act(async () => root.unmount());
    container.remove();
});

test("取消新建剧本不会写入工作区", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let saved: ScriptAgentWorkspaceRecord = initialWorkspace;

    function Harness() {
        const [workspace, setWorkspace] = useState<ScriptAgentWorkspaceRecord>(initialWorkspace);
        return (
            <App>
                <ScriptAgentWorkspacePanel
                    workspace={workspace}
                    running={false}
                    onChange={async (next) => {
                        saved = next;
                        setWorkspace(next);
                    }}
                    onAction={() => {}}
                    onCopyScript={() => {}}
                />
            </App>
        );
    }

    await act(async () => root.render(<Harness />));
    const scriptsTab = [...container.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent?.trim() === "剧本");
    assert.ok(scriptsTab);
    await act(async () => click(scriptsTab));

    const create = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "新建剧本");
    assert.ok(create);
    await act(async () => click(create));
    assert.ok(container.querySelector('textarea[aria-label="剧本正文"]'));

    const cancel = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "取消");
    assert.ok(cancel);
    await act(async () => click(cancel));

    assert.equal(saved.scripts.length, 0);
    await act(async () => root.unmount());
    container.remove();
});
