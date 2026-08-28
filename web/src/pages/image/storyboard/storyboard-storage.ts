import localforage from "localforage";

import { accountStoreName } from "@/lib/account-storage";
import { useUserStore } from "@/stores/use-user-store";
import type { StoryboardRecord } from "./storyboard";

function storyboardStore() {
    const userId = useUserStore.getState().user?.id || "anonymous";
    return localforage.createInstance({ name: "infinite-canvas", storeName: accountStoreName("storyboard_documents", userId) });
}

export async function listStoryboardRecords() {
    const records: StoryboardRecord[] = [];
    await storyboardStore().iterate<StoryboardRecord, void>((record) => records.push(record));
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveStoryboardRecord(record: StoryboardRecord) {
    await storyboardStore().setItem(record.id, record);
    return record;
}

export async function deleteStoryboardRecord(id: string) {
    await storyboardStore().removeItem(id);
}
