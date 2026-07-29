// ponytail: Canvas-specific replica mechanics stay concrete until another real implementation shares this protocol.
"use client";

import { createCanvasProject, deleteCanvasProject, fetchCanvasProject, updateCanvasProject } from "@/services/api/canvas-projects";
import { ApiError } from "@/services/api/request";
import { syncClient } from "@/services/sync-client";
import { syncScheduler } from "@/services/sync-scheduler";
import { useUserStore } from "@/stores/use-user-store";
import { isCurrentSession } from "@/lib/account-storage";
import type { CanvasProject, CanvasStore as CanvasStoreType } from "@/pages/canvas/stores/use-canvas-store";
import { normalizeCanvasProject } from "@/pages/canvas/stores/canvas-replica";

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 30_000;
type StoreAccess = { getState: () => CanvasStoreType };
type SyncResult = "done" | "again" | "retry" | "pause";
type QueueEntry = {
    store: StoreAccess;
    queued: boolean;
    retryCount: number;
    retryTimer?: ReturnType<typeof setTimeout>;
};
const syncQueue = new Map<string, QueueEntry>();
const syncRequests = new Map<string, Promise<SyncResult>>();

function hasPendingWork(projectId: string, store: StoreAccess) {
    const state = store.getState();
    return state.tombstones.includes(projectId) || Boolean(state.projects.find((item) => item.id === projectId)?.dirty);
}

function setProjectRevision(projectId: string, revision: number, updatedAt: string | undefined, store: StoreAccess) {
    const state = store.getState();
    state.replaceProjects(state.projects.map((project) => (project.id === projectId ? { ...project, revision, updatedAt: updatedAt || project.updatedAt, dirty: true } : project)));
}

function conflictRevision(err: ApiError) {
    const current = (err.data as { current?: { revision?: unknown; updatedAt?: unknown } } | null)?.current;
    return {
        revision: typeof current?.revision === "number" ? current.revision : null,
        updatedAt: typeof current?.updatedAt === "string" ? current.updatedAt : undefined,
    };
}

function retryableSyncError(err: unknown) {
    if (!(err instanceof ApiError)) return true;
    return err.status === 200 || err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
}

async function recoverProjectRevision(projectId: string, store: StoreAccess, session: { token: string; userId: string }) {
    try {
        const current = await fetchCanvasProject(projectId);
        const auth = useUserStore.getState();
        if (!isCurrentSession(session, { token: auth.token, userId: auth.user?.id })) return false;
        setProjectRevision(projectId, current.revision, current.updatedAt, store);
        return true;
    } catch {
        return false;
    }
}

async function persistProject(projectId: string, store: StoreAccess): Promise<SyncResult> {
    const auth = useUserStore.getState();
    if (!auth.user?.id || !auth.token) return "pause";
    const session = { token: auth.token, userId: auth.user.id };
    const state = store.getState();
    if (state.tombstones.includes(projectId)) {
        try {
            await deleteCanvasProject(projectId);
            const current = useUserStore.getState();
            if (!isCurrentSession(session, { token: current.token, userId: current.user?.id })) return "pause";
            store.getState().acknowledgeDelete(projectId);
            return "done";
        } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
                const current = useUserStore.getState();
                if (!isCurrentSession(session, { token: current.token, userId: current.user?.id })) return "pause";
                store.getState().acknowledgeDelete(projectId);
                return "done";
            }
            return retryableSyncError(err) ? "retry" : "pause";
        }
    }

    const project = state.projects.find((item) => item.id === projectId);
    if (!project?.dirty) return "done";
    const localVersion = project.localVersion;
    syncScheduler.markActivity();
    try {
        const updated =
            project.revision === 0
                ? await createCanvasProject(project.title, project)
                : await updateCanvasProject(projectId, {
                      project,
                      expectedRevision: project.revision,
                  });
        const current = useUserStore.getState();
        if (!isCurrentSession(session, { token: current.token, userId: current.user?.id })) return "pause";
        store.getState().acknowledgeProject(projectId, localVersion, { revision: updated.revision, updatedAt: updated.updatedAt || project.updatedAt });
        return "done";
    } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
            const current = conflictRevision(err);
            if (current.revision !== null) {
                setProjectRevision(projectId, current.revision, current.updatedAt, store);
                return "again";
            }
            return (await recoverProjectRevision(projectId, store, session)) ? "again" : "retry";
        }
        if (err instanceof ApiError && err.status === 404 && project.revision > 0) {
            setProjectRevision(projectId, 0, undefined, store);
            return "again";
        }
        if (project.revision === 0 && (await recoverProjectRevision(projectId, store, session))) return "again";
        if (retryableSyncError(err)) return "retry";
        console.warn("canvas: sync paused after a permanent error", err);
        return "pause";
    }
}

function scheduleRetry(projectId: string, entry: QueueEntry) {
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    const delay = Math.min(RETRY_BASE_MS * 2 ** entry.retryCount, RETRY_MAX_MS);
    entry.retryCount += 1;
    entry.retryTimer = setTimeout(() => {
        entry.retryTimer = undefined;
        entry.queued = true;
        void drainProjectSync(projectId);
    }, delay);
}

async function drainProjectSync(projectId: string) {
    const entry = syncQueue.get(projectId);
    if (!entry?.queued || syncRequests.has(projectId)) return;
    entry.queued = false;
    const request = persistProject(projectId, entry.store);
    syncRequests.set(projectId, request);
    let result: SyncResult = "retry";
    try {
        result = await request;
    } finally {
        if (syncRequests.get(projectId) === request) syncRequests.delete(projectId);
    }

    const current = syncQueue.get(projectId);
    if (!current) return;
    if (result === "again") {
        current.queued = true;
        void drainProjectSync(projectId);
        return;
    }
    if (result === "retry") {
        if (current.queued) void drainProjectSync(projectId);
        else scheduleRetry(projectId, current);
        return;
    }
    if (result === "pause") return;
    current.retryCount = 0;
    if (current.queued || hasPendingWork(projectId, current.store)) {
        current.queued = true;
        void drainProjectSync(projectId);
        return;
    }
    syncQueue.delete(projectId);
}

function enqueueProjectSync(projectId: string, store: StoreAccess) {
    const entry = syncQueue.get(projectId) || { store, queued: false, retryCount: 0 };
    entry.store = store;
    entry.queued = true;
    entry.retryCount = 0;
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.retryTimer = undefined;
    syncQueue.set(projectId, entry);
    void drainProjectSync(projectId);
}

export function scheduleBackendSync(projectId: string, store: StoreAccess) {
    enqueueProjectSync(projectId, store);
}

export function flushProjectSync(projectId: string, store: StoreAccess) {
    enqueueProjectSync(projectId, store);
}

export function fireCreateProject(project: CanvasProject, store: StoreAccess) {
    enqueueProjectSync(project.id, store);
}

export function fireDeleteProjects(ids: string[], store: StoreAccess) {
    for (const id of ids) enqueueProjectSync(id, store);
}

export function resumePendingCanvasSync(store: StoreAccess) {
    const state = store.getState();
    for (const project of state.projects) {
        if (project.dirty) enqueueProjectSync(project.id, store);
    }
    for (const id of state.tombstones) enqueueProjectSync(id, store);
}

export function retryPendingCanvasSync() {
    for (const [projectId, entry] of syncQueue) {
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
        entry.retryTimer = undefined;
        entry.retryCount = 0;
        entry.queued = true;
        void drainProjectSync(projectId);
    }
}

export function registerBeforeUnloadFlush(store: StoreAccess) {
    if (typeof window === "undefined") return;
    window.addEventListener("beforeunload", () => {
        const token = useUserStore.getState().token;
        if (!useUserStore.getState().user?.id || !token) return;
        for (const project of store.getState().projects) {
            if (!project.dirty || project.revision === 0 || syncRequests.has(project.id)) continue;
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
    for (const entry of syncQueue.values()) {
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
    }
    syncQueue.clear();
    syncRequests.clear();
}

if (typeof window !== "undefined") {
    window.addEventListener("online", retryPendingCanvasSync);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") retryPendingCanvasSync();
    });
}
