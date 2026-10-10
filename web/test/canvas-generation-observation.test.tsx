import "./register-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { afterEach, expect, mock, test } from "bun:test";
import axios from "axios";
import type { CanvasProject } from "../src/pages/canvas/stores/use-canvas-store";
import type { StateStorage } from "zustand/middleware";
import type { PublicSettings } from "../src/services/api/settings";

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
const originalRect = HTMLElement.prototype.getBoundingClientRect;
let queryClient: QueryClient;
let polls = 0;
let submitted: unknown;
let savedProjects: CanvasProject[] = [];
let remoteProject: CanvasProject;

function SwitchCanvas() {
    const navigate = useNavigate();
    return (
        <button data-test-switch-canvas onClick={() => navigate("/canvas/other")}>
            切换画布
        </button>
    );
}

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
            videoMode: { type: "enum", values: ["reference", "frames"], default: "reference" },
            durationSeconds: { type: "duration", min: 1, max: 30, default: 6 },
            generateAudio: { type: "boolean", default: false },
            watermark: { type: "boolean", default: false },
        },
    },
};
const publicSettings: PublicSettings = {
    auth: { allowRegister: false, linuxDo: { enabled: false } },
    modelChannel: {
        availableModels: ["profile", "gpt-image-1"],
        modelCosts: [],
        imageRequestFormats: [],
        defaultModel: "gpt-image-1",
        defaultImageModel: "gpt-image-1",
        defaultVideoModel: "profile",
        defaultTextModel: "",
        defaultAudioModel: "",
        imageModels: ["gpt-image-1"],
        videoModels: ["profile"],
        textModels: [],
        textModelProtocols: {},
        audioModels: [],
        systemPrompt: "",
        allowCustomChannel: false,
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
async function setup(mode: "video" | "image" = "video", successfulVideo = false, retry = false, savedVideoMode?: "frames", savedMetadata: CanvasProject["nodes"][number]["metadata"] = {}) {
    // Happy DOM has no layout; canvas visibility and placement need an explicit viewport.
    HTMLElement.prototype.getBoundingClientRect = function () {
        return this.matches(".relative.h-full.w-full.select-none.overflow-hidden") ? new DOMRect(0, 0, 1200, 720) : originalRect.call(this);
    };
    const currentProject = structuredClone(project);
    currentProject.nodes[1].type = mode as CanvasProject["nodes"][number]["type"];
    if (retry) currentProject.nodes[1].metadata = { ...currentProject.nodes[1].metadata, status: "error", ...(mode === "image" ? { generationType: "edit", references: ["https://fixture.example/reference.png"] } : {}) };
    if (savedVideoMode) {
        currentProject.nodes[1].metadata = { ...currentProject.nodes[1].metadata, videoMode: savedVideoMode };
        currentProject.nodes.push({
            id: "config",
            type: "config" as CanvasProject["nodes"][number]["type"],
            title: "视频配置",
            position: { x: 100, y: 150 },
            width: 100,
            height: 100,
            metadata: { model: "profile", generationMode: "video", prompt: "生成", videoMode: "reference" },
        });
        currentProject.connections = [
            { id: "input", fromNodeId: "reference", toNodeId: "config" },
            { id: "result", fromNodeId: "config", toNodeId: "output" },
        ];
    }
    currentProject.nodes[1].metadata = { ...currentProject.nodes[1].metadata, ...savedMetadata };
    remoteProject = currentProject;
    useUserStore.setState({ user: { id: "test-user" } as never, token: "fixture-token", isReady: true });
    await useCanvasStore.persist.rehydrate();
    useCanvasStore.setState({ projects: [currentProject, { ...structuredClone(project), id: "other", title: "另一画布", nodes: [], connections: [] }], hydrated: true, synced: true, tombstones: [] });
    useConfigStore.setState({ publicSettings, config: { ...defaultConfig, channelMode: "remote", videoModel: "profile", imageModel: "gpt-image-1", model: "profile", channels: [] } });
    polls = 0;
    submitted = undefined;
    savedProjects = [];
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
            if (successfulVideo && polls > 1) await terminalGate;
            data = {
                code: 0,
                data: {
                    id: "run-1",
                    modelProfileId: "profile",
                    status: !successfulVideo ? "failed" : polls === 1 ? "running" : "succeeded",
                    ...(!successfulVideo ? { error: { code: "UPSTREAM_REJECTED", message: "fixture terminal failure" } } : { result: { kind: "video", file: { fileId: "result-file", mimeType: "video/mp4", width: 100, height: 100 } } }),
                },
                msg: "",
            };
        } else if (config.url?.includes("images/edits") && config.method === "post") {
            submitted = config.data;
            data = { id: "image-task", status: "queued" };
        } else if (config.url?.includes("/tasks/image-task")) {
            polls++;
            data = { status: "failed", error: { message: "fixture terminal failure" } };
        } else if (config.url?.includes("canvas/projects")) {
            if (config.method === "put") savedProjects.push(JSON.parse(config.data).project);
            data = { code: 0, data: { ...remoteProject, revision: config.method === "put" ? JSON.parse(config.data).expectedRevision + 1 : remoteProject.revision, projectJson: JSON.stringify(remoteProject) }, msg: "" };
        } else data = { code: 0, data: [], msg: "" };
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
                        <SwitchCanvas />
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
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    useUserStore.setState({ token: "", user: null });
});

class TransformImage {
    width = 400;
    height = 200;
    naturalWidth = 400;
    naturalHeight = 200;
    onload?: () => void;
    set src(_value: string) {
        queueMicrotask(() => this.onload?.());
    }
}

async function startLocalImageImport(fail = false, replace = false) {
    const originalImage = globalThis.Image;
    globalThis.Image = TransformImage as any;
    await setup("image");
    let finishUpload!: () => void;
    const gate = new Promise<void>((resolve) => {
        finishUpload = resolve;
    });
    let uploading = false;
    const preparedFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/v1/files" && init?.method === "POST") {
            uploading = true;
            await gate;
            return Response.json(fail ? { code: 1, msg: "本地文件上传失败" } : { code: 0, data: { id: "imported-file", url: "https://fixture.example/imported.png", bytes: 5, mimeType: "image/png" } });
        }
        return preparedFetch(input, init);
    }) as typeof fetch;
    if (replace) {
        await act(async () => host.querySelector('[data-node-id="reference"]')!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
        await act(async () => host.querySelector<HTMLButtonElement>('[data-toolbar-action="replace"]')!.click());
        await act(async () => document.querySelector<HTMLButtonElement>(".ant-modal .ant-btn-primary")!.click());
    }
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["image"], "import.png", { type: "image/png" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settleUntil(() => uploading);
    expect(uploading).toBe(true);
    return {
        finish: async () => {
            await act(async () => finishUpload());
        },
        cleanup: async () => {
            await act(async () => finishUpload());
            globalThis.Image = originalImage;
        },
    };
}

test("switching canvas during a local file upload discards the late imported node", async () => {
    const upload = await startLocalImageImport();
    try {
        await act(async () => host.querySelector<HTMLButtonElement>("[data-test-switch-canvas]")!.click());
        await settleUntil(() => host.querySelectorAll("[data-node-id]").length === 0);
        await upload.finish();
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(0);
        expect(savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "imported-file"))).toBe(false);
    } finally {
        await upload.cleanup();
    }
});

test.each([false, true])("local image upload persists the platform file (replace=%s)", async (replace) => {
    const upload = await startLocalImageImport(false, replace);
    try {
        await upload.finish();
        await settleUntil(() => savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "imported-file")));
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(replace ? 2 : 3);
        expect(savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "imported-file" && (!replace || node.id === "reference")))).toBe(true);
    } finally {
        await upload.cleanup();
    }
});

test.each([false, true])("a remote snapshot supersedes a pending local upload (replace=%s)", async (replace) => {
    const upload = await startLocalImageImport(false, replace);
    try {
        remoteProject = { ...structuredClone(project), revision: 2, remoteRevision: 2 };
        await act(async () => {
            await useCanvasStore.getState().fetchProjectFromBackend("project");
        });
        await upload.finish();
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(2);
        expect(savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "imported-file"))).toBe(false);
    } finally {
        await upload.cleanup();
    }
});

test.each([false, true])("failed local upload shows its error without changing nodes (replace=%s)", async (replace) => {
    const upload = await startLocalImageImport(true, replace);
    try {
        await upload.finish();
        await settleUntil(() => document.body.textContent?.includes("本地文件上传失败") === true);
        expect(document.body.textContent).toContain("本地文件上传失败");
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(2);
    } finally {
        await upload.cleanup();
    }
});

test("a changed account session discards a pending local upload without an unhandled error", async () => {
    const upload = await startLocalImageImport();
    try {
        await act(async () => useUserStore.setState({ token: "replacement-token" }));
        await upload.finish();
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(2);
        expect(savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "imported-file"))).toBe(false);
    } finally {
        await upload.cleanup();
    }
});

async function confirmImageTransform(kind: "crop" | "upscale", fail = false) {
    const originalImage = globalThis.Image;
    const originalContext = HTMLCanvasElement.prototype.getContext;
    const originalDataUrl = HTMLCanvasElement.prototype.toDataURL;
    globalThis.Image = TransformImage as any;
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as any;
    HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,aW1hZ2U=";
    await setup("image");
    const preparedFetch = globalThis.fetch;
    let finishUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
        finishUpload = resolve;
    });
    let uploading = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/v1/files" && init?.method === "POST") {
            uploading = true;
            await uploadGate;
            return Response.json(fail ? { code: 1, msg: "上传失败，请重试" } : { code: 0, data: { id: "transformed-file", url: "https://fixture.example/transformed.png", bytes: 5, mimeType: "image/png" } });
        }
        return String(input).startsWith("data:") ? originalFetch(input, init) : preparedFetch(input, init);
    }) as typeof fetch;
    const node = host.querySelector('[data-node-id="reference"]')!;
    await act(async () => node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    const tool = host.querySelector<HTMLButtonElement>(`button[data-toolbar-action="${kind}"]`)!;
    expect(tool).not.toBeNull();
    await act(async () => tool.click());
    const confirmation = [...document.querySelectorAll<HTMLButtonElement>(".ant-modal button")].find((button) => button.textContent?.includes(i18n.t(kind === "crop" ? "canvas.crop.confirm" : "canvas.upscale.generate")))!;
    expect(confirmation).toBeDefined();
    await act(async () => confirmation.click());
    await settleUntil(() => uploading);
    expect(uploading).toBe(true);
    return {
        confirmation,
        finishUpload: async () => {
            await act(async () => finishUpload());
        },
        cleanup: async () => {
            await act(async () => finishUpload());
            globalThis.Image = originalImage;
            HTMLCanvasElement.prototype.getContext = originalContext;
            HTMLCanvasElement.prototype.toDataURL = originalDataUrl;
        },
    };
}

test.each(["crop", "upscale"] as const)("confirming %s displays and saves a platform-backed image", async (kind) => {
    const transform = await confirmImageTransform(kind);
    try {
        expect(transform.confirmation.disabled).toBe(true);
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(2);
        await transform.finishUpload();
        await settleUntil(() => savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "transformed-file")));
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(3);
        const image = savedProjects.flatMap((saved) => saved.nodes).find((node) => node.metadata?.fileId === "transformed-file");
        expect(image?.metadata).toMatchObject({ fileId: "transformed-file", content: "https://fixture.example/transformed.png", storageKey: "" });
        expect(image!.width / image!.height).toBe(2);
    } finally {
        await transform.cleanup();
    }
});

test.each(["crop", "upscale"] as const)("failed %s upload keeps the dialog and publishes no local-only image", async (kind) => {
    const transform = await confirmImageTransform(kind, true);
    try {
        await transform.finishUpload();
        await settleUntil(() => Boolean(document.querySelector('[role="alert"]')));
        expect(document.querySelector('[role="alert"]')?.textContent).toContain("上传失败，请重试");
        expect(transform.confirmation.disabled).toBe(false);
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(2);
        expect(savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "transformed-file"))).toBe(false);
    } finally {
        await transform.cleanup();
    }
});

test.each(["crop", "upscale"] as const)("switching canvas during %s upload discards the late result", async (kind) => {
    const transform = await confirmImageTransform(kind);
    try {
        await act(async () => host.querySelector<HTMLButtonElement>("[data-test-switch-canvas]")!.click());
        await settleUntil(() => host.querySelectorAll("[data-node-id]").length === 0);
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(0);
        await transform.finishUpload();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(0);
        expect(savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "transformed-file"))).toBe(false);
    } finally {
        await transform.cleanup();
    }
});

test("a new account session during crop upload rejects the late result", async () => {
    const transform = await confirmImageTransform("crop");
    try {
        await act(async () => useUserStore.setState({ token: "replacement-token" }));
        await transform.finishUpload();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(2);
        expect(savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "transformed-file"))).toBe(false);
    } finally {
        await transform.cleanup();
    }
});

test("a remote revision removing the source during upscale upload rejects the late result", async () => {
    const transform = await confirmImageTransform("upscale");
    try {
        remoteProject = { ...structuredClone(project), revision: 2, remoteRevision: 2, nodes: [], connections: [] };
        await act(async () => {
            await useCanvasStore.getState().fetchProjectFromBackend("project");
        });
        await settleUntil(() => host.querySelectorAll("[data-node-id]").length === 0);
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(0);
        await transform.finishUpload();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(host.querySelectorAll("[data-node-id]")).toHaveLength(0);
        expect(savedProjects.some((saved) => saved.nodes.some((node) => node.metadata?.fileId === "transformed-file"))).toBe(false);
    } finally {
        await transform.cleanup();
    }
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

test("retrying a video result preserves its saved mode after the source config changes", async () => {
    await setup("video", true, true, "frames");
    const retry = host.querySelector<HTMLButtonElement>('[data-node-id="output"] [data-result-action="retry"]')!;
    expect(retry).not.toBeNull();
    await act(async () => retry.click());
    await settleUntil(() => Boolean(submitted));
    expect(submitted).toMatchObject({ modelProfileId: "profile", intent: { settings: { videoMode: "frames" } } });
});

test("resuming a timed-out video clears its stale error and materializes the original task", async () => {
    await setup("video", true, false, undefined, {
        status: "error",
        generationTaskId: "run-1",
        generationProfileId: "profile",
        generationTaskStatus: "running",
        errorDetails: "视频生成超时，请稍后重试",
    });
    await settleUntil(() => polls >= 2);
    const metadata = () =>
        useCanvasStore
            .getState()
            .openProject("project")
            ?.nodes.find((node) => node.id === "output")?.metadata;
    expect(submitted).toBeUndefined();
    expect(metadata()?.status).toBe("loading");
    expect(metadata()?.errorDetails).toBeUndefined();
    await act(async () => finishTask?.());
    await settleUntil(() => metadata()?.status === "success");
    expect(metadata()).toMatchObject({ status: "success", generationTaskStatus: "succeeded", fileId: "result-file" });
});

test("manual resume observes the original task after editor initialization", async () => {
    await setup("video", true, false, undefined, { status: "loading", generationTaskId: "run-1", generationProfileId: "profile", generationTaskStatus: "running" });
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
    await settleUntil(
        () =>
            useCanvasStore
                .getState()
                .openProject("project")
                ?.nodes.find((node) => node.id === "output")?.metadata?.status === "success",
    );
    expect(
        useCanvasStore
            .getState()
            .openProject("project")
            ?.nodes.find((node) => node.id === "output")?.metadata?.fileId,
    ).toBe("result-file");
});

async function checkCanvasImageResult(responseKind: "immediate-b64" | "immediate-url" | "polled-url" | "delayed-submit", count: number, failMetadata = false) {
    const originalImage = globalThis.Image;
    globalThis.Image = TransformImage as any;
    await setup("image");
    const preparedFetch = globalThis.fetch;
    const preparedAdapter = axios.defaults.adapter;
    const requests: { url: string; body: FormData; source: unknown }[] = [];
    const uploads: { url: string; body: FormData | { url: string; fileType: string } }[] = [];
    const patches: { metadata: string }[] = [];
    let releaseResult!: () => void;
    const resultGate = new Promise<void>((resolve) => (releaseResult = resolve));
    const isPolled = responseKind === "polled-url" || responseKind === "delayed-submit";
    const hasPlatformTask = responseKind !== "immediate-b64";
    const resultUrl = "https://fixture.example/generated.png";
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkXcAAAAASUVORK5CYII=";
    const terminalPayload =
        responseKind === "immediate-b64"
            ? { id: "task_fixture", object: "task", result: { created: 1791430575, data: [{ b64_json: b64 }], usage: { input_tokens: 1172, output_tokens: 397, total_tokens: 1569 } }, status: "completed" }
            : { status: "completed", result: { data: [{ url: resultUrl }] } };
    try {
        await act(async () => {
            useConfigStore.setState({
                publicSettings: { ...publicSettings, modelChannel: { ...publicSettings.modelChannel, availableModels: ["Images"], imageModels: ["Images"], defaultModel: "Images", defaultImageModel: "Images" } },
                config: { ...defaultConfig, channelMode: "remote", model: "Images", imageModel: "Images", count: String(count), canvasImageCount: String(count), channels: [] },
            });
        });
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.startsWith("data:")) return originalFetch(input, init);
            if (init?.method === "POST" && (url === "/api/v1/files" || url === "/api/v1/files/proxy-upload")) {
                uploads.push({ url, body: url.endsWith("proxy-upload") ? JSON.parse(String(init.body)) : (init.body as FormData) });
                return Response.json({ code: 0, data: { id: `generated-file-${uploads.length}`, url: resultUrl, bytes: 68, mimeType: "image/png" } });
            }
            return preparedFetch(input, init);
        }) as typeof fetch;
        axios.defaults.adapter = async (config) => {
            if (config.url?.includes("images/edits") && config.method === "post") {
                requests.push({ url: config.url, body: config.data, source: config.headers.get("X-Source") });
                const taskNumber = requests.length;
                if (responseKind === "delayed-submit") await resultGate;
                return { config, headers: hasPlatformTask ? { "x-generation-task-id": `platform-image-${taskNumber}` } : {}, status: 200, statusText: "OK", data: isPolled ? { id: `upstream-image-${taskNumber}`, status: "queued" } : terminalPayload };
            }
            if (config.url?.includes("/tasks/upstream-image-")) {
                polls++;
                return { config, headers: {}, status: 200, statusText: "OK", data: terminalPayload };
            }
            if (config.url?.match(/generation-tasks\/platform-image-\d+\/metadata$/)) {
                patches.push(JSON.parse(config.data));
                return { config, headers: {}, status: 200, statusText: "OK", data: failMetadata ? { code: 1, msg: "保存结果元数据失败" } : { code: 0, data: true } };
            }
            return (preparedAdapter as any)(config);
        };
        const source = host.querySelector('[data-node-id="reference"]')!;
        await act(async () => {
            (source.firstElementChild || source).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10 }));
            window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 10 }));
        });
        const prompt = host.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]')!;
        expect(prompt).not.toBeNull();
        await act(async () => {
            prompt.textContent = "替换背景";
            prompt.dispatchEvent(new InputEvent("input", { bubbles: true }));
        });
        const generate = host.querySelector<HTMLButtonElement>('button[aria-label="生成"]')!;
        expect(generate).not.toBeNull();
        expect(generate.disabled).toBe(false);
        await act(async () => generate.click());
        const generatedNodes = () =>
            useCanvasStore
                .getState()
                .openProject("project")
                ?.nodes.filter((node) => !["reference", "output"].includes(node.id)) ?? [];
        if (responseKind === "delayed-submit") {
            await settleUntil(() => savedProjects.some((saved) => saved.nodes.some((node) => !["reference", "output"].includes(node.id) && node.metadata?.status === "loading")));
            expect(savedProjects.some((saved) => saved.nodes.some((node) => !["reference", "output"].includes(node.id) && node.metadata?.status === "loading"))).toBe(true);
            expect(requests).toHaveLength(count);
            expect(polls).toBe(0);
            expect(generatedNodes().every((node) => node.metadata?.status === "loading")).toBe(true);
            await act(async () => releaseResult());
        }
        await settleUntil(() => generatedNodes().length === (count === 1 ? 1 : count + 1) && generatedNodes().every((node) => node.metadata?.status === (failMetadata ? "error" : "success")));
        expect(requests).toHaveLength(count);
        for (const request of requests) {
            expect(request.url).toBe("/api/v1/async/images/edits");
            expect(request.source).toBe("canvas");
            expect(request.body).toBeInstanceOf(FormData);
            expect(request.body.get("model")).toBe("Images");
            expect(request.body.get("image")).toBeInstanceOf(File);
        }
        expect(uploads).toHaveLength(count);
        expect(patches).toHaveLength(hasPlatformTask ? count : 0);
        expect(uploads.every(({ body }) => (body instanceof FormData ? body.get("fileType") : body.fileType) === "results/images")).toBe(true);
        expect(patches.map(({ metadata }) => JSON.parse(metadata).fileIds[0]).sort()).toEqual(hasPlatformTask ? uploads.map((_, index) => `generated-file-${index + 1}`) : []);
        expect(polls).toBe(isPolled ? count : 0);
        expect(generatedNodes()).toHaveLength(count === 1 ? 1 : count + 1);
        if (failMetadata) {
            const result = generatedNodes()[0];
            expect(result.metadata).toMatchObject({ status: "error", generationPollingPaused: true, errorDetails: "保存结果元数据失败", upstreamTaskId: "upstream-image-1", platformTaskId: "platform-image-1" });
            expect(result.metadata?.content).toBeUndefined();
            expect(result.metadata?.fileId).toBeUndefined();
            expect(host.textContent).toContain("保存结果元数据失败");
            const resultNode = host.querySelector(`[data-node-id="${result.id}"]`)!;
            await act(async () => {
                (resultNode.firstElementChild || resultNode).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 250 }));
                window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 250 }));
            });
            const resume = host.querySelector<HTMLButtonElement>('button[aria-label="恢复查询"]')!;
            expect(resume).not.toBeNull();
            failMetadata = false;
            await act(async () => resume.click());
            await settleUntil(() => generatedNodes()[0].metadata?.status === "success");
            expect(generatedNodes()[0].metadata).toMatchObject({ status: "success", fileId: "generated-file-2", upstreamTaskId: "upstream-image-1", platformTaskId: "platform-image-1" });
            expect(requests).toHaveLength(1);
            expect(polls).toBe(2);
            expect(patches).toHaveLength(2);
        }
        if (count > 1) {
            const toggle = host.querySelector<HTMLButtonElement>("[data-batch-toggle]")!;
            expect(toggle).not.toBeNull();
            await act(async () => toggle.click());
            await settleUntil(() => generatedNodes().every((node) => host.querySelector(`[data-node-id="${node.id}"] img`)));
        }
        for (const node of generatedNodes()) {
            expect(node.metadata).toMatchObject({ status: "success", content: resultUrl, mimeType: "image/png" });
            expect(node.metadata?.fileId).toMatch(/^generated-file-/);
            expect(node.width / node.height).toBe(2);
            const image = host.querySelector<HTMLImageElement>(`[data-node-id="${node.id}"] img`);
            expect(image?.getAttribute("src")).toBe(resultUrl);
        }
    } finally {
        releaseResult();
        globalThis.Image = originalImage;
    }
}

test.each([
    ["immediate-b64", 1],
    ["immediate-url", 1],
    ["polled-url", 1],
    ["immediate-b64", 2],
    ["immediate-url", 2],
    ["polled-url", 2],
    ["delayed-submit", 2],
] as const)("Images editing an uploaded source materializes and displays every result (%s, count=%s)", async (responseKind, count) => checkCanvasImageResult(responseKind, count));

test("metadata failure after a successful Images upload pauses the result and resumes its original task", async () => checkCanvasImageResult("polled-url", 1, true));
