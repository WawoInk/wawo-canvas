import {
    createStoryboardRecord,
    deleteStoryboardRecord as deleteStoryboard,
    fetchStoryboardRecord,
    fetchStoryboardRecords,
    updateStoryboardRecord,
    type StoryboardRecordDetail,
    type StoryboardRecordSummary as ServerStoryboardRecordSummary,
} from "@/services/api/storyboards";
import type { StoryboardRecord } from "./storyboard";

export type StoryboardRecordSummary = Omit<ServerStoryboardRecordSummary, "createdAt" | "updatedAt"> & {
    createdAt: number;
    updatedAt: number;
};

function timestamp(value: string) {
    return Date.parse(value);
}

function toStoryboardRecord(record: StoryboardRecordDetail): StoryboardRecord {
    const { validationStatus: _validationStatus, sceneCount: _sceneCount, shotCount: _shotCount, createdAt, updatedAt, ...detail } = record;
    return { ...detail, createdAt: timestamp(createdAt), updatedAt: timestamp(updatedAt) };
}

export async function listStoryboardRecords(): Promise<StoryboardRecordSummary[]> {
    return (await fetchStoryboardRecords()).map((record) => ({ ...record, createdAt: timestamp(record.createdAt), updatedAt: timestamp(record.updatedAt) }));
}

export async function loadStoryboardRecord(id: string): Promise<StoryboardRecord> {
    return toStoryboardRecord(await fetchStoryboardRecord(id));
}

export async function saveStoryboardRecord(record: StoryboardRecord): Promise<StoryboardRecord> {
    const { createdAt: _createdAt, updatedAt: _updatedAt, status: _status, revision, ...input } = record;
    return toStoryboardRecord(await (revision > 0 ? updateStoryboardRecord(record.id, input, revision) : createStoryboardRecord(input)));
}

export function storyboardConflictRecord(error: unknown): StoryboardRecord | null {
    if (!error || typeof error !== "object" || Number((error as { status?: number }).status) !== 409) return null;
    const current = (error as { data?: { current?: unknown } }).data?.current;
    return current && typeof current === "object" ? toStoryboardRecord(current as StoryboardRecordDetail) : null;
}

export function deleteStoryboardRecord(id: string) {
    return deleteStoryboard(id);
}
