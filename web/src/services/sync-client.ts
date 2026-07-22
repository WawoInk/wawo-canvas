// web/src/services/sync-client.ts
import localforage from "localforage";
import { isCurrentSession } from "@/lib/account-storage";
import { useUserStore } from "@/stores/use-user-store";

export type Domain = "assets" | "canvas" | "tasks";

type SyncDomainData = {
    cursor?: string;
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
const CANVAS_CURSOR_KEY = "infinite-canvas:canvas_cursor";

function cursorKey(userId: string): string {
    return `${SYNC_CURSOR_KEY}:${userId}`;
}

function canvasCursorKey(userId: string): string {
    return `${CANVAS_CURSOR_KEY}:${userId}`;
}

class SyncClient {
    private applyCallbacks: Map<Domain, (data: SyncDomainData) => boolean | void> = new Map();

    /** 注册各数据域的 delta 应用回调 */
    onDelta(domain: Domain, callback: (data: SyncDomainData) => boolean | void): void {
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
        } catch {
            /* IndexedDB 写入失败不影响功能 */
        }
    }

    async getCanvasCursor(): Promise<string> {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return "";
        try {
            return (await localforage.getItem<string>(canvasCursorKey(userId))) || "";
        } catch {
            return "";
        }
    }

    private async setCanvasCursor(cursor: string): Promise<void> {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return;
        try {
            await localforage.setItem(canvasCursorKey(userId), cursor);
        } catch {
            /* IndexedDB 写入失败不影响功能 */
        }
    }

    /** 重置 cursor（用户切换时调用）*/
    async resetCursor(): Promise<void> {
        const userId = useUserStore.getState().user?.id;
        if (!userId) return;
        try {
            await Promise.all([localforage.removeItem(cursorKey(userId)), localforage.removeItem(canvasCursorKey(userId))]);
        } catch {
            /* ignore */
        }
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
        const session = { token, userId };

        const [cursor, canvasCursor] = await Promise.all([this.getCursor(), this.getCanvasCursor()]);
        const params = new URLSearchParams();
        if (cursor) params.set("cursor", cursor);
        if (canvasCursor) params.set("canvasCursor", canvasCursor);
        params.set("domains", domains);

        try {
            const resp = await fetch(`/api/v1/sync?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!resp.ok) return;
            const json = await resp.json();
            if (json.code !== 0) return;
            const current = useUserStore.getState();
            if (!isCurrentSession(session, { token: current.token, userId: current.user?.id })) return;

            const delta = json.data as SyncDelta;
            const accepted = this.applyDelta(delta);

            if (delta.cursor) {
                await this.setCursor(delta.cursor);
            }
            if (accepted.canvas && delta.canvas?.cursor !== undefined) {
                await this.setCanvasCursor(delta.canvas.cursor);
            }
        } catch {
            /* 网络错误，下次重试 */
        }
    }

    private applyDelta(delta: SyncDelta): Record<Domain, boolean> {
        const accepted = { assets: true, canvas: true, tasks: true };
        for (const domain of ["assets", "canvas", "tasks"] as Domain[]) {
            const callback = this.applyCallbacks.get(domain);
            if (!callback) continue;
            accepted[domain] = callback(delta[domain]) !== false;
        }
        return accepted;
    }
}

export const syncClient = new SyncClient();
