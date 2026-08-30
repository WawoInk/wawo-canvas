import i18n from "@/i18n";
import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";
import type { ScriptAgentStage, ScriptAgentWorkspace, ScriptProjectConfigInput } from "@/pages/storyboard/script-agent";

export type ScriptProjectMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
};

export type ScriptProjectConversation = {
    id: string;
    title: string;
    messages: ScriptProjectMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ScriptProjectSummary = {
    id: string;
    projectId: string;
    title: string;
    source: string;
    currentStage: ScriptAgentStage;
    version: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type ScriptProjectWorkspace = ScriptAgentWorkspace & {
    title: string;
    source: string;
    configDraft?: Partial<ScriptProjectConfigInput>;
    messages: ScriptProjectMessage[];
    conversations: ScriptProjectConversation[];
    activeConversationId: string;
    revision?: number;
    createdAt?: string;
};

export type ScriptProjectDetail = ScriptProjectWorkspace & {
    revision: number;
    createdAt: string;
};

function authToken() {
    const token = useUserStore.getState().token;
    if (!token) throw new Error(i18n.t("errors.authRequired"));
    return token;
}

export async function fetchScriptProjects(): Promise<ScriptProjectSummary[]> {
    return apiGet<ScriptProjectSummary[]>("/api/v1/scripts", undefined, authToken());
}

export async function fetchScriptProject(id: string): Promise<ScriptProjectDetail> {
    return apiGet<ScriptProjectDetail>(`/api/v1/scripts/${encodeURIComponent(id)}`, undefined, authToken());
}

export async function createScriptProject(workspace: ScriptProjectWorkspace): Promise<ScriptProjectDetail> {
    return apiPost<ScriptProjectDetail>("/api/v1/scripts", workspace, authToken());
}

export async function updateScriptProject(id: string, workspace: ScriptProjectWorkspace, expectedRevision: number): Promise<ScriptProjectDetail> {
    return apiPut<ScriptProjectDetail>(`/api/v1/scripts/${encodeURIComponent(id)}`, { ...workspace, expectedRevision }, authToken());
}

export async function renameScriptProject(id: string, title: string, expectedRevision: number): Promise<ScriptProjectDetail> {
    return apiPut<ScriptProjectDetail>(`/api/v1/scripts/${encodeURIComponent(id)}/title`, { title: title.trim(), expectedRevision }, authToken());
}

export async function deleteScriptProject(id: string): Promise<void> {
    return apiDelete<void>(`/api/v1/scripts/${encodeURIComponent(id)}`, authToken());
}
