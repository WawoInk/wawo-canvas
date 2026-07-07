import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { message } from "antd";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";
import {
    createCanvasProject,
    deleteCanvasProject,
    updateCanvasProject,
} from "@/services/api/canvas-projects";
import { ApiError } from "@/services/api/request";
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";
import { useUserStore } from "@/stores/use-user-store";

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
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    clearProjects: () => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
    /** Triggered after hydration to pull backend projects and replace local state. */
    syncFromBackend: () => Promise<void>;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";

// ─── Debounced update timers (prevent API flood during editing) ──────────
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SYNC_DEBOUNCE_MS = 4000;

function scheduleBackendSync(projectId: string) {
    const existing = syncTimers.get(projectId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
        syncTimers.delete(projectId);
        const state = useCanvasStore.getState();
        const project = state.projects.find((p) => p.id === projectId);
        if (!project) return;
        const user = useUserStore.getState().user;
        if (!user?.id) return;
        syncScheduler.markActivity();
        updateCanvasProject(projectId, {
            project,
            expectedUpdatedAt: project.updatedAt,
        } as unknown).catch((err) => {
            // ponytail: 乐观锁冲突 — 触发 domain 全量同步拉取最新
            if (err instanceof ApiError && err.status === 409) {
                void syncClient.syncDomain("canvas");
                message.warning("画布已被其他会话修改，已刷新为最新版本");
            }
        });
    }, SYNC_DEBOUNCE_MS);

    syncTimers.set(projectId, timer);
}

// ─── Non-blocking backend operations (fire-and-log; local state always wins) ──

function fireCreateProject(project: CanvasProject) {
    const user = useUserStore.getState().user;
    if (!user?.id) return;
    createCanvasProject(project.title, project).catch(() => {});
}

function fireDeleteProjects(ids: string[]) {
    const user = useUserStore.getState().user;
    if (!user?.id) return;
    for (const id of ids) {
        syncTimers.get(id) && clearTimeout(syncTimers.get(id));
        syncTimers.delete(id);
        deleteCanvasProject(id).catch(() => {});
    }
}

function fireRenameProject(id: string, title: string) {
    const user = useUserStore.getState().user;
    if (!user?.id) return;
    const project = useCanvasStore.getState().projects.find((p) => p.id === id);
    if (!project) return;
    updateCanvasProject(id, {
        project: { ...project, title },
        expectedUpdatedAt: project.updatedAt,
    } as unknown).catch(() => {});
}

// ─── beforeunload flush ─────────────────────────────────────────────────

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
        const state = useCanvasStore.getState();
        const user = useUserStore.getState().user;
        const token = useUserStore.getState().token;
        if (!user?.id || !token) return;
        for (const project of state.projects) {
            // ponytail: expectedUpdatedAt 必须与 project 同级，handler 从顶层字段读取
            fetch(`/api/v1/canvas/projects/${encodeURIComponent(project.id)}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    project: {
                        id: project.id,
                        title: project.title,
                        createdAt: project.createdAt,
                        updatedAt: project.updatedAt,
                        nodes: project.nodes,
                        connections: project.connections,
                        chatSessions: project.chatSessions,
                        activeChatId: project.activeChatId,
                        backgroundMode: project.backgroundMode,
                        showImageInfo: project.showImageInfo,
                        viewport: project.viewport,
                    },
                    expectedUpdatedAt: project.updatedAt,
                }),
                keepalive: true,
            }).catch(() => {});
        }
    });
}

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
        (set, get) => ({
            hydrated: false,
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
                fireCreateProject(project);
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
                fireCreateProject(project);
                return project.id;
            },

            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },

            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) =>
                        project.id === id
                            ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() }
                            : project,
                    ),
                })),
            // Fire rename without debounce (infrequent operation)
            // Handled via a subscribe wrapper below

            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            // Fire delete below

            replaceProjects: (projects) => set({ projects }),

            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) =>
                        project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project,
                    ),
                })),

            syncFromBackend: async () => {
                const user = useUserStore.getState().user;
                if (!user?.id) return;
                // ponytail: 服务端为 source of truth — delta 直接覆盖本地
                await syncClient.syncDomain("canvas");
            },

            clearProjects: () => {
                // Clear all pending sync timers
                for (const timer of syncTimers.values()) clearTimeout(timer);
                syncTimers.clear();
                set({ projects: [], hydrated: false });
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
                // ponytail: rehydrate 后立即拉一次服务端 delta
                void syncClient.syncDomain("canvas");
            },
        },
    ),
);

// ── Sync delta 回调：服务端增量覆盖本地（server is source of truth） ──
syncClient.onDelta("canvas", (data) => {
    if (!data) return;

    const state = useCanvasStore.getState();

    if (data.updates && data.updates.length > 0) {
        const map = new Map(state.projects.map((p) => [p.id, p]));
        for (const item of data.updates) {
            const existing = map.get(item.id);
            if (existing) {
                // ponytail: 仅当 server updatedAt 更新时才覆盖，防止覆盖本地尚未推送的编辑
                if ((item.updatedAt || "") > (existing.updatedAt || "")) {
                    map.set(item.id, fromServerProject(item, existing));
                }
            } else {
                map.set(item.id, fromServerProject(item, null));
            }
        }
        useCanvasStore.setState({ projects: Array.from(map.values()) });
    }

    if (data.deletes && data.deletes.length > 0) {
        const deleteSet = new Set(data.deletes);
        useCanvasStore.setState((s) => ({
            projects: s.projects.filter((p) => !deleteSet.has(p.id)),
        }));
    }
});

function fromServerProject(item: { id: string; name?: string; projectJson?: string; createdAt?: string; updatedAt?: string }, local: CanvasProject | null): CanvasProject {
    let parsed: Partial<CanvasProject> = {};
    if (item.projectJson) {
        try {
            parsed = JSON.parse(item.projectJson);
        } catch { /* malformed JSON — fall through to local/defaults */ }
    }
    return {
        id: item.id,
        title: parsed.title || item.name || local?.title || "未命名画布",
        createdAt: item.createdAt || local?.createdAt || "",
        updatedAt: item.updatedAt || local?.updatedAt || "",
        nodes: parsed.nodes || local?.nodes || [],
        connections: parsed.connections || local?.connections || [],
        chatSessions: parsed.chatSessions || local?.chatSessions || [],
        activeChatId: parsed.activeChatId ?? local?.activeChatId ?? null,
        backgroundMode: parsed.backgroundMode || local?.backgroundMode || "lines",
        showImageInfo: parsed.showImageInfo ?? local?.showImageInfo ?? false,
        viewport: parsed.viewport || local?.viewport || { x: 0, y: 0, k: 1 },
    };
}

// ─── Subscribe to fire backend sync on rename/delete/update ────────────

let prevProjects: CanvasProject[] = [];
useCanvasStore.subscribe((state) => {
    const curr = state.projects;
    const prev = prevProjects;

    // Detect deleted projects
    const currIds = new Set(curr.map((p) => p.id));
    const deleted = prev.filter((p) => !currIds.has(p.id)).map((p) => p.id);
    if (deleted.length) fireDeleteProjects(deleted);

    // Detect data changes (schedule backend sync)
    for (const cp of curr) {
        const pp = prev.find((p) => p.id === cp.id);
        if (!pp) continue;

        // Check if any data content field changed
        const dataFields: (keyof CanvasProject)[] = [
            "nodes", "connections", "chatSessions", "activeChatId",
            "backgroundMode", "showImageInfo", "viewport",
        ];
        const hasDataChange = dataFields.some(
            (field) => JSON.stringify(pp[field]) !== JSON.stringify(cp[field]),
        );
        if (hasDataChange) {
            scheduleBackendSync(cp.id);
        }
    }

    // Detect renamed projects
    for (const cp of curr) {
        const pp = prev.find((p) => p.id === cp.id);
        if (pp && pp.title !== cp.title) {
            fireRenameProject(cp.id, cp.title);
        }
    }

    prevProjects = curr;
});

// ─── Subscribe to user changes (logout / switch user) ─────────────────

if (typeof window !== "undefined") {
    let lastUserId: string | undefined = useUserStore.getState().user?.id;
    useUserStore.subscribe((state) => {
        const currentId = state.user?.id;
        if (currentId === lastUserId) return;
        lastUserId = currentId;

        // Clear current user's state
        useCanvasStore.getState().clearProjects();

        if (currentId) {
            // New user logged in — rehydrate their data and sync from backend
            void useCanvasStore.persist.rehydrate()?.then(() => {
                const store = useCanvasStore.getState();
                if (!store.hydrated) {
                    useCanvasStore.setState({ hydrated: true });
                }
                void store.syncFromBackend();
            });
        }
    });
}
