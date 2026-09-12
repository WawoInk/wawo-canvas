import i18n from "@/i18n";
import type { CanvasBackgroundMode } from "../../../lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";

export type ReplicaCanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    remoteRevision?: number;
    localVersion: number;
    dirty: boolean;
    syncConflict?: boolean;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasProjectPatch = Partial<Pick<ReplicaCanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport" | "updatedAt" | "title">>;

export type CanvasReplicaBinding = { projectId: string; remoteRevision: number; token: string; userId: string };
type RemoteCanvasProject = { id: string; name?: string; projectJson?: string; revision?: number; createdAt?: string; updatedAt?: string };
type CanvasReplicaState = { projects: ReplicaCanvasProject[]; tombstones: string[] };
type CanvasReplicaSession = Pick<CanvasReplicaBinding, "token" | "userId">;
const dataFields: (keyof ReplicaCanvasProject)[] = ["title", "nodes", "connections", "chatSessions", "activeChatId", "backgroundMode", "showImageInfo", "viewport"];

function differs(left: unknown, right: unknown) {
    return JSON.stringify(left) !== JSON.stringify(right);
}

function normalizeProject(value: unknown): ReplicaCanvasProject | null {
    if (!value || typeof value !== "object") return null;
    const project = value as Partial<ReplicaCanvasProject> & { name?: string };
    if (typeof project.id !== "string" || !project.id) return null;
    return {
        id: project.id,
        title: project.title || project.name || i18n.t("canvas.editor.project.untitled"),
        createdAt: typeof project.createdAt === "string" ? project.createdAt : "",
        updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : "",
        revision: Number.isSafeInteger(project.revision) && Number(project.revision) >= 0 ? Number(project.revision) : 0,
        remoteRevision: Number.isSafeInteger(project.remoteRevision) && Number(project.remoteRevision) >= 0 ? Number(project.remoteRevision) : 0,
        localVersion: Number.isSafeInteger(project.localVersion) && Number(project.localVersion) >= 0 ? Number(project.localVersion) : 0,
        dirty: project.dirty === true,
        syncConflict: project.syncConflict === true,
        nodes: Array.isArray(project.nodes) ? project.nodes : [],
        connections: Array.isArray(project.connections) ? project.connections : [],
        chatSessions: Array.isArray(project.chatSessions) ? project.chatSessions : [],
        activeChatId: typeof project.activeChatId === "string" ? project.activeChatId : null,
        backgroundMode: project.backgroundMode === "dots" || project.backgroundMode === "blank" ? project.backgroundMode : "lines",
        showImageInfo: project.showImageInfo === true,
        viewport: project.viewport && Number.isFinite(project.viewport.x) && Number.isFinite(project.viewport.y) && Number.isFinite(project.viewport.k) ? project.viewport : { x: 0, y: 0, k: 1 },
    };
}

export function transitionCanvasReplica(project: ReplicaCanvasProject, transition: { type: "edit"; patch: CanvasProjectPatch; expectedRemoteRevision?: number } | { type: "acknowledge-save"; localVersion: number; revision: number; updatedAt: string }) {
    if (transition.type === "acknowledge-save") {
        return { accepted: true, changed: true, project: { ...project, revision: transition.revision, updatedAt: transition.updatedAt, dirty: project.localVersion !== transition.localVersion } };
    }
    if (transition.expectedRemoteRevision !== undefined && (project.remoteRevision || 0) !== transition.expectedRemoteRevision) return { accepted: false, changed: false, project };
    if (!Object.entries(transition.patch).some(([key, value]) => differs(project[key as keyof ReplicaCanvasProject], value))) return { accepted: true, changed: false, project };
    return { accepted: true, changed: true, project: { ...project, ...transition.patch, localVersion: project.localVersion + 1, dirty: true } };
}

export function transitionCanvasReplicaState(
    state: CanvasReplicaState,
    transition: { type: "delete"; ids: string[] } | { type: "acknowledge-delete"; id: string } | { type: "restore"; persisted?: { projects?: unknown; tombstones?: unknown } },
): CanvasReplicaState {
    if (transition.type === "restore") {
        const projects = Array.isArray(transition.persisted?.projects) ? transition.persisted.projects.map(normalizeProject).filter((project): project is ReplicaCanvasProject => project !== null) : [];
        const tombstones = Array.isArray(transition.persisted?.tombstones) ? [...new Set(transition.persisted.tombstones.filter((id): id is string => typeof id === "string" && Boolean(id)))] : [];
        return { projects, tombstones };
    }
    if (transition.type === "acknowledge-delete") return { ...state, tombstones: state.tombstones.filter((id) => id !== transition.id) };
    const removed = new Set(transition.ids);
    return { projects: state.projects.filter((project) => !removed.has(project.id)), tombstones: [...new Set([...state.tombstones, ...transition.ids])] };
}

export function captureCanvasReplicaBinding(project: ReplicaCanvasProject, session: CanvasReplicaSession): CanvasReplicaBinding {
    return { projectId: project.id, remoteRevision: project.remoteRevision || 0, ...session };
}

export function matchesCanvasReplicaBinding(project: ReplicaCanvasProject | null | undefined, binding: CanvasReplicaBinding, session: CanvasReplicaSession): project is ReplicaCanvasProject {
    return Boolean(project && project.id === binding.projectId && (project.remoteRevision || 0) === binding.remoteRevision && binding.token === session.token && binding.userId === session.userId);
}

function parseProjectJson(json?: string): Partial<ReplicaCanvasProject> {
    if (!json) return {};
    try {
        return JSON.parse(json) as Partial<ReplicaCanvasProject>;
    } catch {
        return {};
    }
}

function fromRemoteProject(item: RemoteCanvasProject, local: ReplicaCanvasProject | null): ReplicaCanvasProject {
    const parsed = parseProjectJson(item.projectJson);
    return normalizeProject({
        ...local,
        ...parsed,
        id: item.id,
        title: parsed.title || item.name || local?.title,
        createdAt: item.createdAt || local?.createdAt,
        updatedAt: item.updatedAt || local?.updatedAt,
        revision: item.revision || local?.revision,
        remoteRevision: item.revision,
        localVersion: local?.localVersion || 0,
        dirty: false,
        syncConflict: false,
    })!;
}

function sameData(left: Partial<ReplicaCanvasProject>, right: ReplicaCanvasProject) {
    return !dataFields.some((field) => differs(left[field], right[field]));
}

export function mergeCanvasReplicaRemote({ projects, tombstones, updates = [], deletes = [], force = false }: CanvasReplicaState & { updates?: RemoteCanvasProject[]; deletes?: string[]; force?: boolean }) {
    const deleted = new Set(tombstones);
    const map = new Map(projects.filter((project) => !deleted.has(project.id)).map((project) => [project.id, project]));
    const conflictingIds: string[] = [];
    let cursorAccepted = true;
    for (const remote of updates) {
        if (deleted.has(remote.id)) continue;
        const local = map.get(remote.id);
        if (local?.dirty) {
            if ((remote.revision || 0) > local.revision) cursorAccepted = false;
            if (!sameData(parseProjectJson(remote.projectJson), local)) conflictingIds.push(remote.id);
            if (!force) continue;
        }
        if (force || !local || (remote.revision || 0) > local.revision) map.set(remote.id, fromRemoteProject(remote, local || null));
    }
    for (const id of deletes) {
        const local = map.get(id);
        if (local?.dirty && !force) {
            cursorAccepted = false;
            conflictingIds.push(id);
            continue;
        }
        map.delete(id);
    }
    return { projects: Array.from(map.values()), cursorAccepted, conflictingIds };
}

export function getCanvasReplicaPendingWork(projects: ReplicaCanvasProject[], tombstones: string[], options: { previous?: ReplicaCanvasProject[]; inFlight?: Iterable<string> } = {}) {
    const inFlight = new Set(options.inFlight);
    return {
        pendingIds: [...projects.filter((project) => project.dirty).map((project) => project.id), ...tombstones],
        changedIds: projects
            .filter((project) => {
                const previous = options.previous?.find((item) => item.id === project.id);
                return Boolean(previous && project.dirty && dataFields.some((field) => differs(previous[field], project[field])));
            })
            .map((project) => project.id),
        unloadProjects: projects.filter((project) => project.dirty && !project.syncConflict && project.revision > 0 && !inFlight.has(project.id)),
    };
}
