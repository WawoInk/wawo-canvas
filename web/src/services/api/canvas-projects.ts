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
    if (!token) throw new Error("未登录");
    return apiGet<CanvasProjectItem[]>("/api/v1/canvas/projects", undefined, token);
}

export async function fetchCanvasProject(id: string): Promise<CanvasProjectDetail> {
    const token = authToken();
    if (!token) throw new Error("未登录");
    return apiGet<CanvasProjectDetail>(`/api/v1/canvas/projects/${encodeURIComponent(id)}`, undefined, token);
}

export async function createCanvasProject(name: string, project: unknown): Promise<CanvasProjectDetail> {
    const token = authToken();
    return apiPost<CanvasProjectDetail>("/api/v1/canvas/projects", { name, project }, token);
}

/**
 * Update a canvas project. `body` is sent verbatim as the PUT body and may include
 * `{ project, expectedUpdatedAt }` for the optimistic-lock update path.
 */
export async function updateCanvasProject(id: string, body: unknown): Promise<CanvasProjectDetail> {
    const token = authToken();
    return apiPut<CanvasProjectDetail>(`/api/v1/canvas/projects/${encodeURIComponent(id)}`, body, token);
}

export async function deleteCanvasProject(id: string): Promise<void> {
    const token = authToken();
    return apiDelete<void>(`/api/v1/canvas/projects/${encodeURIComponent(id)}`, token);
}
