import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { message } from "antd";

import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";
import { createCanvasProject, deleteCanvasProject, updateCanvasProject } from "@/services/api/canvas-projects";
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
    synced: boolean;
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
    /** Fetch a single project from backend by id — used when opening a project
     *  that doesn't exist locally (e.g. fresh device, direct URL navigation). */
    fetchProjectFromBackend: (id: string) => Promise<CanvasProject | null>;
    /** Flush debounced sync timer immediately (call on page navigation away). */
    flushProjectSync: (id: string) => void;
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
        } as unknown).then((updated) => {
            // ponytail: 同步本地 updatedAt 与后端，避免后续冲突
            useCanvasStore.setState((s) => ({
                projects: s.projects.map((p) =>
                    p.id === projectId ? { ...p, updatedAt: updated.updatedAt || p.updatedAt } : p,
                ),
            }));
        }).catch((err) => {
            // ponytail: 乐观锁冲突 — 触发 domain 全量同步拉取最新
            if (err instanceof ApiError && err.status === 409) {
                console.warn("canvas: optimistic lock conflict, syncing from server");
                void syncClient.syncDomain("canvas");
                // ponytail: 409 时后端已返回当前版本 — 用服务端 updatedAt 覆盖本地，下次请求不再冲突
                if (err.data && typeof err.data === "object") {
                    const current = (err.data as Record<string, unknown>)?.current as Record<string, unknown> | undefined;
                    if (current?.updatedAt) {
                        useCanvasStore.setState((s) => ({
                            projects: s.projects.map((p) =>
                                p.id === current.id ? { ...p, updatedAt: current.updatedAt as string } : p,
                            ),
                        }));
                    }
                }
                message.warning("画布已被其他会话修改，已刷新为最新版本");
                return;
            }
            console.warn("canvas: sync project failed", err);
        });
    }, SYNC_DEBOUNCE_MS);

    syncTimers.set(projectId, timer);
}

// ─── Non-blocking backend operations (fire-and-log; local state always wins) ──

function fireCreateProject(project: CanvasProject) {
    const user = useUserStore.getState().user;
    if (!user?.id) return;
    createCanvasProject(project.title, project).then((created) => {
        // ponytail: 本地 updatedAt 必须与后端一致，否则后续 PUT 的 expectedUpdatedAt 永远不匹配
        useCanvasStore.setState((s) => ({
            projects: s.projects.map((p) =>
                p.id === project.id ? { ...p, updatedAt: created.updatedAt || project.updatedAt } : p,
            ),
        }));
    }).catch((err) => {
        console.warn("canvas: create project failed", err);
    });
}

function fireDeleteProjects(ids: string[]) {
    const user = useUserStore.getState().user;
    if (!user?.id) return;
    for (const id of ids) {
        syncTimers.get(id) && clearTimeout(syncTimers.get(id));
        syncTimers.delete(id);
        deleteCanvasProject(id).catch((err) => {
            console.warn("canvas: delete project failed", err);
        });
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
    } as unknown).then((updated) => {
        // ponytail: 同步本地 updatedAt 与后端
        useCanvasStore.setState((s) => ({
            projects: s.projects.map((p) =>
                p.id === id ? { ...p, updatedAt: updated.updatedAt || p.updatedAt } : p,
            ),
        }));
    }).catch((err) => {
        console.warn("canvas: rename project failed", err);
    });
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
            }).then(async (resp) => {
                // ponytail: sync back server's updatedAt so next session starts clean
                if (resp.ok) {
                    const json = await resp.json();
                    const updated = json?.data;
                    if (updated?.updatedAt) {
                        useCanvasStore.setState((s) => ({
                            projects: s.projects.map((p) =>
                                p.id === project.id ? { ...p, updatedAt: updated.updatedAt } : p,
                            ),
                        }));
                    }
                }
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

            /** Fetch a single project from backend by id — used when opening a project
             *  that doesn't exist locally (e.g. fresh device, direct URL navigation). */
            fetchProjectFromBackend: async (id: string) => {
                const token = useUserStore.getState().token;
                if (!token) return null;
                try {
                    const { fetchCanvasProject } = await import("@/services/api/canvas-projects");
                    const detail = await fetchCanvasProject(id);
                    const parsed = safeParseProjectJson(detail.projectJson);
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
                            return {
                                projects: state.projects.map((p) =>
                                    p.id === id ? { ...p, ...project, updatedAt: detail.updatedAt || p.updatedAt } : p,
                                ),
                            };
                        }
                        return { projects: [...state.projects, project] };
                    });
                    return project;
                } catch {
                    return null;
                }
            },

            /** Flush pending debounced sync immediately — call on page nav away. */
            flushProjectSync: (id: string) => {
                const timer = syncTimers.get(id);
                if (!timer) return;
                clearTimeout(timer);
                syncTimers.delete(id);
                const state = get();
                const project = state.projects.find((p) => p.id === id);
                if (!project) return;
                const user = useUserStore.getState().user;
                if (!user?.id) return;
                updateCanvasProject(id, {
                    project,
                    expectedUpdatedAt: project.updatedAt,
                } as unknown).then((updated) => {
                    // ponytail: 同步本地 updatedAt 与后端
                    useCanvasStore.setState((s) => ({
                        projects: s.projects.map((p) =>
                            p.id === id ? { ...p, updatedAt: updated.updatedAt || p.updatedAt } : p,
                        ),
                    }));
                }).catch((err) => {
                    if (err instanceof ApiError && err.status === 409) {
                        void syncClient.syncDomain("canvas");
                        if (err.data && typeof err.data === "object") {
                            const current = (err.data as Record<string, unknown>)?.current as Record<string, unknown> | undefined;
                            if (current?.updatedAt) {
                                useCanvasStore.setState((s) => ({
                                    projects: s.projects.map((p) =>
                                        p.id === current.id ? { ...p, updatedAt: current.updatedAt as string } : p,
                                    ),
                                }));
                            }
                        }
                        return;
                    }
                    console.warn("canvas: flush sync failed", err);
                });
            },

            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
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
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),

            syncFromBackend: async () => {
                const user = useUserStore.getState().user;
                if (!user?.id) return;
                // ponytail: 服务端为 source of truth，全量拉取项目列表并覆盖本地，
            // 完成后标记 synced=true，IndexedDB 随 persist 自动更新。
            const token = useUserStore.getState().token;
            if (!token) return;
            try {
                const { fetchCanvasProjects, fetchCanvasProject } = await import("@/services/api/canvas-projects");
                const serverProjects = await fetchCanvasProjects();
                if (!serverProjects || !serverProjects.length) {
                    set({ synced: true });
                    return;
                }
                // Fetch full project details in parallel for content
                const details = await Promise.allSettled(
                    serverProjects.map((p) => fetchCanvasProject(p.id)),
                );
                const map = new Map(get().projects.map((p) => [p.id, p]));
                for (const result of details) {
                    if (result.status !== "fulfilled") continue;
                    const d = result.value;
                    const existing = map.get(d.id);
                    // ponytail: 仅当 server updatedAt 比本地新时才覆盖，防止覆盖本地尚未推送的编辑
                    if (existing && (d.updatedAt || "") <= (existing.updatedAt || "")) continue;
                    const parsed = safeParseProjectJson(d.projectJson);
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
                set({ projects: Array.from(map.values()), synced: true });
            } catch (err) {
                console.warn("canvas: backend sync failed, falling back to local cache", err);
                set({ synced: true }); // mark synced so UI doesn't wait forever
                // ponytail: offline or network error — IndexedDB cache still serves stale data
            }
            },

            clearProjects: () => {
            // Clear all pending sync timers
            for (const timer of syncTimers.values()) clearTimeout(timer);
            syncTimers.clear();
            set({ projects: [], hydrated: false, synced: false });
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
                // ponytail: rehydrate 后通过 REST API 拉取完整数据，sync 只是增量兜底
                void useCanvasStore.getState().syncFromBackend();
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

// ponytail: shared JSON.parse for projectJson — used by both syncFromBackend and fromServerProject
function safeParseProjectJson(json?: string): Partial<CanvasProject> {
    if (!json) return {};
    try { return JSON.parse(json) as Partial<CanvasProject>; }
    catch { return {}; }
}

function fromServerProject(item: { id: string; name?: string; projectJson?: string; createdAt?: string; updatedAt?: string }, local: CanvasProject | null): CanvasProject {
    const parsed = safeParseProjectJson(item.projectJson);
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
        const dataFields: (keyof CanvasProject)[] = ["nodes", "connections", "chatSessions", "activeChatId", "backgroundMode", "showImageInfo", "viewport"];
        const hasDataChange = dataFields.some((field) => JSON.stringify(pp[field]) !== JSON.stringify(cp[field]));
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
                void useCanvasStore.getState().syncFromBackend();
                void syncClient.syncDomain("canvas");
            });
        }
    });
}
