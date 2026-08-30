import { createStoryboardRecord, deleteStoryboardRecord as deleteStoryboard, fetchStoryboardRecord, fetchStoryboardRecords, type StoryboardRecordSummary as ServerStoryboardRecordSummary } from "@/services/api/storyboards";
import type { StoryboardRecord } from "./storyboard";

export type StoryboardRecordSummary = Omit<ServerStoryboardRecordSummary, "createdAt" | "updatedAt"> & {
    createdAt: number;
    updatedAt: number;
};

function timestamp(value: string) {
    return Date.parse(value);
}

function toStoryboardRecord(record: Awaited<ReturnType<typeof fetchStoryboardRecord>>): StoryboardRecord {
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
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...input } = record;
    return toStoryboardRecord(await createStoryboardRecord(input));
}

export function deleteStoryboardRecord(id: string) {
    return deleteStoryboard(id);
}
