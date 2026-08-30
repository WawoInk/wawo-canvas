import i18n from "@/i18n";
import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";
import type { StoryboardRecord, StoryboardValidation } from "@/pages/storyboard/storyboard";

export type StoryboardRecordSummary = Pick<StoryboardRecord, "id" | "title" | "source" | "options" | "model" | "sourceHash" | "status" | "revision"> & {
    validationStatus: StoryboardValidation["status"] | "";
    sceneCount: number;
    shotCount: number;
    createdAt: string;
    updatedAt: string;
};

export type StoryboardRecordDetail = Omit<StoryboardRecord, "createdAt" | "updatedAt"> &
    Pick<StoryboardRecordSummary, "validationStatus" | "sceneCount" | "shotCount"> & {
        createdAt: string;
        updatedAt: string;
    };

export type StoryboardWorkspaceInput = Omit<StoryboardRecord, "createdAt" | "updatedAt" | "status" | "revision">;
export type CreateStoryboardRecord = Omit<StoryboardWorkspaceInput, "directorPlan" | "document" | "validation"> & Partial<Pick<StoryboardWorkspaceInput, "directorPlan" | "document" | "validation">>;

function authToken() {
    const token = useUserStore.getState().token;
    if (!token) throw new Error(i18n.t("errors.authRequired"));
    return token;
}

export function fetchStoryboardRecords() {
    return apiGet<StoryboardRecordSummary[]>("/api/v1/storyboards", undefined, authToken());
}

export function fetchStoryboardRecord(id: string) {
    return apiGet<StoryboardRecordDetail>(`/api/v1/storyboards/${encodeURIComponent(id)}`, undefined, authToken());
}

export function createStoryboardRecord(record: CreateStoryboardRecord) {
    return apiPost<StoryboardRecordDetail>("/api/v1/storyboards", record, authToken());
}

export function updateStoryboardRecord(id: string, record: StoryboardWorkspaceInput, expectedRevision: number) {
    return apiPut<StoryboardRecordDetail>(`/api/v1/storyboards/${encodeURIComponent(id)}`, { ...record, expectedRevision }, authToken());
}

export function deleteStoryboardRecord(id: string) {
    return apiDelete<void>(`/api/v1/storyboards/${encodeURIComponent(id)}`, authToken());
}
