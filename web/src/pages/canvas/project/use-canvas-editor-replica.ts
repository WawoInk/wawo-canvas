import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUserStore } from "@/stores/use-user-store";
import { captureCanvasReplicaBinding, matchesCanvasReplicaBinding, type CanvasReplicaBinding } from "../stores/canvas-replica";
import { useCanvasStore, type CanvasProject } from "../stores/use-canvas-store";

type ProjectPatch = Parameters<ReturnType<typeof useCanvasStore.getState>["updateProject"]>[1];
type EditorBinding = { replica: CanvasReplicaBinding; display: CanvasProject };

function isCurrentEditorBinding(binding: EditorBinding, project: CanvasProject | null | undefined) {
    const auth = useUserStore.getState();
    return Boolean(auth.user?.id && matchesCanvasReplicaBinding(project, binding.replica, { token: auth.token, userId: auth.user.id }));
}

// Bind displayed content to the remote snapshot it came from, not to later save acknowledgements.
export function useCanvasEditorReplica(
    projectId: string,
    options: {
        hydrate: (project: CanvasProject) => Promise<CanvasProject>;
        apply: (project: CanvasProject, binding: CanvasReplicaBinding) => void;
        onMissing: () => void;
    },
) {
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === projectId));
    const initialized = useCanvasStore((state) => state.hydrated && state.synced);
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id);
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
            if (!userId) return;
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
                if (!current) return;
                const restoring = { replica: captureCanvasReplicaBinding(source, { token, userId }), display };
                if (cancelled || !isCurrentEditorBinding(restoring, current)) return;
                if (current.localVersion !== source.localVersion) {
                    source = current;
                    continue;
                }
                callbacks.current.apply(display, restoring.replica);
                setBinding(restoring);
                return;
            }
        };
        void restore();
        return () => {
            cancelled = true;
        };
    }, [initialized, projectId, remoteRevision, token, userId, Boolean(project)]);

    const ready = initialized && Boolean(binding && isCurrentEditorBinding(binding, project));
    const save = useCallback(
        async (patch: ProjectPatch) => {
            if (!binding || binding.replica.projectId !== projectId) return false;
            const current = useCanvasStore.getState().openProject(projectId);
            if (!isCurrentEditorBinding(binding, current)) return false;
            // Hydrating presigned/blob URLs is display work, not a user edit.
            const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => JSON.stringify(binding.display[key as keyof CanvasProject]) !== JSON.stringify(value))) as ProjectPatch;
            if (!Object.keys(changed).length) return true;
            const accepted = await useCanvasStore.getState().updateProject(projectId, changed, binding.replica.remoteRevision);
            if (accepted) binding.display = { ...binding.display, ...patch };
            return accepted;
        },
        [binding, projectId],
    );

    return { ready, save, binding: ready ? binding?.replica : undefined, remoteRevision: binding?.replica.remoteRevision };
}
