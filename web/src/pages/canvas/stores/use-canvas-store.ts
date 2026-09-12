import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { createAccountStorage, isCurrentSession } from "@/lib/account-storage";
import { localForageStorage } from "@/lib/localforage-storage";
import { useUserStore } from "@/stores/use-user-store";
import { syncClient } from "@/services/sync-client";
import { fireCreateProject, fireDeleteProjects, scheduleBackendSync, flushProjectSync, registerBeforeUnloadFlush, registerSyncDeltaHandler, resumePendingCanvasSync, detectDataChanges, clearSyncTimers } from "./canvas-sync";
import { mergeCanvasReplicaRemote, transitionCanvasReplica, transitionCanvasReplicaState, type CanvasProjectPatch, type ReplicaCanvasProject } from "./canvas-replica";

export type CanvasProject = ReplicaCanvasProject;

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
    updateProject: (id: string, patch: CanvasProjectPatch, expectedRemoteRevision?: number) => Promise<boolean>;
    waitForLocalPersistence: () => Promise<void>;
    acknowledgeProject: (id: string, localVersion: number, patch: Pick<CanvasProject, "revision" | "updatedAt">) => void;
    acknowledgeDelete: (id: string) => void;
    syncFromBackend: () => Promise<void>;
    fetchProjectFromBackend: (id: string) => Promise<CanvasProject | null>;
    flushProjectSync: (id: string) => void;
    resolveProjectConflict: (id: string) => Promise<string | null>;
};

const initialViewport: CanvasProject["viewport"] = { x: 0, y: 0, k: 1 };
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
                        if (!isCurrentSession(session, { token: current.token, userId: current.user?.id }) || get().tombstones.includes(id)) return null;
                        const existing = get().openProject(id);
                        const project = mergeCanvasReplicaRemote({ projects: existing ? [existing] : [], tombstones: [], updates: [detail] }).projects[0];
                        if (!project) return null;
                        if (project === existing) return existing;
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

                resolveProjectConflict: async (id) => {
                    const auth = useUserStore.getState();
                    if (!auth.token || !auth.user?.id || !get().openProject(id)?.syncConflict) return null;
                    const session = { token: auth.token, userId: auth.user.id };
                    const { fetchCanvasProject } = await import("@/services/api/canvas-projects");
                    const detail = await fetchCanvasProject(id);
                    const current = useUserStore.getState();
                    if (!isCurrentSession(session, { token: current.token, userId: current.user?.id })) return null;
                    const local = get().openProject(id);
                    if (!local?.syncConflict || get().tombstones.includes(id)) return null;
                    const copy = { ...local, id: nanoid(), title: i18n.t("canvas.sync.localCopyTitle", { title: local.title }), revision: 0, remoteRevision: 0, localVersion: 1, dirty: true, syncConflict: false };
                    const remote = mergeCanvasReplicaRemote({ projects: [local], tombstones: [], updates: [detail], force: true }).projects[0]!;
                    // Both versions enter the same durable snapshot; never discard local work to resolve a conflict.
                    set((state) => ({ projects: [copy, ...state.projects.map((project) => (project.id === id ? remote : project))] }));
                    await waitForCanvasPersistence();
                    if (isCurrentSession(session, { token: useUserStore.getState().token, userId: useUserStore.getState().user?.id })) fireCreateProject(copy, { getState: get });
                    return copy.id;
                },

                renameProject: (id, title) =>
                    set((state) => ({
                        projects: state.projects.map((project) => (project.id === id && title.trim() ? transitionCanvasReplica(project, { type: "edit", patch: { title: title.trim() } }).project : project)),
                    })),

                deleteProjects: (ids) => {
                    set((state) => transitionCanvasReplicaState(state, { type: "delete", ids }));
                    fireDeleteProjects(ids, { getState: get });
                },

                replaceProjects: (projects) => set({ projects }),

                updateProject: async (id, patch, expectedRemoteRevision) => {
                    const project = get().openProject(id);
                    if (!project) return false;
                    const update = transitionCanvasReplica(project, { type: "edit", patch, expectedRemoteRevision });
                    if (!update.accepted) return false;
                    if (!update.changed) {
                        await waitForCanvasPersistence();
                        return true;
                    }
                    set((state) => ({
                        projects: state.projects.map((project) => (project.id === id ? update.project : project)),
                    }));
                    await waitForCanvasPersistence();
                    return true;
                },

                waitForLocalPersistence: waitForCanvasPersistence,

                acknowledgeProject: (id, localVersion, patch) =>
                    set((state) => ({
                        projects: state.projects.map((project) => (project.id === id ? transitionCanvasReplica(project, { type: "acknowledge-save", localVersion, revision: patch.revision, updatedAt: patch.updatedAt }).project : project)),
                    })),

                acknowledgeDelete: (id) => set((state) => transitionCanvasReplicaState(state, { type: "acknowledge-delete", id })),

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
                        const updates = details.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
                        set({ projects: mergeCanvasReplicaRemote({ projects: get().projects, tombstones: get().tombstones, updates }).projects, synced: true });
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
                const restored = transitionCanvasReplicaState({ projects: [], tombstones: [] }, { type: "restore", persisted: saved });
                return {
                    ...current,
                    ...restored,
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
