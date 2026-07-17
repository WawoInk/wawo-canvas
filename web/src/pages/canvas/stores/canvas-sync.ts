// ponytail: Canvas-specific replica mechanics stay concrete until another real implementation shares this protocol.
"use client";

import { message } from "antd";
import { createCanvasProject, deleteCanvasProject, updateCanvasProject } from "@/services/api/canvas-projects";
import { ApiError } from "@/services/api/request";
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasProject, CanvasStore as CanvasStoreType } from "@/pages/canvas/stores/use-canvas-store";
import { normalizeCanvasProject } from "@/pages/canvas/stores/canvas-replica";

const SYNC_DEBOUNCE_MS = 4000;
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
type StoreAccess = { getState: () => CanvasStoreType };

async function syncProject(projectId: string, store: StoreAccess) {
    const state = store.getState();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project?.dirty || project.revision === 0 || !useUserStore.getState().user?.id) return;
    const localVersion = project.localVersion;
    syncScheduler.markActivity();
    try {
        const updated = await updateCanvasProject(projectId, { project, expectedRevision: project.revision });
        store.getState().acknowledgeProject(projectId, localVersion, { revision: updated.revision, updatedAt: updated.updatedAt || project.updatedAt });
    } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
            message.warning("画布存在云端冲突，本地修改已保留");
            return;
        }
        console.warn("canvas: sync project failed", err);
    }
}

export function scheduleBackendSync(projectId: string, store: StoreAccess) {
    const existing = syncTimers.get(projectId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
        syncTimers.delete(projectId);
        void syncProject(projectId, store);
    }, SYNC_DEBOUNCE_MS);
    syncTimers.set(projectId, timer);
}

export function flushProjectSync(projectId: string, store: StoreAccess) {
    const timer = syncTimers.get(projectId);
    if (timer) clearTimeout(timer);
    syncTimers.delete(projectId);
    void syncProject(projectId, store);
}

export function fireCreateProject(project: CanvasProject, store: StoreAccess) {
    if (!useUserStore.getState().user?.id) return;
    const localVersion = project.localVersion;
    createCanvasProject(project.title, project)
        .then((created) => {
            store.getState().acknowledgeProject(project.id, localVersion, { revision: created.revision, updatedAt: created.updatedAt || project.updatedAt });
            if (store.getState().projects.find((item) => item.id === project.id)?.dirty) scheduleBackendSync(project.id, store);
        })
        .catch((err) => console.warn("canvas: create project failed", err));
}

export function fireDeleteProjects(ids: string[], store: StoreAccess) {
    if (!useUserStore.getState().user?.id) return;
    for (const id of ids) {
        const timer = syncTimers.get(id);
        if (timer) clearTimeout(timer);
        syncTimers.delete(id);
        deleteCanvasProject(id)
            .then(() => store.getState().acknowledgeDelete(id))
            .catch((err) => {
                if (err instanceof ApiError && err.status === 404) {
                    store.getState().acknowledgeDelete(id);
                    return;
                }
                console.warn("canvas: delete project failed", err);
            });
    }
}

export function registerBeforeUnloadFlush(store: StoreAccess) {
    if (typeof window === "undefined") return;
    window.addEventListener("beforeunload", () => {
        const token = useUserStore.getState().token;
        if (!useUserStore.getState().user?.id || !token) return;
        for (const project of store.getState().projects) {
            if (!project.dirty || project.revision === 0) continue;
            fetch(`/api/v1/canvas/projects/${encodeURIComponent(project.id)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ project, expectedRevision: project.revision }),
                keepalive: true,
            }).catch(() => {});
        }
    });
}

export function parseProjectJson(json?: string): Partial<CanvasProject> {
    if (!json) return {};
    try {
        return JSON.parse(json) as Partial<CanvasProject>;
    } catch {
        return {};
    }
}

function fromServerProject(item: { id: string; name?: string; projectJson?: string; revision?: number; createdAt?: string; updatedAt?: string }, local: CanvasProject | null): CanvasProject {
    const parsed = parseProjectJson(item.projectJson);
    return normalizeCanvasProject({
        ...local,
        ...parsed,
        id: item.id,
        title: parsed.title || item.name || local?.title,
        createdAt: item.createdAt || local?.createdAt,
        updatedAt: item.updatedAt || local?.updatedAt,
        revision: item.revision || local?.revision,
        localVersion: local?.localVersion || 0,
        dirty: false,
    })!;
}

export function registerSyncDeltaHandler(store: StoreAccess) {
    syncClient.onDelta("canvas", (data) => {
        if (!data) return true;
        const state = store.getState();
        const tombstones = new Set(state.tombstones);
        const map = new Map(state.projects.filter((project) => !tombstones.has(project.id)).map((project) => [project.id, project]));
        let blocked = false;

        for (const item of data.updates || []) {
            if (tombstones.has(item.id)) continue;
            const existing = map.get(item.id);
            if (existing?.dirty) {
                if ((item.revision || 0) > existing.revision) blocked = true;
                continue;
            }
            if (!existing || (item.revision || 0) > existing.revision) map.set(item.id, fromServerProject(item, existing || null));
        }
        for (const id of data.deletes || []) {
            const existing = map.get(id);
            if (existing?.dirty) {
                blocked = true;
                continue;
            }
            map.delete(id);
        }
        store.getState().replaceProjects(Array.from(map.values()));
        return !blocked;
    });
}

const dataFields: (keyof CanvasProject)[] = ["title", "nodes", "connections", "chatSessions", "activeChatId", "backgroundMode", "showImageInfo", "viewport"];

export function detectDataChanges(prev: CanvasProject[], curr: CanvasProject[]): { sync: string[] } {
    const sync: string[] = [];
    for (const project of curr) {
        const previous = prev.find((item) => item.id === project.id);
        if (!previous || !project.dirty) continue;
        if (dataFields.some((field) => JSON.stringify(previous[field]) !== JSON.stringify(project[field]))) sync.push(project.id);
    }
    return { sync };
}

export function clearSyncTimers() {
    for (const timer of syncTimers.values()) clearTimeout(timer);
    syncTimers.clear();
}
