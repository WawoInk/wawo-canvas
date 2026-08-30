import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = {
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
    messages: [],
    conversations: [{ id: "conversation-1", title: "新对话", messages: [], createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" }],
    activeConversationId: "conversation-1",
    version: 0,
    updatedAt: "2026-08-30T00:00:00.000Z",
};

let saved = [];
// @ts-expect-error Bun provides module mocking at test runtime.
const { mock } = await import("bun:test");
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: unknown) => unknown) => selector({ user: { id: "user-1" } }) }));
mock.module("./script-agent-storage", () => ({
    loadScriptAgentProjects: async () => [project],
    saveScriptAgentProjects: async (_userId: string, projects: unknown[]) => {
        saved = projects;
        return projects;
    },
    createScriptAgentProject: (title: string, source: string) => ({ ...project, id: "project-2", projectId: "project-2", title, source }),
    renameScriptAgentProject: (projects: typeof project[], projectId: string, title: string) => projects.map((item) => item.projectId === projectId ? { ...item, title } : item),
    deleteScriptAgentProject: (projects: typeof project[], projectId: string) => projects.filter((item) => item.projectId !== projectId),
    deleteScriptAgentWorkspace: async (_userId: string, projectId: string) => [project].filter((item) => item.projectId !== projectId),
}));
mock.module("./script-agent-space", () => ({
    ScriptAgentSpace: ({ projects, onCreate }: { projects: typeof project[]; onCreate: (title: string, source: string) => void }) => (
        <div data-testid="space">
            <span>{projects.length}</span>
            <span data-testid="project-title">{projects[0]?.title}</span>
            <button onClick={() => onCreate("第二个剧本", "第二份素材")}>创建</button>
        </div>
    ),
}));
mock.module("./script-agent-studio", () => ({
    ScriptAgentStudio: ({ projectId, onBack, onWorkspaceChange }: { projectId: string; onBack: () => void; onWorkspaceChange: (workspace: typeof project) => void }) => (
        <div data-testid="studio">
            {projectId}
            <button data-testid="save-workspace" onClick={() => onWorkspaceChange({ ...project, title: "Studio 最新标题" })}>保存工作区</button>
            <button data-testid="back-space" onClick={onBack}>返回</button>
        </div>
    ),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router-dom");
const { ScriptAgentPage } = await import("./script-agent-page");

async function mount(projectId?: string) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<MemoryRouter><ScriptAgentPage projectId={projectId} /></MemoryRouter>));
    await act(async () => await Promise.resolve());
    return { container, root };
}

test("未选择剧本时加载并展示剧本空间", async () => {
    const { container, root } = await mount();
    assert.equal(container.querySelector('[data-testid="space"] span')?.textContent, "1");
    await act(async () => root.unmount());
    container.remove();
});

test("创建剧本持久化到当前账号", async () => {
    const { container, root } = await mount();
    await act(async () => container.querySelector("button")?.click());
    assert.equal(saved.length, 2);
    assert.equal(saved[1].title, "第二个剧本");
    await act(async () => root.unmount());
    container.remove();
});

test("选择已有剧本后进入绑定项目的 Agent 工作区", async () => {
    const { container, root } = await mount("project-1");
    assert.match(container.querySelector('[data-testid="studio"]')?.textContent || "", /^project-1/);
    await act(async () => root.unmount());
    container.remove();
});

test("Studio 保存后返回剧本空间不会用旧项目副本覆盖", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    function Harness() {
        const { pathname } = useLocation();
        const projectId = pathname.split("/").at(-1) === "project-1" ? "project-1" : undefined;
        return <ScriptAgentPage projectId={projectId} />;
    }

    await act(async () => root.render(<MemoryRouter initialEntries={["/storyboard/script-agent/project-1"]}><Harness /></MemoryRouter>));
    await act(async () => await Promise.resolve());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="save-workspace"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="back-space"]')?.click());
    assert.equal(container.querySelector('[data-testid="project-title"]')?.textContent, "Studio 最新标题");

    await act(async () => root.unmount());
    container.remove();
});

test("无效剧本 ID 返回剧本空间", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    function Harness() {
        const { pathname } = useLocation();
        return <><span data-testid="pathname">{pathname}</span><ScriptAgentPage projectId="missing-project" /></>;
    }

    await act(async () => root.render(<MemoryRouter initialEntries={["/storyboard/script-agent/missing-project"]}><Harness /></MemoryRouter>));
    await act(async () => await Promise.resolve());
    assert.equal(container.querySelector('[data-testid="pathname"]')?.textContent, "/storyboard/script-agent");

    await act(async () => root.unmount());
    container.remove();
});
