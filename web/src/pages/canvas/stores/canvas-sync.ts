// ponytail: sync logic extracted from useCanvasStore — same behavior, isolated scope.
// Tests can now stub createCanvasProject/deleteCanvasProject/updateCanvasProject
// without needing IndexedDB or a full Zustand store.
"use client";

import { message } from "antd";
import { createCanvasProject, deleteCanvasProject, updateCanvasProject } from "@/services/api/canvas-projects";
import { ApiError } from "@/services/api/request";
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasProject, useCanvasStore as CanvasStoreType } from "@/pages/canvas/stores/use-canvas-store";

const SYNC_DEBOUNCE_MS = 4000;
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ── Debounced sync (called from store subscribe on data change) ──────────

export function scheduleBackendSync(projectId: string, store: { getState: () => CanvasStoreType }) {
    const existing = syncTimers.get(projectId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
        syncTimers.delete(projectId);
        const state = store.getState();
        const project = state.projects.find((p) => p.id === projectId);
        if (!project) return;
        const user = useUserStore.getState().user;
        if (!user?.id) return;
        syncScheduler.markActivity();
        updateCanvasProject(projectId, { project, expectedUpdatedAt: project.updatedAt } as unknown)
            .then((updated) => {
                state.updateProject(projectId, { updatedAt: updated.updatedAt || project.updatedAt } as Partial<CanvasProject>);
            })
            .catch((err) => {
                if (err instanceof ApiError && err.status === 409) {
                    console.warn("canvas: optimistic lock conflict, syncing from server");
                    void syncClient.syncDomain("canvas");
                    if (err.data && typeof err.data === "object") {
                        const current = (err.data as Record<string, unknown>)?.current as Record<string, unknown> | undefined;
                        if (current?.updatedAt) {
                            state.updateProject(projectId, { updatedAt: current.updatedAt as string } as Partial<CanvasProject>);
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

export function flushProjectSync(projectId: string, store: { getState: () => CanvasStoreType }) {
    const timer = syncTimers.get(projectId);
    if (!timer) return;
    clearTimeout(timer);
    syncTimers.delete(projectId);
    const state = store.getState();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const user = useUserStore.getState().user;
    if (!user?.id) return;
    updateCanvasProject(projectId, { project, expectedUpdatedAt: project.updatedAt } as unknown)
        .then((updated) => {
            state.updateProject(projectId, { updatedAt: updated.updatedAt || project.updatedAt } as Partial<CanvasProject>);
        })
        .catch((err) => {
            if (err instanceof ApiError && err.status === 409) {
                void syncClient.syncDomain("canvas");
                if (err.data && typeof err.data === "object") {
                    const current = (err.data as Record<string, unknown>)?.current as Record<string, unknown> | undefined;
                    if (current?.updatedAt) {
                        state.updateProject(projectId, { updatedAt: current.updatedAt as string } as Partial<CanvasProject>);
                    }
                }
                return;
            }
            console.warn("canvas: flush sync failed", err);
        });
}

// ── Fire-and-log backend operations ─────────────────────────────────────

export function fireCreateProject(project: CanvasProject, store: { setState: CanvasStoreType["updateProject"] extends (_: string, __: infer P) => void ? never : never; getState: () => CanvasStoreType }) {
    const user = useUserStore.getState().user;
    if (!user?.id) return;
    createCanvasProject(project.title, project)
        .then((created) => {
            store.getState().updateProject(project.id, { updatedAt: created.updatedAt || project.updatedAt } as Partial<CanvasProject>);
        })
        .catch((err) => {
            console.warn("canvas: create project failed", err);
        });
}

export function fireDeleteProjects(ids: string[]) {
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

export function fireRenameProject(id: string, title: string, store: { getState: () => CanvasStoreType }) {
    const user = useUserStore.getState().user;
    if (!user?.id) return;
    const project = store.getState().projects.find((p) => p.id === id);
    if (!project) return;
    updateCanvasProject(id, { project: { ...project, title }, expectedUpdatedAt: project.updatedAt } as unknown)
        .then((updated) => {
            store.getState().updateProject(id, { updatedAt: updated.updatedAt || project.updatedAt } as Partial<CanvasProject>);
        })
        .catch((err) => {
            console.warn("canvas: rename project failed", err);
        });
}

// ── beforeunload flush ──────────────────────────────────────────────────

export function registerBeforeUnloadFlush(store: { getState: () => CanvasStoreType }) {
    if (typeof window === "undefined") return;
    window.addEventListener("beforeunload", () => {
        const state = store.getState();
        const user = useUserStore.getState().user;
        const token = useUserStore.getState().token;
        if (!user?.id || !token) return;
        for (const project of state.projects) {
            fetch(`/api/v1/canvas/projects/${encodeURIComponent(project.id)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
            })
                .then(async (resp) => {
                    if (resp.ok) {
                        const json = await resp.json();
                        const updated = json?.data;
                        if (updated?.updatedAt) {
                            state.updateProject(project.id, { updatedAt: updated.updatedAt } as Partial<CanvasProject>);
                        }
                    }
                })
                .catch(() => {});
        }
    });
}

// ── Delta sync ──────────────────────────────────────────────────────────

export function parseProjectJson(json?: string): Partial<CanvasProject> {
    if (!json) return {};
    try {
        return JSON.parse(json) as Partial<CanvasProject>;
    } catch {
        return {};
    }
}

function fromServerProject(item: { id: string; name?: string; projectJson?: string; createdAt?: string; updatedAt?: string }, local: CanvasProject | null): CanvasProject {
    const parsed = parseProjectJson(item.projectJson);
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

export function registerSyncDeltaHandler(store: CanvasStoreType) {
    syncClient.onDelta("canvas", (data) => {
        if (!data) return;
        const state = store;

        if (data.updates && data.updates.length > 0) {
            const map = new Map(state.projects.map((p) => [p.id, p]));
            for (const item of data.updates) {
                const existing = map.get(item.id);
                if (existing) {
                    if ((item.updatedAt || "") > (existing.updatedAt || "")) {
                        map.set(item.id, fromServerProject(item, existing));
                    }
                } else {
                    map.set(item.id, fromServerProject(item, null));
                }
            }
            store.replaceProjects(Array.from(map.values()));
        }

        if (data.deletes && data.deletes.length > 0) {
            const deleteSet = new Set(data.deletes);
            store.replaceProjects(state.projects.filter((p) => !deleteSet.has(p.id)));
        }
    });
}

// ── Subscribe-based change detection ────────────────────────────────────

const dataFields: (keyof CanvasProject)[] = ["nodes", "connections", "chatSessions", "activeChatId", "backgroundMode", "showImageInfo", "viewport"];

export function detectDataChanges(prev: CanvasProject[], curr: CanvasProject[]): { sync: string[]; rename: Array<{ id: string; title: string }> } {
    const currIds = new Set(curr.map((p) => p.id));
    const deleted = prev.filter((p) => !currIds.has(p.id)).map((p) => p.id);
    if (deleted.length) fireDeleteProjects(deleted);

    const sync: string[] = [];
    const rename: Array<{ id: string; title: string }> = [];

    for (const cp of curr) {
        const pp = prev.find((p) => p.id === cp.id);
        if (!pp) continue;
        if (dataFields.some((field) => JSON.stringify(pp[field]) !== JSON.stringify(cp[field]))) {
            sync.push(cp.id);
        }
    }
    for (const cp of curr) {
        const pp = prev.find((p) => p.id === cp.id);
        if (pp && pp.title !== cp.title) {
            rename.push({ id: cp.id, title: cp.title });
        }
    }
    return { sync, rename };
}

export function clearSyncTimers() {
    for (const timer of syncTimers.values()) clearTimeout(timer);
    syncTimers.clear();
}
