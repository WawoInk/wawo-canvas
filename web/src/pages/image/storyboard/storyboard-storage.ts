import localforage from "localforage";

import { accountStoreName } from "@/lib/account-storage";
import { useUserStore } from "@/stores/use-user-store";
import type { StoryboardRecord } from "./storyboard";

function storyboardStore(userId = useUserStore.getState().user?.id || "anonymous") {
    return localforage.createInstance({ name: "infinite-canvas", storeName: accountStoreName("storyboard_documents", userId) });
}

export async function listStoryboardRecords(userId?: string) {
    const records: StoryboardRecord[] = [];
    await storyboardStore(userId).iterate<StoryboardRecord, void>((record) => records.push(record));
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveStoryboardRecord(record: StoryboardRecord, userId?: string) {
    await storyboardStore(userId).setItem(record.id, record);
    return record;
}

export async function deleteStoryboardRecord(id: string, userId?: string) {
    await storyboardStore(userId).removeItem(id);
}
