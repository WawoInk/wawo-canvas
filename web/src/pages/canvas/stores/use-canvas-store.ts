import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";
import { useUserStore } from "@/stores/use-user-store";
import { syncClient } from "@/services/sync-client";
import { fireCreateProject, fireRenameProject, scheduleBackendSync, flushProjectSync, registerBeforeUnloadFlush, registerSyncDeltaHandler, detectDataChanges, clearSyncTimers, parseProjectJson } from "./canvas-sync";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    synced: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    clearProjects: () => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport" | "updatedAt" | "title">>) => void;
    syncFromBackend: () => Promise<void>;
    fetchProjectFromBackend: (id: string) => Promise<CanvasProject | null>;
    flushProjectSync: (id: string) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";

// ─── Persist storage adapter (user-scoped) ───────────────────────────

function userStoreKey(name: string) {
    const userId = useUserStore.getState().user?.id;
    return userId ? `${name}:${userId}` : name;
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return null;
        const value = await localForageStorage.getItem(userStoreKey(name));
        if (!value) return null;
        return JSON.parse(value) as StorageValue<CanvasStore>;
    },
    setItem: (name, value) => {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return;
        void localForageStorage.setItem(userStoreKey(name), JSON.stringify(value));
    },
    removeItem: (name) => localForageStorage.removeItem(userStoreKey(name)),
};

// ─── Store ──────────────────────────────────────────────────────────────

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => {
            // ponytail: register beforeunload once, keyed to this store instance
            registerBeforeUnloadFlush({ getState: get });

            return {
                hydrated: false,
                synced: false,
                projects: [],

                createProject: (title = "未命名画布") => {
                    const now = new Date().toISOString();
                    const id = nanoid();
                    const project: CanvasProject = {
                        id,
                        title,
                        createdAt: now,
                        updatedAt: now,
                        nodes: [],
                        connections: [],
                        chatSessions: [],
                        activeChatId: null,
                        backgroundMode: "lines",
                        showImageInfo: false,
                        viewport: initialViewport,
                    };
                    set((state) => ({ projects: [project, ...state.projects] }));
                    fireCreateProject(project, { getState: get, setState: set } as any);
                    return id;
                },

                importProject: (source) => {
                    const now = new Date().toISOString();
                    const project: CanvasProject = {
                        id: nanoid(),
                        title: source.title || "导入画布",
                        createdAt: source.createdAt || now,
                        updatedAt: now,
                        nodes: source.nodes || [],
                        connections: source.connections || [],
                        chatSessions: source.chatSessions || [],
                        activeChatId: source.activeChatId || null,
                        backgroundMode: source.backgroundMode || "lines",
                        showImageInfo: source.showImageInfo || false,
                        viewport: source.viewport || initialViewport,
                    };
                    set((state) => ({ projects: [project, ...state.projects] }));
                    fireCreateProject(project, { getState: get, setState: set } as any);
                    return project.id;
                },

                openProject: (id) => get().projects.find((item) => item.id === id) || null,

                fetchProjectFromBackend: async (id: string) => {
                    const token = useUserStore.getState().token;
                    if (!token) return null;
                    try {
                        const { fetchCanvasProject } = await import("@/services/api/canvas-projects");
                        const detail = await fetchCanvasProject(id);
                        const parsed = parseProjectJson(detail.projectJson);
                        const project: CanvasProject = {
                            id: detail.id,
                            title: parsed.title || detail.name || "未命名画布",
                            createdAt: detail.createdAt || "",
                            updatedAt: detail.updatedAt || "",
                            nodes: parsed.nodes || [],
                            connections: parsed.connections || [],
                            chatSessions: parsed.chatSessions || [],
                            activeChatId: parsed.activeChatId ?? null,
                            backgroundMode: parsed.backgroundMode || "lines",
                            showImageInfo: parsed.showImageInfo ?? false,
                            viewport: parsed.viewport || initialViewport,
                        };
                        set((state) => {
                            const existing = state.projects.find((p) => p.id === id);
                            if (existing) {
                                return { projects: state.projects.map((p) => (p.id === id ? { ...p, ...project, updatedAt: detail.updatedAt || p.updatedAt } : p)) };
                            }
                            return { projects: [...state.projects, project] };
                        });
                        return project;
                    } catch {
                        return null;
                    }
                },

                flushProjectSync: (id: string) => flushProjectSync(id, { getState: get }),

                renameProject: (id, title) =>
                    set((state) => ({
                        projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title } : project)),
                    })),

                deleteProjects: (ids) => set((state) => ({ projects: state.projects.filter((project) => !ids.includes(project.id)) })),

                replaceProjects: (projects) => set({ projects }),

                updateProject: (id, patch) =>
                    set((state) => ({
                        projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch } : project)),
                    })),

                syncFromBackend: async () => {
                    const user = useUserStore.getState().user;
                    if (!user?.id) return;
                    const token = useUserStore.getState().token;
                    if (!token) return;
                    try {
                        const { fetchCanvasProjects, fetchCanvasProject } = await import("@/services/api/canvas-projects");
                        const serverProjects = await fetchCanvasProjects();
                        if (!serverProjects || !serverProjects.length) {
                            set({ projects: [], synced: true });
                            return;
                        }
                        const details = await Promise.allSettled(serverProjects.map((p) => fetchCanvasProject(p.id)));
                        const map = new Map(get().projects.map((p) => [p.id, p]));
                        for (const result of details) {
                            if (result.status !== "fulfilled") continue;
                            const d = result.value;
                            const existing = map.get(d.id);
                            if (existing && (d.updatedAt || "") <= (existing.updatedAt || "")) continue;
                            const parsed = parseProjectJson(d.projectJson);
                            map.set(d.id, {
                                id: d.id,
                                title: parsed.title || d.name || existing?.title || "未命名画布",
                                createdAt: d.createdAt || existing?.createdAt || "",
                                updatedAt: d.updatedAt || existing?.updatedAt || "",
                                nodes: parsed.nodes || existing?.nodes || [],
                                connections: parsed.connections || existing?.connections || [],
                                chatSessions: parsed.chatSessions || existing?.chatSessions || [],
                                activeChatId: parsed.activeChatId ?? existing?.activeChatId ?? null,
                                backgroundMode: parsed.backgroundMode || existing?.backgroundMode || "lines",
                                showImageInfo: parsed.showImageInfo ?? existing?.showImageInfo ?? false,
                                viewport: parsed.viewport || existing?.viewport || { x: 0, y: 0, k: 1 },
                            });
                        }
                        const serverIds = new Set(serverProjects.map((p) => p.id));
                        set({ projects: Array.from(map.values()).filter((p) => serverIds.has(p.id)), synced: true });
                    } catch (err) {
                        console.warn("canvas: backend sync failed, falling back to local cache", err);
                        set({ synced: true });
                    }
                },

                clearProjects: () => {
                    clearSyncTimers();
                    set({ projects: [], hydrated: false, synced: false });
                },
            };
        },
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) => ({ projects: state.projects }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
                // ponytail: register sync delta handler after store is hydrated
                registerSyncDeltaHandler(useCanvasStore.getState());
                void useCanvasStore.getState().syncFromBackend();
                void syncClient.syncDomain("canvas");
            },
        },
    ),
);

// ── Subscribe to fire backend sync on rename/delete/update ────────────

let prevProjects: CanvasProject[] = [];
useCanvasStore.subscribe((state) => {
    const { sync, rename } = detectDataChanges(prevProjects, state.projects);
    for (const projectId of sync) scheduleBackendSync(projectId, { getState: () => useCanvasStore.getState() });
    for (const { id, title } of rename) fireRenameProject(id, title, { getState: () => useCanvasStore.getState() });
    prevProjects = state.projects;
});

// ── Subscribe to user changes (logout / switch user) ─────────────────

if (typeof window !== "undefined") {
    let lastUserId: string | undefined = useUserStore.getState().user?.id;
    useUserStore.subscribe((state) => {
        const currentId = state.user?.id;
        if (currentId === lastUserId) return;
        lastUserId = currentId;

        useCanvasStore.getState().clearProjects();

        if (currentId) {
            void useCanvasStore.persist.rehydrate()?.then(() => {
                const store = useCanvasStore.getState();
                if (!store.hydrated) useCanvasStore.setState({ hydrated: true });
                registerSyncDeltaHandler(store);
                void useCanvasStore.getState().syncFromBackend();
                void syncClient.syncDomain("canvas");
            });
        }
    });
}
