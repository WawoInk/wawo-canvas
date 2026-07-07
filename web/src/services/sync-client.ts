// web/src/services/sync-client.ts
import localforage from "localforage";
import { useUserStore } from "@/stores/use-user-store";

export type Domain = "assets" | "canvas" | "tasks";

type SyncDomainData = {
    updates: any[];
    deletes: string[];
};

type SyncDelta = {
    cursor: string;
    assets: SyncDomainData;
    canvas: SyncDomainData;
    tasks: SyncDomainData;
};

const SYNC_CURSOR_KEY = "infinite-canvas:sync_cursor";

function cursorKey(userId: string): string {
    return `${SYNC_CURSOR_KEY}:${userId}`;
}

class SyncClient {
    private applyCallbacks: Map<Domain, (data: SyncDomainData) => void> = new Map();

    /** 注册各数据域的 delta 应用回调 */
    onDelta(domain: Domain, callback: (data: SyncDomainData) => void): void {
        this.applyCallbacks.set(domain, callback);
    }

    /** 获取当前 cursor */
    async getCursor(): Promise<string> {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return "";
        try {
            return (await localforage.getItem<string>(cursorKey(userId))) || "";
        } catch {
            return "";
        }
    }

    /** 持久化 cursor */
    private async setCursor(cursor: string): Promise<void> {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return;
        try {
            if (cursor) {
                await localforage.setItem(cursorKey(userId), cursor);
            }
        } catch { /* IndexedDB 写入失败不影响功能 */ }
    }

    /** 重置 cursor（用户切换时调用）*/
    async resetCursor(): Promise<void> {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return;
        try {
            await localforage.removeItem(cursorKey(userId));
        } catch { /* ignore */ }
    }

    /** 全量同步所有域 */
    async syncAll(): Promise<void> {
        await this.syncDomains("assets,canvas,tasks");
    }

    /** 同步指定数据域 */
    async syncDomain(domain: Domain): Promise<void> {
        await this.syncDomains(domain);
    }

    private async syncDomains(domains: string): Promise<void> {
        const userId = useUserStore.getState().user?.id;
        const token = useUserStore.getState().token;
        if (!userId || !token) return;

        const cursor = await this.getCursor();
        const params = new URLSearchParams();
        if (cursor) params.set("cursor", cursor);
        params.set("domains", domains);

        try {
            const resp = await fetch(`/api/v1/sync?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!resp.ok) return;
            const json = await resp.json();
            if (json.code !== 0) return;

            const delta = json.data as SyncDelta;
            this.applyDelta(delta);

            // 持久化新 cursor
            if (delta.cursor) {
                await this.setCursor(delta.cursor);
            }
        } catch { /* 网络错误，下次重试 */ }
    }

    private applyDelta(delta: SyncDelta): void {
        for (const domain of ["assets", "canvas", "tasks"] as Domain[]) {
            const callback = this.applyCallbacks.get(domain);
            if (!callback) continue;
            callback(delta[domain]);
        }
    }
}

export const syncClient = new SyncClient();
