import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const conversation = { id: "conversation-1", title: "人物设定", messages: [{ id: "message-1", role: "user", content: "只属于当前会话", createdAt: "2026-08-30T00:00:00.000Z" }], createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" };
const workspace = {
    id: "project-1",
    projectId: "project-1",
    title: "雾城追凶",
    source: "素材",
    currentStage: "collecting_config",
    projectConfig: null,
    configDraft: {},
    storySkeleton: "",
    storySkeletonStatus: "empty",
    adaptationStrategy: "",
    adaptationStatus: "empty",
    scripts: [],
    messages: conversation.messages,
    conversations: [conversation],
    activeConversationId: conversation.id,
    version: 0,
    revision: 4,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
};
const changed = {
    ...workspace,
    messages: [{ id: "message-2", role: "user", content: "未保存消息", createdAt: "2026-08-30T00:01:00.000Z" }],
    conversations: [{ ...conversation, messages: [{ id: "message-2", role: "user", content: "未保存消息", createdAt: "2026-08-30T00:01:00.000Z" }] }],
    version: 1,
};

let loadedProjectId = "";
let savedRevision = 0;
let saveMode: "success" | "failure" | "conflict" = "success";
const { mock } = await import("bun:test");
mock.module("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key }) }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: unknown) => unknown) => selector({ user: { id: "user-1" } }) }));
mock.module("@/stores/use-config-store", () => ({
    useEffectiveConfig: () => ({ textModel: "text-model", model: "text-model" }),
    useConfigStore: (selector: (state: unknown) => unknown) => selector({ updateConfig: () => {}, isAiConfigReady: () => true, openConfigDialog: () => {} }),
}));
mock.module("@/components/model-picker", () => ({ ModelPicker: () => <div /> }));
mock.module("@/services/api/script-agent", () => ({ sendScriptAgentTurn: async () => workspace, submitScriptAgentAction: async () => workspace }));
mock.module("./script-agent-storage", () => ({
    loadScriptAgentWorkspace: async (projectId: string) => {
        loadedProjectId = projectId;
        return structuredClone(workspace);
    },
    saveScriptAgentWorkspace: async (value: typeof workspace) => {
        savedRevision = value.revision;
        if (saveMode === "failure") throw new Error("network failed");
        if (saveMode === "conflict") throw Object.assign(new Error("revision conflict"), { status: 409, data: { current: { ...workspace, title: "服务端最新版本", revision: 8 } } });
        return { ...value, revision: value.revision + 1 };
    },
    appendScriptAgentMessage: (value: typeof workspace) => value,
    scriptAgentConflictWorkspace: (error: { data?: { current?: typeof workspace } }) => error.data?.current || null,
}));
mock.module("./script-agent-workspace-panel", () => ({ ScriptAgentWorkspacePanel: () => <div data-testid="workspace-panel" /> }));
mock.module("./script-agent-conversations", () => ({ ScriptAgentConversations: ({ onChange }: { onChange: (workspace: typeof changed) => void }) => <button data-testid="history" onClick={() => void onChange(changed)}>历史记录</button> }));

const { App } = await import("antd");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ScriptAgentStudio } = await import("./script-agent-studio");

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

async function mount(onWorkspaceChange: (value: typeof workspace) => void = () => {}) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<App><ScriptAgentStudio projectId="project-1" onBack={() => {}} onWorkspaceChange={onWorkspaceChange} /></App>));
    await act(flush);
    return { container, root };
}

test("具体剧本工作区按项目加载并在服务端保存成功后更新", async () => {
    saveMode = "success";
    const saved: typeof workspace[] = [];
    const { container, root } = await mount((value) => saved.push(value));

    assert.equal(loadedProjectId, "project-1");
    assert.match(container.textContent || "", /只属于当前会话/);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="history"]')?.click());
    await act(flush);
    assert.equal(savedRevision, 4);
    assert.equal(saved[0].revision, 5);
    assert.match(container.textContent || "", /未保存消息/);

    await act(async () => root.unmount());
    container.remove();
});

test("修订冲突会恢复已持久化工作区且不通知列表保存成功", async () => {
    saveMode = "conflict";
    const saved: typeof workspace[] = [];
    const { container, root } = await mount((value) => saved.push(value));

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="history"]')?.click());
    await act(flush);
    assert.equal(saved.length, 0);
    assert.match(container.textContent || "", /版本冲突/);
    assert.match(container.textContent || "", /服务端最新版本/);
    assert.match(container.textContent || "", /只属于当前会话/);
    assert.doesNotMatch(container.textContent || "", /未保存消息/);

    await act(async () => root.unmount());
    container.remove();
});
