import type { CanvasBackgroundMode } from "../../../lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";

export type ReplicaCanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    localVersion: number;
    dirty: boolean;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export function normalizeCanvasProject(value: unknown): ReplicaCanvasProject | null {
    if (!value || typeof value !== "object") return null;
    const project = value as Partial<ReplicaCanvasProject> & { name?: string };
    if (typeof project.id !== "string" || !project.id) return null;
    return {
        id: project.id,
        title: project.title || project.name || "未命名画布",
        createdAt: typeof project.createdAt === "string" ? project.createdAt : "",
        updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : "",
        revision: Number.isSafeInteger(project.revision) && Number(project.revision) >= 0 ? Number(project.revision) : 0,
        localVersion: Number.isSafeInteger(project.localVersion) && Number(project.localVersion) >= 0 ? Number(project.localVersion) : 0,
        dirty: project.dirty === true,
        nodes: Array.isArray(project.nodes) ? project.nodes : [],
        connections: Array.isArray(project.connections) ? project.connections : [],
        chatSessions: Array.isArray(project.chatSessions) ? project.chatSessions : [],
        activeChatId: typeof project.activeChatId === "string" ? project.activeChatId : null,
        backgroundMode: project.backgroundMode === "dots" || project.backgroundMode === "blank" ? project.backgroundMode : "lines",
        showImageInfo: project.showImageInfo === true,
        viewport: project.viewport && Number.isFinite(project.viewport.x) && Number.isFinite(project.viewport.y) && Number.isFinite(project.viewport.k) ? project.viewport : { x: 0, y: 0, k: 1 },
    };
}
