import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";

type ProjectPatch = Parameters<ReturnType<typeof useCanvasStore.getState>["updateProject"]>[1];
type EditorBinding = { projectId: string; token: string; remoteRevision: number; display: CanvasProject };

// Bind displayed content to the remote snapshot it came from, not to later save acknowledgements.
export function useCanvasEditorReplica(
    projectId: string,
    options: {
        hydrate: (project: CanvasProject) => Promise<CanvasProject>;
        apply: (project: CanvasProject) => void;
        onMissing: () => void;
    },
) {
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === projectId));
    const initialized = useCanvasStore((state) => state.hydrated && state.synced);
    const token = useUserStore((state) => state.token);
    const remoteRevision = project?.remoteRevision || 0;
    const callbacks = useRef(options);
    useLayoutEffect(() => {
        callbacks.current = options;
    });
    const [binding, setBinding] = useState<EditorBinding | null>(null);

    useEffect(() => {
        if (!initialized) return;
        let cancelled = false;
        const restore = async () => {
            let source = useCanvasStore.getState().openProject(projectId);
            if (!source && !useCanvasStore.getState().tombstones.includes(projectId)) source = await useCanvasStore.getState().fetchProjectFromBackend(projectId);
            if (cancelled) return;
            if (!source) {
                callbacks.current.onMissing();
                return;
            }
            while (!cancelled) {
                const display = await callbacks.current.hydrate(source);
                const current = useCanvasStore.getState().openProject(projectId);
                if (cancelled || useUserStore.getState().token !== token || !current || (current.remoteRevision || 0) !== (source.remoteRevision || 0)) return;
                if (current.localVersion !== source.localVersion) {
                    source = current;
                    continue;
                }
                callbacks.current.apply(display);
                setBinding({ projectId, token, remoteRevision: current.remoteRevision || 0, display });
                return;
            }
        };
        void restore();
        return () => {
            cancelled = true;
        };
    }, [initialized, projectId, remoteRevision, token, Boolean(project)]);

    const ready = initialized && Boolean(project) && binding?.projectId === projectId && binding.token === token && binding.remoteRevision === remoteRevision;
    const save = useCallback(
        async (patch: ProjectPatch) => {
            if (!binding || binding.projectId !== projectId || useUserStore.getState().token !== binding.token) return false;
            const current = useCanvasStore.getState().openProject(projectId);
            if (!current || (current.remoteRevision || 0) !== binding.remoteRevision) return false;
            // Hydrating presigned/blob URLs is display work, not a user edit.
            const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => JSON.stringify(binding.display[key as keyof CanvasProject]) !== JSON.stringify(value))) as ProjectPatch;
            if (!Object.keys(changed).length) return true;
            const accepted = await useCanvasStore.getState().updateProject(projectId, changed, binding.remoteRevision);
            if (accepted) binding.display = { ...binding.display, ...patch };
            return accepted;
        },
        [binding, projectId],
    );

    return { ready, save, remoteRevision: binding?.remoteRevision };
}
