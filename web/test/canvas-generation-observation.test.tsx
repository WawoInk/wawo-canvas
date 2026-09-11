import "./register-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { afterEach, expect, mock, test } from "bun:test";
import axios from "axios";
import type { CanvasProject } from "../src/pages/canvas/stores/use-canvas-store";
import type { StateStorage } from "zustand/middleware";

const values = new Map<string, string>();
const storage: StateStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
        values.set(key, value);
    },
    removeItem: async (key) => {
        values.delete(key);
    },
};
mock.module("@/lib/localforage-storage", () => ({ localForageStorage: storage }));
const { useUserStore } = await import("../src/stores/use-user-store");
const { useCanvasStore } = await import("../src/pages/canvas/stores/use-canvas-store");
const { useConfigStore, defaultConfig } = await import("../src/stores/use-config-store");
const { clearSyncTimers } = await import("../src/pages/canvas/stores/canvas-sync");
(globalThis as any).__APP_VERSION__ = "test";
const { default: CanvasPage } = await import("../src/pages/canvas/project");
const { default: i18n } = await import("../src/i18n");
await i18n.changeLanguage("zh-CN");
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement;
const originalAdapter = axios.defaults.adapter;
let queryClient: QueryClient;
let polls = 0;
let submitted: unknown;

async function settleUntil(check: () => boolean) {
    const deadline = Date.now() + 1000;
    while (!check() && Date.now() < deadline)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
}
const originalFetch = globalThis.fetch;
const originalWindowTimeout = window.setTimeout;
let finishTask: (() => void) | undefined;
const profile = {
    id: "profile",
    version: 1,
    displayName: "测试视频",
    credits: "0",
    adapterKey: "seedance",
    intents: ["video.generate"],
    capabilities: {
        cancellation: false,
        completion: ["polling"],
        settings: {
            aspectRatio: { type: "enum", values: ["1:1"], default: "1:1" },
            resolution: { type: "enum", values: ["720p"], default: "720p" },
            durationSeconds: { type: "duration", min: 1, max: 30, default: 6 },
            generateAudio: { type: "boolean", default: false },
            watermark: { type: "boolean", default: false },
        },
    },
};
const project: CanvasProject = {
    id: "project",
    title: "画布",
    createdAt: "",
    updatedAt: "",
    revision: 1,
    remoteRevision: 1,
    localVersion: 0,
    dirty: false,
    nodes: [
        { id: "reference", type: "image" as CanvasProject["nodes"][number]["type"], title: "参考图", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "https://fixture.example/reference.png", fileId: "reference-file" } },
        { id: "output", type: "video" as CanvasProject["nodes"][number]["type"], title: "生成视频", position: { x: 200, y: 0 }, width: 100, height: 100, metadata: { prompt: "生成", status: "idle" } },
    ],
    connections: [{ id: "edge", fromNodeId: "reference", toNodeId: "output" }],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
};
async function setup(mode: "video" | "image" = "video", firstParty = false, retry = false, savedMetadata: CanvasProject["nodes"][number]["metadata"] = {}) {
    const currentProject = structuredClone(project);
    currentProject.nodes[1].type = mode as CanvasProject["nodes"][number]["type"];
    if (retry) currentProject.nodes[1].metadata = { ...currentProject.nodes[1].metadata, status: "error", ...(mode === "image" ? { generationType: "edit", references: ["https://fixture.example/reference.png"] } : {}) };
    currentProject.nodes[1].metadata = { ...currentProject.nodes[1].metadata, ...savedMetadata };
    useUserStore.setState({ user: { id: "test-user" } as never, token: "", isReady: true });
    await useCanvasStore.persist.rehydrate();
    useCanvasStore.setState({ projects: [currentProject], hydrated: true, synced: true, tombstones: [] });
    useConfigStore.setState({ config: { ...defaultConfig, channelMode: "local", baseUrl: "https://fixture.example/v1", apiKey: "fixture", videoModel: "seedance", imageModel: "gpt-image-1", model: "seedance", channels: [] } });
    if (firstParty) {
        useConfigStore.setState({ config: { ...useConfigStore.getState().config, channelMode: "remote", videoModel: "profile", model: "profile" } });
        useUserStore.setState({ token: "fixture-token" });
    }
    polls = 0;
    submitted = undefined;
    let releaseTask: () => void = () => {};
    const terminalGate = new Promise<void>((resolve) => {
        releaseTask = resolve;
    });
    finishTask = releaseTask;
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => originalWindowTimeout.call(window, handler, timeout === 5000 ? 1 : timeout, ...args)) as typeof window.setTimeout;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/content")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
        return Response.json({ code: 0, data: { url: "https://fixture.example/reference.png" }, msg: "" });
    }) as typeof fetch;
    axios.defaults.adapter = async (config) => {
        let data: unknown = {};
        if (config.url === "/api/v1/model-profiles") data = { code: 0, data: [profile], msg: "" };
        else if (config.url === "/api/v1/generations" && config.method === "post") {
            submitted = JSON.parse(config.data);
            data = { code: 0, data: { id: "run-1", status: "queued", modelProfileId: "profile" }, msg: "" };
        } else if (config.url === "/api/v1/generations/run-1") {
            polls++;
            if (polls > 1) await terminalGate;
            data = { code: 0, data: { id: "run-1", modelProfileId: "profile", status: polls === 1 ? "running" : "succeeded", result: { kind: "video", file: { fileId: "result-file", mimeType: "video/mp4", width: 100, height: 100 } } }, msg: "" };
        } else if (config.url?.includes("images/edits") && config.method === "post") {
            submitted = config.data;
            data = { id: "image-task", status: "queued" };
        } else if (config.url?.includes("/tasks/image-task")) {
            polls++;
            data = { status: "failed", error: { message: "fixture terminal failure" } };
        } else if (config.url?.endsWith("/contents/generations/tasks") && config.method === "post") {
            submitted = JSON.parse(config.data);
            data = { id: "task-1", status: "queued" };
        } else if (config.url?.includes("/contents/generations/tasks/task-1")) {
            polls++;
            data = { id: "task-1", status: "failed", error: { message: "fixture terminal failure" } };
        } else if (config.url?.includes("canvas/projects"))
            data = { code: 0, data: { ...currentProject, revision: config.method === "put" ? JSON.parse(config.data).expectedRevision + 1 : currentProject.revision, projectJson: JSON.stringify(currentProject) }, msg: "" };
        else data = { code: 0, data: [], msg: "" };
        return { config, headers: {}, status: 200, statusText: "OK", data };
    };
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(
            <QueryClientProvider client={queryClient}>
                <App>
                    <MemoryRouter initialEntries={["/canvas/project"]}>
                        <Routes>
                            <Route path="/canvas/:id" element={<CanvasPage />} />
                        </Routes>
                    </MemoryRouter>
                </App>
            </QueryClientProvider>,
        );
    });
}
afterEach(async () => {
    if (root)
        await act(async () => {
            root?.unmount();
            queryClient.clear();
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
    root = undefined;
    host?.remove();
    finishTask?.();
    window.setTimeout = originalWindowTimeout;
    clearSyncTimers();
    axios.defaults.adapter = originalAdapter;
    globalThis.fetch = originalFetch;
    useUserStore.setState({ token: "", user: null });
});

test.each(["video", "image"] as const)("a connected %s node leaves queued through polling without a browser refresh", async (mode) => {
    await setup(mode);

    const node = host.querySelector('[data-node-id="output"]')!;
    expect(node).not.toBeNull();
    await act(async () => {
        (node.firstElementChild || node).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 200 }));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 200 }));
    });
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "生成")!;
    expect(button).toBeDefined();
    await act(async () => {
        button.click();
    });
    await settleUntil(() => Boolean(host.textContent?.includes("fixture terminal failure")));
    expect(submitted).toBeDefined();
    expect(polls).toBeGreaterThan(0);
    expect(host.textContent).toContain("fixture terminal failure");
});

test.each(["generate", "retry"] as const)("first-party video advances to running and materialized success without refresh (%s)", async (action) => {
    const retry = action === "retry";
    await setup("video", true, retry);
    const node = host.querySelector('[data-node-id="output"]')!;
    await act(async () => {
        (node.firstElementChild || node).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 200 }));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 200 }));
    });
    const button = host.querySelector<HTMLButtonElement>(retry ? '[data-node-id="output"] [data-result-action="retry"]' : 'button[aria-label="生成"]')!;
    expect(button.disabled).toBe(false);
    await act(async () => {
        button.click();
    });
    await settleUntil(
        () =>
            useCanvasStore
                .getState()
                .openProject("project")
                ?.nodes.find((n) => n.id === "output")?.metadata?.generationTaskStatus === "running",
    );
    expect(submitted).toMatchObject({ modelProfileId: "profile", intent: { kind: "video.generate", references: { images: [{ fileId: "reference-file", sourceNodeId: "reference" }] } } });
    expect(
        useCanvasStore
            .getState()
            .openProject("project")
            ?.nodes.find((n) => n.id === "output")?.metadata?.generationTaskStatus,
    ).toBe("running");
    await act(async () => {
        finishTask?.();
    });
    await settleUntil(
        () =>
            useCanvasStore
                .getState()
                .openProject("project")
                ?.nodes.find((n) => n.id === "output")?.metadata?.status === "success",
    );
    expect(
        useCanvasStore
            .getState()
            .openProject("project")
            ?.nodes.find((n) => n.id === "output")?.metadata,
    ).toMatchObject({ status: "success", generationTaskStatus: "succeeded", fileId: "result-file" });
});

test.each(["video", "image"] as const)("retrying a connected %s node keeps observing the new task", async (mode) => {
    await setup(mode, false, true);
    const retry = host.querySelector<HTMLButtonElement>('[data-node-id="output"] [data-result-action="retry"]')!;
    expect(retry).not.toBeNull();
    await act(async () => {
        retry.click();
    });
    await settleUntil(() => Boolean(host.textContent?.includes("fixture terminal failure")));
    expect(submitted).toBeDefined();
    expect(polls).toBeGreaterThan(0);
    expect(host.textContent).toContain("fixture terminal failure");
});


test("resuming a timed-out video clears its stale error and materializes the original task", async () => {
    await setup("video", true, false, {
        status: "error", generationTaskId: "run-1", generationProfileId: "profile",
        generationTaskStatus: "running", errorDetails: "视频生成超时，请稍后重试",
    });
    await settleUntil(() => polls >= 2);
    const metadata = () => useCanvasStore.getState().openProject("project")?.nodes.find((node) => node.id === "output")?.metadata;
    expect(submitted).toBeUndefined();
    expect(metadata()?.status).toBe("loading");
    expect(metadata()?.errorDetails).toBeUndefined();
    await act(async () => finishTask?.());
    await settleUntil(() => metadata()?.status === "success");
    expect(metadata()).toMatchObject({ status: "success", generationTaskStatus: "succeeded", fileId: "result-file" });
});


test("manual resume observes the original task after editor initialization", async () => {
    await setup("video", true, false, { status: "loading", generationTaskId: "run-1", generationProfileId: "profile", generationTaskStatus: "running" });
    await settleUntil(() => polls >= 2);
    const node = host.querySelector('[data-node-id="output"]')!;
    await act(async () => {
        (node.firstElementChild || node).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 200 }));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 200 }));
    });
    const stop = host.querySelector<HTMLButtonElement>('button[aria-label="停止等待"]');
    expect(stop).not.toBeNull();
    await act(async () => stop!.click());
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>(".ant-modal-confirm-btns button")).find((button) => button.textContent?.replaceAll(" ", "") === "停止");
    expect(confirm).toBeDefined();
    await act(async () => confirm!.click());
    const resume = host.querySelector<HTMLButtonElement>('button[aria-label="恢复查询"]');
    expect(resume).not.toBeNull();
    const before = polls;
    await act(async () => resume!.click());
    await settleUntil(() => polls > before);
    expect(polls).toBeGreaterThan(before);
    expect(submitted).toBeUndefined();
    await act(async () => finishTask?.());
    await settleUntil(() => useCanvasStore.getState().openProject("project")?.nodes.find((node) => node.id === "output")?.metadata?.status === "success");
    expect(useCanvasStore.getState().openProject("project")?.nodes.find((node) => node.id === "output")?.metadata?.fileId).toBe("result-file");
});
