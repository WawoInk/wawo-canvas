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
    updatedAt: "2026-08-30T00:00:00.000Z",
};

let loadedProjectId = "";
let savedProjectId = "";
// @ts-expect-error Bun provides module mocking at test runtime.
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
    loadScriptAgentWorkspace: async (_userId: string, projectId: string) => {
        loadedProjectId = projectId;
        return workspace;
    },
    saveScriptAgentWorkspace: async (_userId: string, value: typeof workspace) => {
        savedProjectId = value.projectId;
        return value;
    },
    appendScriptAgentMessage: (value: typeof workspace) => value,
}));
mock.module("./script-agent-workspace-panel", () => ({ ScriptAgentWorkspacePanel: () => <div data-testid="workspace-panel" /> }));
mock.module("./script-agent-conversations", () => ({ ScriptAgentConversations: ({ workspace: value, onChange }: { workspace: typeof workspace; onChange: (workspace: typeof workspace) => void }) => <button data-testid="history" onClick={() => onChange(value)}>历史记录</button> }));

const { App } = await import("antd");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ScriptAgentStudio } = await import("./script-agent-studio");

test("具体剧本工作区按项目加载并保存当前项目", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<App><ScriptAgentStudio projectId="project-1" onBack={() => {}} /></App>));
    await act(async () => await Promise.resolve());

    assert.equal(loadedProjectId, "project-1");
    assert.match(container.textContent || "", /只属于当前会话/);
    const history = container.querySelector<HTMLButtonElement>('[data-testid="history"]');
    assert.ok(history);
    await act(async () => history.click());
    assert.equal(savedProjectId, "project-1");

    await act(async () => root.unmount());
    container.remove();
});
