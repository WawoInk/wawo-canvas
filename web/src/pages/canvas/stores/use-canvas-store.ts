import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";
import {
    createCanvasProject,
    deleteCanvasProject,
    fetchCanvasProjects,
    updateCanvasProject,
} from "@/services/api/canvas-projects";
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
        updateCanvasProject(projectId, project).catch(() => {});
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
    updateCanvasProject(id, { ...project, title }).catch(() => {});
}

// ─── beforeunload flush ─────────────────────────────────────────────────

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
        const state = useCanvasStore.getState();
        const user = useUserStore.getState().user;
        const token = useUserStore.getState().token;
        if (!user?.id || !token) return;
        for (const project of state.projects) {
            fetch(`/api/v1/canvas/projects/${encodeURIComponent(project.id)}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ project }),
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
                try {
                    const backendItems = await fetchCanvasProjects();
                    if (!backendItems.length) return;
                    const localProjects = get().projects;
                    // Start with all local projects (preserves local-only ones not in backend)
                    const projects: CanvasProject[] = [...localProjects];
                    for (const item of backendItems) {
                        const existsLocally = projects.some((p) => p.id === item.id);
                        if (existsLocally) {
                            // Keep local version (has latest in-memory edits) — already in projects array
                            continue;
                        } else {
                            // New project from backend — try to load full data
                            let fullProject: CanvasProject = {
                                id: item.id,
                                title: item.name,
                                createdAt: item.createdAt,
                                updatedAt: item.updatedAt,
                                nodes: [],
                                connections: [],
                                chatSessions: [],
                                activeChatId: null,
                                backgroundMode: "lines",
                                showImageInfo: false,
                                viewport: initialViewport,
                            };
                            try {
                                const resp = await fetch(
                                    `/api/v1/canvas/projects/${encodeURIComponent(item.id)}`,
                                    {
                                        headers: {
                                            Authorization: `Bearer ${useUserStore.getState().token}`,
                                        },
                                    },
                                );
                                if (resp.ok) {
                                    const detail = await resp.json() as { data?: { projectJson?: string } };
                                    if (detail.data?.projectJson) {
                                        const parsed = JSON.parse(detail.data.projectJson) as Partial<CanvasProject>;
                                        fullProject = { ...fullProject, ...parsed, id: item.id, title: parsed.title || item.name, createdAt: item.createdAt, updatedAt: item.updatedAt };
                                    }
                                }
                            } catch { /* skip */ }
                            projects.push(fullProject);
                        }
                    }
                    set({ projects });
                } catch { /* offline — no-op */ }
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
            },
        },
    ),
);

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
