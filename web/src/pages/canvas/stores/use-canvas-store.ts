import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { createAccountStorage, isCurrentSession } from "@/lib/account-storage";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";
import { useUserStore } from "@/stores/use-user-store";
import { syncClient } from "@/services/sync-client";
import { fireCreateProject, fireDeleteProjects, scheduleBackendSync, flushProjectSync, registerBeforeUnloadFlush, registerSyncDeltaHandler, resumePendingCanvasSync, detectDataChanges, clearSyncTimers, parseProjectJson } from "./canvas-sync";
import { normalizeCanvasProject } from "./canvas-replica";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    localVersion: number;
    dirty: boolean;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasStore = {
    hydrated: boolean;
    synced: boolean;
    projects: CanvasProject[];
    tombstones: string[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    clearProjects: () => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport" | "updatedAt" | "title">>) => Promise<void>;
    waitForLocalPersistence: () => Promise<void>;
    acknowledgeProject: (id: string, localVersion: number, patch: Pick<CanvasProject, "revision" | "updatedAt">) => void;
    acknowledgeDelete: (id: string) => void;
    syncFromBackend: () => Promise<void>;
    fetchProjectFromBackend: (id: string) => Promise<CanvasProject | null>;
    flushProjectSync: (id: string) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
let switchingAccount = false;
const scopedStorage = createAccountStorage(
    localForageStorage,
    () => useUserStore.getState().user?.id,
    () => !switchingAccount,
);

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await scopedStorage.getItem(name);
        if (!value) return null;
        return JSON.parse(value) as StorageValue<CanvasStore>;
    },
    setItem: (name, value) => scopedStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => scopedStorage.removeItem(name),
};

async function waitForCanvasPersistence() {
    await Promise.resolve();
    await scopedStorage.flush(CANVAS_STORE_KEY);
}

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
                tombstones: [],

                createProject: (title = i18n.t("canvas.editor.project.untitled")) => {
                    const now = new Date().toISOString();
                    const id = nanoid();
                    const project: CanvasProject = {
                        id,
                        title,
                        createdAt: now,
                        updatedAt: now,
                        revision: 0,
                        localVersion: 1,
                        dirty: true,
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
                        title: source.title || i18n.t("canvas.editor.project.imported"),
                        createdAt: source.createdAt || now,
                        updatedAt: now,
                        revision: 0,
                        localVersion: 1,
                        dirty: true,
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
                    const userId = useUserStore.getState().user?.id;
                    if (!token || !userId) return null;
                    const session = { token, userId };
                    try {
                        const { fetchCanvasProject } = await import("@/services/api/canvas-projects");
                        const detail = await fetchCanvasProject(id);
                        const current = useUserStore.getState();
                        if (!isCurrentSession(session, { token: current.token, userId: current.user?.id })) return null;
                        const parsed = parseProjectJson(detail.projectJson);
                        const project: CanvasProject = normalizeCanvasProject({
                            ...parsed,
                            id: detail.id,
                            title: parsed.title || detail.name,
                            createdAt: detail.createdAt,
                            updatedAt: detail.updatedAt,
                            revision: detail.revision,
                            localVersion: 0,
                            dirty: false,
                        })!;
                        set((state) => {
                            const existing = state.projects.find((p) => p.id === id);
                            if (existing?.dirty) return {};
                            if (existing) {
                                return { projects: state.projects.map((p) => (p.id === id ? project : p)) };
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
                        projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, localVersion: project.localVersion + 1, dirty: true } : project)),
                    })),

                deleteProjects: (ids) => {
                    set((state) => ({ projects: state.projects.filter((project) => !ids.includes(project.id)), tombstones: [...new Set([...state.tombstones, ...ids])] }));
                    fireDeleteProjects(ids, { getState: get });
                },

                replaceProjects: (projects) => set({ projects }),

                updateProject: async (id, patch) => {
                    set((state) => ({
                        projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, localVersion: project.localVersion + 1, dirty: true } : project)),
                    }));
                    await waitForCanvasPersistence();
                },

                waitForLocalPersistence: waitForCanvasPersistence,

                acknowledgeProject: (id, localVersion, patch) =>
                    set((state) => ({
                        projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, dirty: project.localVersion !== localVersion } : project)),
                    })),

                acknowledgeDelete: (id) => set((state) => ({ tombstones: state.tombstones.filter((item) => item !== id) })),

                syncFromBackend: async () => {
                    const user = useUserStore.getState().user;
                    if (!user?.id) return;
                    const token = useUserStore.getState().token;
                    if (!token) return;
                    const session = { token, userId: user.id };
                    try {
                        const { fetchCanvasProjects, fetchCanvasProject } = await import("@/services/api/canvas-projects");
                        const serverProjects = await fetchCanvasProjects();
                        if (!serverProjects || !serverProjects.length) {
                            set({ synced: true });
                            return;
                        }
                        const tombstones = new Set(get().tombstones);
                        const details = await Promise.allSettled(serverProjects.filter((project) => !tombstones.has(project.id)).map((p) => fetchCanvasProject(p.id)));
                        const current = useUserStore.getState();
                        if (!isCurrentSession(session, { token: current.token, userId: current.user?.id })) return;
                        const map = new Map(
                            get()
                                .projects.filter((project) => !tombstones.has(project.id))
                                .map((p) => [p.id, p]),
                        );
                        for (const result of details) {
                            if (result.status !== "fulfilled") continue;
                            const d = result.value;
                            const existing = map.get(d.id);
                            if (existing?.dirty || (existing && d.revision <= existing.revision)) continue;
                            const parsed = parseProjectJson(d.projectJson);
                            map.set(
                                d.id,
                                normalizeCanvasProject({
                                    ...existing,
                                    ...parsed,
                                    id: d.id,
                                    title: parsed.title || d.name || existing?.title,
                                    createdAt: d.createdAt || existing?.createdAt,
                                    updatedAt: d.updatedAt || existing?.updatedAt,
                                    revision: d.revision || existing?.revision,
                                    localVersion: existing?.localVersion || 0,
                                    dirty: false,
                                })!,
                            );
                        }
                        set({ projects: Array.from(map.values()), synced: true });
                    } catch (err) {
                        console.warn("canvas: backend sync failed, falling back to local cache", err);
                        set({ synced: true });
                    }
                },

                clearProjects: () => {
                    clearSyncTimers();
                    set({ projects: [], tombstones: [], hydrated: false, synced: false });
                },
            };
        },
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) => ({ projects: state.projects, tombstones: state.tombstones }) as StorageValue<CanvasStore>["state"],
            merge: (persisted, current) => {
                const saved = persisted as Partial<CanvasStore> | undefined;
                return {
                    ...current,
                    projects: Array.isArray(saved?.projects) ? saved.projects.map(normalizeCanvasProject).filter((project): project is CanvasProject => project !== null) : [],
                    tombstones: Array.isArray(saved?.tombstones) ? [...new Set(saved.tombstones.filter((id): id is string => typeof id === "string" && Boolean(id)))] : [],
                };
            },
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
                // ponytail: register sync delta handler after store is hydrated
                registerSyncDeltaHandler({ getState: () => useCanvasStore.getState() });
                resumePendingCanvasSync({ getState: () => useCanvasStore.getState() });
                void useCanvasStore.getState().syncFromBackend();
                void syncClient.syncDomain("canvas");
            },
        },
    ),
);

// ── Subscribe to fire backend sync on rename/delete/update ────────────

let prevProjects: CanvasProject[] = [];
useCanvasStore.subscribe((state) => {
    const { sync } = detectDataChanges(prevProjects, state.projects);
    for (const projectId of sync) scheduleBackendSync(projectId, { getState: () => useCanvasStore.getState() });
    prevProjects = state.projects;
});

// ── Subscribe to user changes (logout / switch user) ─────────────────

if (typeof window !== "undefined") {
    let lastUserId: string | undefined = useUserStore.getState().user?.id;
    useUserStore.subscribe((state) => {
        const currentId = state.user?.id;
        if (currentId === lastUserId) return;
        lastUserId = currentId;

        switchingAccount = true;
        useCanvasStore.getState().clearProjects();
        switchingAccount = false;

        if (currentId) {
            void useCanvasStore.persist.rehydrate()?.then(() => {
                const store = useCanvasStore.getState();
                if (!store.hydrated) useCanvasStore.setState({ hydrated: true });
                registerSyncDeltaHandler({ getState: () => useCanvasStore.getState() });
                resumePendingCanvasSync({ getState: () => useCanvasStore.getState() });
                void useCanvasStore.getState().syncFromBackend();
                void syncClient.syncDomain("canvas");
            });
        }
    });
}
