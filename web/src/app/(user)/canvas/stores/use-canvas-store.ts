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
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
    /** Triggered after hydration to pull backend projects and merge. */
    syncFromBackend: () => Promise<void>;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;

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

// ─── Persist storage adapter (same as before) ───────────────────────────

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
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
                    const backendProjects = await fetchCanvasProjects();
                    if (!backendProjects.length) return;
                    // Merge: backend is source of truth for version, but local has latest edits
                    // For simplicity, only pull projects not already in local
                    const localIds = new Set(get().projects.map((p) => p.id));
                    const newProjects: CanvasProject[] = [];
                    for (const item of backendProjects) {
                        if (!localIds.has(item.id)) {
                            // New project from another device/session
                            try {
                                const detailResp = await fetch(
                                    `/api/v1/canvas/projects/${encodeURIComponent(item.id)}?detail=true`,
                                    {
                                        headers: {
                                            Authorization: `Bearer ${useUserStore.getState().token}`,
                                        },
                                    },
                                );
                                if (detailResp.ok) {
                                    const detail = await detailResp.json();
                                    // The GET /canvas/projects doesn't return full JSON, so skip for now
                                }
                            } catch { /* skip */ }
                            newProjects.push({
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
                            });
                        }
                    }
                    if (newProjects.length) {
                        set((state) => ({ projects: [...newProjects, ...state.projects] }));
                    }
                } catch { /* offline — no-op */ }
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

    // Detect renamed projects
    for (const cp of curr) {
        const pp = prev.find((p) => p.id === cp.id);
        if (pp && pp.title !== cp.title) {
            fireRenameProject(cp.id, cp.title);
        }
    }

    prevProjects = curr;
});
