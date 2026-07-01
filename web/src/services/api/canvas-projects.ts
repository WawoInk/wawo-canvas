import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";

export interface CanvasProjectItem {
    id: string;
    name: string;
    version: number;
    updatedAt: string;
    createdAt: string;
}

export interface CanvasProjectDetail {
    id: string;
    userId: string;
    name: string;
    projectJson: string;
    version: number;
    createdAt: string;
    updatedAt: string;
}

function authToken() {
    return useUserStore.getState().token;
}

export async function fetchCanvasProjects(): Promise<CanvasProjectItem[]> {
    const token = authToken();
    return apiGet<CanvasProjectItem[]>("/api/v1/canvas/projects", undefined, token);
}

export async function createCanvasProject(name: string, project: unknown): Promise<CanvasProjectDetail> {
    const token = authToken();
    return apiPost<CanvasProjectDetail>("/api/v1/canvas/projects", { name, project }, token);
}

export async function updateCanvasProject(id: string, project: unknown): Promise<CanvasProjectDetail> {
    const token = authToken();
    return apiPut<CanvasProjectDetail>(`/api/v1/canvas/projects/${encodeURIComponent(id)}`, { project }, token);
}

export async function deleteCanvasProject(id: string): Promise<void> {
    const token = authToken();
    return apiDelete<void>(`/api/v1/canvas/projects/${encodeURIComponent(id)}`, token);
}
