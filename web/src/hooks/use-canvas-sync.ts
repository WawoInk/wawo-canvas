"use client";

import { useEffect, useRef, useCallback } from "react";
import { useUserStore } from "@/stores/use-user-store";
import {
    fetchCanvasProjects,
    createCanvasProject,
    updateCanvasProject,
    deleteCanvasProject,
    type CanvasProjectItem,
} from "@/services/api/canvas-projects";

export interface CanvasProjectData {
    id: string;
    title: string;
    [key: string]: unknown;
}

type SyncState = "idle" | "syncing" | "error";

interface UseCanvasSyncOptions {
    /** Called when projects are fetched from backend and ready to merge into local store */
    onProjectsLoaded: (projects: CanvasProjectItem[]) => void;
    /** Called to get current project data for a PUT */
    getProjectData: (projectId: string) => CanvasProjectData | null;
    /** Debounce delay in ms for cloud sync (default 4000) */
    syncDebounceMs?: number;
}

/**
 * Manages canvas project cloud sync with debounced PUT, beforeunload flush,
 * and offline resync queue.
 */
export function useCanvasSync({ onProjectsLoaded, getProjectData, syncDebounceMs = 4000 }: UseCanvasSyncOptions) {
    const user = useUserStore((state) => state.user);
    const syncedRef = useRef(false);
    const dirtyRef = useRef<Set<string>>(new Set());
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const syncStateRef = useRef<SyncState>("idle");

    // Initial load from backend
    const loadFromBackend = useCallback(async () => {
        const userId = user?.id;
        if (!userId || syncedRef.current) return;

        syncStateRef.current = "syncing";
        try {
            const projects = await fetchCanvasProjects();
            onProjectsLoaded(projects);
            syncedRef.current = true;
            syncStateRef.current = "idle";
        } catch {
            syncStateRef.current = "error";
        }
    }, [user?.id, onProjectsLoaded]);

    // Mark project dirty and schedule sync
    const markDirty = useCallback(
        (projectId: string) => {
            dirtyRef.current.add(projectId);
            // Debounce
            const existing = timersRef.current.get(projectId);
            if (existing) clearTimeout(existing);

            const timer = setTimeout(() => {
                flushProject(projectId);
                timersRef.current.delete(projectId);
            }, syncDebounceMs);

            timersRef.current.set(projectId, timer);
        },
        [syncDebounceMs],
    );

    // Flush a single project to backend
    const flushProject = useCallback(async (projectId: string) => {
        const userId = user?.id;
        if (!userId) return;

        const data = getProjectData(projectId);
        if (!data) return;

        try {
            await updateCanvasProject(projectId, data);
            dirtyRef.current.delete(projectId);
        } catch {
            // Will retry on next dirty cycle
        }
    }, [user?.id, getProjectData]);

    // Create project on backend
    const createProject = useCallback(
        async (name: string, data: unknown) => {
            const userId = user?.id;
            if (!userId) return null;
            try {
                return await createCanvasProject(name, data);
            } catch {
                return null;
            }
        },
        [user?.id],
    );

    // Delete project on backend
    const removeProject = useCallback(
        async (projectId: string) => {
            const userId = user?.id;
            if (!userId) return;
            try {
                await deleteCanvasProject(projectId);
                dirtyRef.current.delete(projectId);
                const timer = timersRef.current.get(projectId);
                if (timer) {
                    clearTimeout(timer);
                    timersRef.current.delete(projectId);
                }
            } catch {
                // Will retry
            }
        },
        [user?.id],
    );

    // Flush all dirty projects immediately
    const flushAll = useCallback(async () => {
        const ids = Array.from(dirtyRef.current);
        await Promise.all(ids.map((id) => flushProject(id)));
    }, [flushProject]);

    // beforeunload flush
    useEffect(() => {
        const handler = () => {
            // Synchronous flush via sendBeacon-like approach not feasible;
            // we rely on the browser allowing async beforeunload with keepalive
            const ids = Array.from(dirtyRef.current);
            for (const id of ids) {
                const data = getProjectData(id);
                if (!data) continue;
                const token = useUserStore.getState().token;
                if (!token) continue;
                // Fire-and-forget with keepalive
                fetch(`/api/v1/canvas/projects/${encodeURIComponent(id)}`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ project: data }),
                    keepalive: true,
                }).catch(() => {});
            }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [getProjectData]);

    // Load on user change
    useEffect(() => {
        if (user?.id) {
            syncedRef.current = false;
            loadFromBackend();
        }
    }, [user?.id, loadFromBackend]);

    return {
        loadFromBackend,
        markDirty,
        createProject,
        removeProject,
        flushAll,
        syncState: syncStateRef,
    };
}
