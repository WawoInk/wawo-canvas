import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summary = {
    id: "project-1",
    projectId: "project-1",
    title: "雾城追凶",
    source: "素材",
    currentStage: "collecting_config",
    version: 0,
    revision: 3,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
};
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
    messages: [],
    conversations: [{ id: "conversation-1", title: "新对话", messages: [], createdAt: summary.createdAt, updatedAt: summary.updatedAt }],
    activeConversationId: "conversation-1",
    version: 0,
    revision: 3,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
};

let createFails = false;
let deleteFails = false;
const { mock } = await import("bun:test");
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: unknown) => unknown) => selector({ user: { id: "user-1" } }) }));
mock.module("./script-agent-storage", () => ({
    loadScriptAgentProjects: async () => [summary],
    createScriptAgentWorkspace: async (title: string, source: string) => {
        if (createFails) throw new Error("create failed");
        return { ...workspace, id: "project-2", projectId: "project-2", title, source, revision: 1 };
    },
    renameScriptAgentWorkspace: async (project: typeof summary, title: string) => ({ ...project, title, revision: project.revision + 1 }),
    deleteScriptAgentWorkspace: async () => {
        if (deleteFails) throw new Error("delete failed");
    },
}));
mock.module("./script-agent-space", () => ({
    ScriptAgentSpace: ({
        projects,
        onCreate,
        onRename,
        onDelete,
    }: {
        projects: (typeof summary)[];
        onCreate: (title: string, source: string) => Promise<void>;
        onRename: (id: string, title: string) => Promise<void>;
        onDelete: (id: string) => Promise<void>;
    }) => (
        <div data-testid="space">
            <span data-testid="count">{projects.length}</span>
            <span data-testid="project-title">{projects[0]?.title}</span>
            <button data-testid="create" onClick={() => void onCreate("第二个剧本", "第二份素材").catch(() => {})}>
                创建
            </button>
            <button data-testid="rename" onClick={() => void onRename("project-1", "新标题").catch(() => {})}>
                重命名
            </button>
            <button data-testid="delete" onClick={() => void onDelete("project-1").catch(() => {})}>
                删除
            </button>
        </div>
    ),
}));
mock.module("./script-agent-studio", () => ({
    ScriptAgentStudio: ({ projectId, onBack, onWorkspaceChange }: { projectId: string; onBack: () => void; onWorkspaceChange: (workspace: typeof workspace) => void }) => (
        <div data-testid="studio">
            {projectId}
            <button data-testid="save-workspace" onClick={() => onWorkspaceChange({ ...workspace, title: "Studio 最新标题", revision: 4 })}>
                保存工作区
            </button>
            <button data-testid="back-space" onClick={onBack}>
                返回
            </button>
        </div>
    ),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router-dom");
const { ScriptAgentPage } = await import("./script-agent-page");

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

async function mount(initialPath = "/storyboard/script-agent") {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Harness() {
        const { pathname } = useLocation();
        const routeProjectId = pathname.startsWith("/storyboard/script-agent/") ? decodeURIComponent(pathname.split("/").at(-1) || "") : undefined;
        return (
            <>
                <span data-testid="pathname">{pathname}</span>
                <ScriptAgentPage projectId={routeProjectId} />
            </>
        );
    }
    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={[initialPath]}>
                <Harness />
            </MemoryRouter>,
        ),
    );
    await act(flush);
    return { container, root };
}

test("剧本空间使用服务端摘要而不是完整工作区列表", async () => {
    const { container, root } = await mount();
    assert.equal(container.querySelector('[data-testid="count"]')?.textContent, "1");
    assert.equal(container.querySelector('[data-testid="project-title"]')?.textContent, "雾城追凶");
    await act(async () => root.unmount());
    container.remove();
});

test("服务端创建成功后才进入新剧本", async () => {
    createFails = false;
    const { container, root } = await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="create"]')?.click());
    await act(flush);
    assert.equal(container.querySelector('[data-testid="pathname"]')?.textContent, "/storyboard/script-agent/project-2");
    assert.match(container.querySelector('[data-testid="studio"]')?.textContent || "", /project-2/);
    await act(async () => root.unmount());
    container.remove();
});

test("创建失败不会把未持久化剧本加入列表", async () => {
    createFails = true;
    const { container, root } = await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="create"]')?.click());
    await act(flush);
    assert.equal(container.querySelector('[data-testid="pathname"]')?.textContent, "/storyboard/script-agent");
    assert.equal(container.querySelector('[data-testid="count"]')?.textContent, "1");
    createFails = false;
    await act(async () => root.unmount());
    container.remove();
});

test("重命名和删除只在服务端成功后更新摘要列表", async () => {
    const { container, root } = await mount();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="rename"]')?.click());
    await act(flush);
    assert.equal(container.querySelector('[data-testid="project-title"]')?.textContent, "新标题");

    deleteFails = true;
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="delete"]')?.click());
    await act(flush);
    assert.equal(container.querySelector('[data-testid="count"]')?.textContent, "1");

    deleteFails = false;
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="delete"]')?.click());
    await act(flush);
    assert.equal(container.querySelector('[data-testid="count"]')?.textContent, "0");
    await act(async () => root.unmount());
    container.remove();
});

test("Studio 保存详情后同步对应摘要", async () => {
    const { container, root } = await mount("/storyboard/script-agent/project-1");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="save-workspace"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="back-space"]')?.click());
    assert.equal(container.querySelector('[data-testid="project-title"]')?.textContent, "Studio 最新标题");
    await act(async () => root.unmount());
    container.remove();
});

test("无效剧本 ID 返回剧本空间", async () => {
    const { container, root } = await mount("/storyboard/script-agent/missing-project");
    assert.equal(container.querySelector('[data-testid="pathname"]')?.textContent, "/storyboard/script-agent");
    await act(async () => root.unmount());
    container.remove();
});
