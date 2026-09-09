import { afterEach, expect, mock, test } from "bun:test";

type Project = {
    id: string;
    title: string;
    revision: number;
    localVersion: number;
    dirty: boolean;
    updatedAt: string;
};

const warnings = mock(() => {});
const createRequests: string[] = [];
const deleteRequests: string[] = [];
const fetchRequests: string[] = [];
const updateRequests: number[] = [];
let createHandler = async (_name: string, _project: Project) => ({ revision: 1, updatedAt: "2026-07-29T00:00:00.000Z" });
let deleteHandler = async (_id: string) => {};
let fetchHandler = async (_id: string): Promise<never> => {
    throw new FakeApiError(404);
};
let updateHandler = async (_id: string, input: { expectedRevision: number }) => ({
    revision: input.expectedRevision + 1,
    updatedAt: "2026-07-29T00:00:00.000Z",
});

class FakeApiError extends Error {
    constructor(
        public status: number,
        public data: unknown = null,
    ) {
        super();
    }
}

mock.module("antd", () => ({ message: { warning: warnings } }));
mock.module("@/services/api/request", () => ({ ApiError: FakeApiError }));
mock.module("@/services/api/canvas-projects", () => ({
    createCanvasProject: mock((name: string, project: Project) => {
        createRequests.push(project.id);
        return createHandler(name, project);
    }),
    deleteCanvasProject: mock((id: string) => {
        deleteRequests.push(id);
        return deleteHandler(id);
    }),
    fetchCanvasProject: mock((id: string) => {
        fetchRequests.push(id);
        return fetchHandler(id);
    }),
    updateCanvasProject: mock((id: string, input: { expectedRevision: number }) => {
        updateRequests.push(input.expectedRevision);
        return updateHandler(id, input);
    }),
}));
mock.module("@/services/sync-client", () => ({ syncClient: { onDelta: mock(() => {}) } }));
mock.module("@/services/sync-scheduler", () => ({ syncScheduler: { markActivity: mock(() => {}) } }));
mock.module("@/stores/use-user-store", () => ({ useUserStore: { getState: () => ({ user: { id: "user-1" }, token: "token" }) } }));

const { clearSyncTimers, detectDataChanges, fireCreateProject, fireDeleteProjects, flushProjectSync, resumePendingCanvasSync, retryPendingCanvasSync, scheduleBackendSync } = await import("../src/pages/canvas/stores/canvas-sync");

function createState(project: Partial<Project> | null = {}) {
    const state = {
        projects:
            project === null
                ? []
                : [
                      {
                          id: "project-1",
                          title: "初始",
                          revision: 1,
                          localVersion: 2,
                          dirty: true,
                          updatedAt: "2026-07-29T00:00:00.000Z",
                          ...project,
                      },
                  ],
        tombstones: [] as string[],
        waitForLocalPersistence: async () => {},
        acknowledgeProject: (_id: string, localVersion: number, patch: Pick<Project, "revision" | "updatedAt">) => {
            state.projects[0] = { ...state.projects[0], ...patch, dirty: state.projects[0].localVersion !== localVersion };
        },
        acknowledgeDelete: (id: string) => {
            state.tombstones = state.tombstones.filter((item) => item !== id);
        },
        replaceProjects: (projects: Project[]) => {
            state.projects = projects;
        },
    };
    return state;
}

async function waitFor(check: () => boolean, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() >= deadline) throw new Error("condition was not met");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

afterEach(() => {
    clearSyncTimers();
    createRequests.length = 0;
    deleteRequests.length = 0;
    fetchRequests.length = 0;
    updateRequests.length = 0;
    warnings.mockClear();
    createHandler = async () => ({ revision: 1, updatedAt: "2026-07-29T00:00:00.000Z" });
    deleteHandler = async () => {};
    fetchHandler = async () => {
        throw new FakeApiError(404);
    };
    updateHandler = async (_id, input) => ({ revision: input.expectedRevision + 1, updatedAt: "2026-07-29T00:00:00.000Z" });
});

test("a local edit starts database persistence immediately", async () => {
    const state = createState();

    scheduleBackendSync("project-1", { getState: () => state } as never);
    await waitFor(() => updateRequests.length === 1, 100);

    expect(updateRequests).toEqual([1]);
});

test("node, connection, and viewport changes enter the sync queue", () => {
    const base = {
        id: "project-1",
        title: "初始",
        revision: 1,
        localVersion: 1,
        dirty: true,
        updatedAt: "2026-07-29T00:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };

    expect(detectDataChanges([base] as never, [{ ...base, nodes: [{ id: "node-1" }] }] as never).sync).toEqual(["project-1"]);
    expect(detectDataChanges([base] as never, [{ ...base, connections: [{ id: "edge-1" }] }] as never).sync).toEqual(["project-1"]);
    expect(detectDataChanges([base] as never, [{ ...base, viewport: { x: 10, y: 0, k: 1 } }] as never).sync).toEqual(["project-1"]);
});

test("a failed save retries without requiring another edit", async () => {
    const state = createState();
    let attempts = 0;
    updateHandler = async (_id, input) => {
        attempts += 1;
        if (attempts === 1) throw new Error("offline");
        return { revision: input.expectedRevision + 1, updatedAt: "2026-07-29T00:00:00.000Z" };
    };

    flushProjectSync("project-1", { getState: () => state } as never);
    await waitFor(() => attempts === 2);

    expect(updateRequests).toEqual([1, 1]);
    expect(state.projects[0]).toMatchObject({ revision: 2, dirty: false });
});

test("an edit made during a save is persisted with the acknowledged revision", async () => {
    const state = createState();
    let releaseRequest = () => {};
    const requestGate = new Promise<void>((resolve) => {
        releaseRequest = resolve;
    });
    updateHandler = async (_id, input) => {
        await requestGate;
        return { revision: input.expectedRevision + 1, updatedAt: "2026-07-29T00:00:00.000Z" };
    };

    flushProjectSync("project-1", { getState: () => state } as never);
    await waitFor(() => updateRequests.length === 1);
    state.projects[0] = { ...state.projects[0], title: "最新", localVersion: 3, dirty: true };
    flushProjectSync("project-1", { getState: () => state } as never);
    releaseRequest();
    await waitFor(() => updateRequests.length === 2 && !state.projects[0].dirty);

    expect(updateRequests).toEqual([1, 2]);
    expect(state.projects[0]).toMatchObject({ title: "最新", revision: 3, dirty: false });
});

test("a 409 conflict preserves local edits without replacing the server project", async () => {
    const state = createState();
    let attempts = 0;
    updateHandler = async (_id, input) => {
        if (++attempts === 1) throw new FakeApiError(409, { current: { revision: 5 } });
        return { revision: input.expectedRevision + 1, updatedAt: "2026-07-29T00:00:02.000Z" };
    };

    flushProjectSync("project-1", { getState: () => state } as never);
    await waitFor(() => !state.projects[0].dirty || Boolean((state.projects[0] as Project & { syncConflict?: boolean }).syncConflict));

    expect(state.projects[0]).toMatchObject({ title: "初始", revision: 1, dirty: true, syncConflict: true });
    expect(updateRequests).toEqual([1]);
});

test("a lost create response recovers the remote revision and saves the latest project", async () => {
    const state = createState({ revision: 0, localVersion: 1 });
    createHandler = async () => {
        throw new Error("response lost");
    };
    fetchHandler = async (id) =>
        ({
            id,
            projectJson: JSON.stringify(state.projects[0]),
            revision: 4,
            updatedAt: "2026-07-29T00:00:01.000Z",
        }) as never;

    fireCreateProject(state.projects[0] as never, { getState: () => state } as never);
    await waitFor(() => updateRequests.length === 1 && !state.projects[0].dirty);

    expect(createRequests).toEqual(["project-1"]);
    expect(fetchRequests).toEqual(["project-1"]);
    expect(updateRequests).toEqual([4]);
    expect(state.projects[0]).toMatchObject({ revision: 5, dirty: false });
});

test("a failed delete retries until its tombstone is acknowledged", async () => {
    const state = createState(null);
    state.tombstones = ["project-1"];
    let attempts = 0;
    deleteHandler = async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("offline");
    };

    fireDeleteProjects(["project-1"], { getState: () => state } as never);
    await waitFor(() => attempts === 1);
    retryPendingCanvasSync();
    await waitFor(() => attempts === 2 && state.tombstones.length === 0);

    expect(deleteRequests).toEqual(["project-1", "project-1"]);
});

test("rehydration resumes dirty projects and pending deletions", async () => {
    const state = createState();
    state.tombstones = ["project-2"];

    resumePendingCanvasSync({ getState: () => state } as never);
    await waitFor(() => updateRequests.length === 1 && deleteRequests.length === 1);

    expect(updateRequests).toEqual([1]);
    expect(deleteRequests).toEqual(["project-2"]);
});

test("recovering a lost create response does not overwrite a different remote snapshot", async () => {
    const state = createState({ revision: 0, localVersion: 1 });
    createHandler = async () => {
        throw new Error("response lost");
    };
    fetchHandler = async (id) => ({ id, revision: 4, projectJson: JSON.stringify({ ...state.projects[0], title: "另一设备的作品" }) }) as never;
    fireCreateProject(state.projects[0] as never, { getState: () => state } as never);
    await waitFor(() => !state.projects[0].dirty || Boolean((state.projects[0] as Project & { syncConflict?: boolean }).syncConflict));
    expect(state.projects[0]).toMatchObject({ title: "初始", revision: 0, dirty: true, syncConflict: true });
    expect(updateRequests).toEqual([]);
});
