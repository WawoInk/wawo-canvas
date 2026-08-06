import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import axios from "axios";
import type { StateStorage } from "zustand/middleware";

const values = new Map<string, string>();
let writeCount = 0;
let writeLimit = Number.POSITIVE_INFINITY;
let blockedWriteNumber = 0;
let failedWriteNumber = 0;
let releaseBlockedWrite = () => {};
let markBlockedWriteStarted = () => {};
let blockedWriteStarted = Promise.resolve();

const localForageStorage: StateStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
        writeCount += 1;
        if (writeCount > writeLimit) throw new Error("storage write limit exceeded");
        if (writeCount === failedWriteNumber) throw new Error("storage unavailable");
        if (writeCount === blockedWriteNumber) {
            const gate = new Promise<void>((resolve) => {
                releaseBlockedWrite = resolve;
            });
            markBlockedWriteStarted();
            await gate;
        }
        values.set(key, value);
    },
    removeItem: async (key) => void values.delete(key),
};

mock.module("@/lib/localforage-storage", () => ({ localForageStorage }));

const { useUserStore } = await import("../src/stores/use-user-store");
useUserStore.setState({ token: "", user: null, isReady: true, isLoading: false });

const { useCanvasStore } = await import("../src/pages/canvas/stores/use-canvas-store");
const { clearSyncTimers } = await import("../src/pages/canvas/stores/canvas-sync");
await useCanvasStore.persist.rehydrate();

const account = { id: "account-a" };
const project = {
    id: "project-1",
    title: "初始",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    revision: 1,
    localVersion: 0,
    dirty: false,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines" as const,
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
};

async function waitFor(check: () => boolean, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() >= deadline) throw new Error("condition was not met");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

async function resetStore() {
    clearSyncTimers();
    useUserStore.setState({ token: "", user: null as never });
    await Promise.resolve(useCanvasStore.getState().clearProjects() as unknown);
    values.clear();
    writeCount = 0;
    writeLimit = Number.POSITIVE_INFINITY;
    blockedWriteNumber = 0;
    failedWriteNumber = 0;
    releaseBlockedWrite = () => {};
    markBlockedWriteStarted = () => {};
    blockedWriteStarted = Promise.resolve();
    useUserStore.setState({ token: "", user: account as never });
    await Promise.resolve(useCanvasStore.getState().replaceProjects([project]) as unknown);
}

beforeEach(resetStore);

afterEach(() => {
    clearSyncTimers();
    useUserStore.setState({ token: "", user: null as never });
});

test("the newest project update remains durable after a fresh account hydration", async () => {
    blockedWriteStarted = new Promise<void>((resolve) => {
        markBlockedWriteStarted = resolve;
    });
    blockedWriteNumber = writeCount + 1;

    const olderCommit = Promise.resolve(useCanvasStore.getState().updateProject(project.id, { title: "较旧快照" }) as unknown);
    await blockedWriteStarted;
    const newerCommit = Promise.resolve(useCanvasStore.getState().updateProject(project.id, { title: "最新快照" }) as unknown);

    releaseBlockedWrite();
    await Promise.all([olderCommit, newerCommit]);

    useUserStore.setState({ token: "", user: null as never });
    await Promise.resolve(useCanvasStore.getState().clearProjects() as unknown);
    useUserStore.setState({ token: "", user: account as never });
    await useCanvasStore.persist.rehydrate();

    expect(useCanvasStore.getState().openProject(project.id)?.title).toBe("最新快照");
});

test("backend sync sends a project only after that snapshot is locally durable", async () => {
    const originalAdapter = axios.defaults.adapter;
    let putStarted = false;
    let sentTitle = "";
    let releasePut = () => {};
    const putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
    });
    blockedWriteStarted = new Promise<void>((resolve) => {
        markBlockedWriteStarted = resolve;
    });
    blockedWriteNumber = writeCount + 1;
    useUserStore.setState({ token: "token-a", user: account as never });

    axios.defaults.adapter = async (config) => {
        if (config.method === "put" && config.url === `/api/v1/canvas/projects/${project.id}`) {
            putStarted = true;
            const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
            sentTitle = body.project.title;
            await putGate;
            return {
                config,
                data: { code: 0, data: { revision: 2, updatedAt: "2026-08-04T00:00:01.000Z" }, msg: "" },
                headers: {},
                status: 200,
                statusText: "OK",
            };
        }
        return {
            config,
            data: { code: 0, data: [], msg: "" },
            headers: {},
            status: 200,
            statusText: "OK",
        };
    };

    const commit = Promise.resolve(useCanvasStore.getState().updateProject(project.id, { title: "本地已持久化" }) as unknown);

    try {
        await blockedWriteStarted;
        await Promise.resolve();
        expect(putStarted).toBe(false);

        releaseBlockedWrite();
        await commit;
        await waitFor(() => putStarted);
        expect(sentTitle).toBe("本地已持久化");
    } finally {
        releaseBlockedWrite();
        releasePut();
        await Promise.resolve();
        axios.defaults.adapter = originalAdapter;
    }
});

test("a generated video result completes only after its Canvas Replica commit is durable", async () => {
    const videoNode = {
        id: "video-1",
        type: "video" as const,
        title: "生成视频",
        position: { x: 40, y: 60 },
        width: 480,
        height: 270,
        metadata: {
            prompt: "城市夜景",
            status: "loading" as const,
            generationTaskId: "task-1",
            generationTaskStatus: "running" as const,
        },
    };
    await Promise.resolve(useCanvasStore.getState().replaceProjects([{ ...project, nodes: [videoNode] }]) as unknown);
    blockedWriteStarted = new Promise<void>((resolve) => {
        markBlockedWriteStarted = resolve;
    });
    blockedWriteNumber = writeCount + 1;

    const { commitCanvasVideoResult } = await import("../src/pages/canvas/stores/canvas-video-result");
    let completed = false;
    const commit = commitCanvasVideoResult({
        projectId: project.id,
        nodeId: videoNode.id,
        nodes: [videoNode],
        display: { width: 640, height: 360 },
        file: {
            url: "https://files.example/video.mp4",
            fileId: "file-video-1",
            width: 1920,
            height: 1080,
            bytes: 2048,
            mimeType: "video/mp4",
            durationMs: 6000,
        },
        generationTaskStatus: "succeeded",
    }).then((nodes) => {
        completed = true;
        return nodes;
    });

    await blockedWriteStarted;
    await Promise.resolve();
    expect(completed).toBe(false);

    releaseBlockedWrite();
    const committedNodes = await commit;
    expect(committedNodes[0]).toMatchObject({
        width: 640,
        height: 360,
        metadata: {
            content: "https://files.example/video.mp4",
            fileId: "file-video-1",
            status: "success",
            naturalWidth: 1920,
            naturalHeight: 1080,
            bytes: 2048,
            mimeType: "video/mp4",
            durationMs: 6000,
            generationTaskStatus: "succeeded",
        },
    });

    useUserStore.setState({ token: "", user: null as never });
    await Promise.resolve(useCanvasStore.getState().clearProjects() as unknown);
    useUserStore.setState({ token: "", user: account as never });
    await useCanvasStore.persist.rehydrate();

    expect(useCanvasStore.getState().openProject(project.id)?.nodes[0]?.metadata).toMatchObject({
        fileId: "file-video-1",
        status: "success",
        generationTaskStatus: "succeeded",
    });
});

test("a generated video durable commit preserves a newer accepted Canvas edit", async () => {
    const videoNode = {
        id: "video-1",
        type: "video" as const,
        title: "生成视频",
        position: { x: 40, y: 60 },
        width: 480,
        height: 270,
        metadata: { status: "loading" as const, generationTaskId: "task-1" },
    };
    const textNode = {
        id: "text-1",
        type: "text" as const,
        title: "提示词",
        position: { x: 600, y: 60 },
        width: 320,
        height: 180,
        metadata: { content: "初始内容", status: "success" as const },
    };
    const initialNodes = [videoNode, textNode];
    await Promise.resolve(useCanvasStore.getState().replaceProjects([{ ...project, nodes: initialNodes }]) as unknown);
    blockedWriteStarted = new Promise<void>((resolve) => {
        markBlockedWriteStarted = resolve;
    });
    blockedWriteNumber = writeCount + 1;

    const { commitCanvasVideoResult } = await import("../src/pages/canvas/stores/canvas-video-result");
    const videoCommit = commitCanvasVideoResult({
        projectId: project.id,
        nodeId: videoNode.id,
        nodes: initialNodes,
        display: { width: 640, height: 360 },
        file: {
            url: "https://files.example/video.mp4",
            fileId: "file-video-1",
            width: 1920,
            height: 1080,
            bytes: 2048,
            mimeType: "video/mp4",
            durationMs: 6000,
        },
    });

    await blockedWriteStarted;
    const editedNodes = initialNodes.map((node) => (node.id === textNode.id ? { ...node, metadata: { ...node.metadata, content: "用户新编辑" } } : node));
    const editCommit = useCanvasStore.getState().updateProject(project.id, { nodes: editedNodes });
    releaseBlockedWrite();

    const [committedNodes] = await Promise.all([videoCommit, editCommit]);
    expect(committedNodes.find((node) => node.id === textNode.id)?.metadata?.content).toBe("用户新编辑");

    useUserStore.setState({ token: "", user: null as never });
    await Promise.resolve(useCanvasStore.getState().clearProjects() as unknown);
    useUserStore.setState({ token: "", user: account as never });
    await useCanvasStore.persist.rehydrate();

    const restoredNodes = useCanvasStore.getState().openProject(project.id)?.nodes || [];
    expect(restoredNodes.find((node) => node.id === textNode.id)?.metadata?.content).toBe("用户新编辑");
    expect(restoredNodes.find((node) => node.id === videoNode.id)?.metadata).toMatchObject({
        fileId: "file-video-1",
        status: "success",
    });
});

test("concurrent generated video commits converge and the last page publication keeps both results", async () => {
    const videoA = {
        id: "video-a",
        type: "video" as const,
        title: "视频 A",
        position: { x: 40, y: 60 },
        width: 480,
        height: 270,
        metadata: { status: "loading" as const, generationTaskId: "task-a" },
    };
    const videoB = {
        id: "video-b",
        type: "video" as const,
        title: "视频 B",
        position: { x: 600, y: 60 },
        width: 480,
        height: 270,
        metadata: { status: "loading" as const, generationTaskId: "task-b" },
    };
    const initialNodes = [videoA, videoB];
    await Promise.resolve(useCanvasStore.getState().replaceProjects([{ ...project, nodes: initialNodes }]) as unknown);
    writeLimit = writeCount + 6;

    const { commitCanvasVideoResult } = await import("../src/pages/canvas/stores/canvas-video-result");
    let publishedNodes = initialNodes;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("concurrent video commits did not converge")), 300);
    });
    const publish = (nodes: typeof initialNodes) => {
        publishedNodes = nodes;
        return nodes;
    };

    try {
        await Promise.race([
            Promise.all([
                commitCanvasVideoResult({
                    projectId: project.id,
                    nodeId: videoA.id,
                    nodes: initialNodes,
                    display: { width: 640, height: 360 },
                    file: { url: "https://files.example/video-a.mp4", fileId: "file-video-a", width: 1920, height: 1080, bytes: 2048, mimeType: "video/mp4", durationMs: 6000 },
                    generationTaskStatus: "succeeded",
                }).then(publish),
                commitCanvasVideoResult({
                    projectId: project.id,
                    nodeId: videoB.id,
                    nodes: initialNodes,
                    display: { width: 640, height: 360 },
                    file: { url: "https://files.example/video-b.mp4", fileId: "file-video-b", width: 1920, height: 1080, bytes: 4096, mimeType: "video/mp4", durationMs: 8000 },
                    generationTaskStatus: "succeeded",
                }).then(publish),
            ]),
            timeout,
        ]);

        expect(publishedNodes.find((node) => node.id === videoA.id)?.metadata).toMatchObject({ fileId: "file-video-a", status: "success" });
        expect(publishedNodes.find((node) => node.id === videoB.id)?.metadata).toMatchObject({ fileId: "file-video-b", status: "success" });

        useUserStore.setState({ token: "", user: null as never });
        await Promise.resolve(useCanvasStore.getState().clearProjects() as unknown);
        useUserStore.setState({ token: "", user: account as never });
        await useCanvasStore.persist.rehydrate();

        const restoredNodes = useCanvasStore.getState().openProject(project.id)?.nodes || [];
        expect(restoredNodes.find((node) => node.id === videoA.id)?.metadata?.fileId).toBe("file-video-a");
        expect(restoredNodes.find((node) => node.id === videoB.id)?.metadata?.fileId).toBe("file-video-b");
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        writeLimit = Number.POSITIVE_INFINITY;
    }
});

test("a 120-node dirty Replica survives immediate close while a normal PUT is in flight", async () => {
    const originalAdapter = axios.defaults.adapter;
    const nodes = Array.from({ length: 120 }, (_, index) => {
        const type = index === 119 ? "video" : (["image", "video", "audio"] as const)[index % 3];
        return {
            id: `media-${index}`,
            type,
            title: `媒体 ${index}`,
            position: { x: (index % 12) * 180, y: Math.floor(index / 12) * 140 },
            width: type === "audio" ? 320 : 160,
            height: type === "audio" ? 96 : 90,
            metadata: {
                content: `https://files.example/${type}/${index}`,
                fileId: index === 119 ? "file-generated-video" : `file-${type}-${index}`,
                status: "success" as const,
                mimeType: type === "image" ? "image/png" : type === "video" ? "video/mp4" : "audio/mpeg",
                bytes: 1024 + index,
                ...(type === "video" ? { naturalWidth: 1920, naturalHeight: 1080, durationMs: 6000 } : {}),
            },
        };
    });
    let markPutStarted = () => {};
    const putStarted = new Promise<void>((resolve) => {
        markPutStarted = resolve;
    });
    let releasePut = () => {};
    const putGate = new Promise<void>((resolve) => {
        releasePut = resolve;
    });
    let sentNodeCount = 0;

    axios.defaults.adapter = async (config) => {
        if (config.method === "put" && config.url === `/api/v1/canvas/projects/${project.id}`) {
            const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
            sentNodeCount = body.project.nodes.length;
            markPutStarted();
            await putGate;
            return {
                config,
                data: { code: 0, data: { revision: 2, updatedAt: "2026-08-04T00:00:02.000Z" }, msg: "" },
                headers: {},
                status: 200,
                statusText: "OK",
            };
        }
        return {
            config,
            data: { code: 0, data: [], msg: "" },
            headers: {},
            status: 200,
            statusText: "OK",
        };
    };

    blockedWriteStarted = new Promise<void>((resolve) => {
        markBlockedWriteStarted = resolve;
    });
    blockedWriteNumber = writeCount + 1;
    useUserStore.setState({ token: "token-a", user: account as never });
    const commit = useCanvasStore.getState().updateProject(project.id, { nodes });

    try {
        await blockedWriteStarted;
        releaseBlockedWrite();
        await commit;
        await putStarted;
        expect(sentNodeCount).toBe(120);

        useUserStore.setState({ token: "", user: null as never });
        await Promise.resolve(useCanvasStore.getState().clearProjects() as unknown);
        useUserStore.setState({ token: "", user: account as never });
        await useCanvasStore.persist.rehydrate();

        const restored = useCanvasStore.getState().openProject(project.id);
        expect(restored).toMatchObject({ dirty: true, localVersion: 1 });
        expect(restored?.nodes).toHaveLength(120);
        expect(restored?.nodes[119]?.metadata).toMatchObject({
            fileId: "file-generated-video",
            status: "success",
            mimeType: "video/mp4",
            durationMs: 6000,
        });
    } finally {
        releaseBlockedWrite();
        releasePut();
        await Promise.resolve();
        axios.defaults.adapter = originalAdapter;
    }
});

test("backend retry never sends a project whose local durable write failed", async () => {
    const originalAdapter = axios.defaults.adapter;
    let putStarted = false;
    failedWriteNumber = writeCount + 1;
    useUserStore.setState({ token: "token-a", user: account as never });
    axios.defaults.adapter = async (config) => {
        if (config.method === "put" && config.url === `/api/v1/canvas/projects/${project.id}`) putStarted = true;
        return {
            config,
            data: { code: 0, data: { revision: 2, updatedAt: "2026-08-04T00:00:03.000Z" }, msg: "" },
            headers: {},
            status: 200,
            statusText: "OK",
        };
    };

    try {
        let commitError: unknown;
        try {
            await useCanvasStore.getState().updateProject(project.id, { title: "不得越过本地失败" });
        } catch (error) {
            commitError = error;
        }
        expect(commitError).toBeInstanceOf(Error);

        await new Promise((resolve) => setTimeout(resolve, 650));
        expect(putStarted).toBe(false);

        failedWriteNumber = 0;
        await useCanvasStore.getState().updateProject(project.id, { title: "本地恢复后再同步" });
        await waitFor(() => putStarted);
    } finally {
        axios.defaults.adapter = originalAdapter;
    }
});
