import "./register-dom";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, mock, test } from "bun:test";
import axios from "axios";
import { App } from "antd";
import i18n from "../src/i18n";
import { CanvasSyncConflict } from "../src/pages/canvas/project/canvas-sync-conflict";
await i18n.changeLanguage("zh-CN");
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
const { clearSyncTimers } = await import("../src/pages/canvas/stores/canvas-sync");
const { useCanvasEditorReplica } = await import("../src/pages/canvas/project/use-canvas-editor-replica");
import type { CanvasProject } from "../src/pages/canvas/stores/use-canvas-store";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const base: CanvasProject = {
    id: "project",
    title: "画布",
    createdAt: "",
    updatedAt: "",
    revision: 1,
    remoteRevision: 1,
    localVersion: 0,
    dirty: false,
    nodes: [],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
};
const media: CanvasProject["nodes"] = [{ id: "video", title: "视频", type: "video" as never, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { fileId: "video-file" } }];
let root: Root;
let host: HTMLDivElement;
const originalAdapter = axios.defaults.adapter;
let remote = { ...base };
let hydrate = async (project: CanvasProject) => project;
let savedEditor: ReturnType<typeof useCanvasEditorReplica>;

function Editor() {
    const [display, setDisplay] = useState<CanvasProject>(base);
    const editor = useCanvasEditorReplica("project", { hydrate, apply: setDisplay, onMissing: () => {} });
    savedEditor = editor;
    useEffect(() => {
        if (editor.ready) void editor.save({ nodes: display.nodes });
    }, [editor.ready, editor.save, display.nodes]);
    return (
        <>
            <div data-display>{editor.ready ? display.nodes.map((node) => node.id).join(",") || "empty" : "loading"}</div>
            <CanvasSyncConflict projectId="project" />
        </>
    );
}

async function setup() {
    useUserStore.setState({ user: { id: "editor-account" } as never, token: "", isReady: true });
    await useCanvasStore.persist.rehydrate();
    useCanvasStore.setState({ projects: [structuredClone(base)], tombstones: [], hydrated: true, synced: true });
    remote = structuredClone(base);
    axios.defaults.adapter = async (config) => {
        if (config.method === "put") {
            const input = JSON.parse(config.data);
            remote = { ...input.project, revision: remote.revision + 1 };
        }
        const detail = { ...remote, projectJson: JSON.stringify(remote) };
        return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: config.url?.endsWith("/project") ? detail : [detail], msg: "" } };
    };
    useUserStore.setState({ token: "fixture-token" });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root.render(
            <App>
                <Editor />
            </App>,
        );
    });
}
async function pull() {
    await act(async () => {
        await useCanvasStore.getState().syncFromBackend();
    });
}
afterEach(async () => {
    if (root) await act(async () => root.unmount());
    host?.remove();
    clearSyncTimers();
    useUserStore.setState({ token: "", user: null });
    axios.defaults.adapter = originalAdapter;
    hydrate = async (project) => project;
});

test("remote media replaces the editor display and an older editor cannot save over it", async () => {
    await setup();
    const staleEditor = savedEditor;
    remote = { ...base, revision: 5, nodes: media };
    await pull();
    expect(host.textContent).toBe("video");
    await act(async () => {
        await staleEditor.save({ nodes: [] });
    });
    expect(useCanvasStore.getState().openProject("project")).toMatchObject({ nodes: media, dirty: false });
});

test("an older async media restore cannot replace a newer remote snapshot", async () => {
    await setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    hydrate = async (project) => {
        if (project.revision === 2) await gate;
        return project;
    };
    remote = { ...base, revision: 2, nodes: [{ ...media[0], id: "old-video" }] };
    await pull();
    remote = { ...base, revision: 3, nodes: media };
    await pull();
    await act(async () => {
        release();
        await gate;
    });
    expect(host.textContent).toBe("video");
    expect(useCanvasStore.getState().openProject("project")).toMatchObject({ nodes: media, dirty: false });
});

test("resolving display URLs on open is not a new Canvas edit", async () => {
    hydrate = async (project) => ({ ...project, nodes: project.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "https://display.example/fresh" } })) });
    await setup();
    remote = { ...base, revision: 5, nodes: media };
    await pull();
    expect(host.textContent).toBe("video");
    expect(useCanvasStore.getState().openProject("project")).toMatchObject({ localVersion: 0, dirty: false, nodes: media });
});

test("a save acknowledgement does not reload the editor or block the next edit", async () => {
    await setup();
    await act(async () => {
        await savedEditor.save({ title: "first" });
    });
    await act(async () => {
        await savedEditor.save({ title: "second" });
    });
    expect(useCanvasStore.getState().openProject("project")?.title).toBe("second");
    expect(savedEditor.ready).toBe(true);
});

test("the conflict action keeps a local copy and loads the cloud version", async () => {
    await setup();
    remote = { ...base, revision: 5, nodes: media };
    await act(async () => {
        useCanvasStore.setState({ projects: [{ ...base, title: "本地作品", dirty: true, syncConflict: true }] });
    });
    expect(host.textContent).toContain("自动上传已暂停");
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent?.includes("保留本地副本并加载云端"))!;
    expect(button).toBeDefined();
    await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(host.querySelector("[data-display]")?.textContent).toBe("video");
    expect(useCanvasStore.getState().projects.find((item) => item.id !== "project")).toMatchObject({ title: "本地作品（本地冲突副本）", nodes: [] });
    expect(useCanvasStore.getState().openProject("project")).toMatchObject({ nodes: media, dirty: false, syncConflict: false });
});
