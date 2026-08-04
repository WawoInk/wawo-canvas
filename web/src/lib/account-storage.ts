import type { StateStorage } from "zustand/middleware";

type SessionIdentity = { token: string; userId?: string };
export type AccountStorage = StateStorage & { flush: (name: string) => Promise<void> };

export function accountStoreName(name: string, accountId: string) {
    return `${name}_${accountId}`;
}

export function sessionChanged(previous: SessionIdentity, current: SessionIdentity) {
    return previous.token !== current.token || previous.userId !== current.userId;
}

export function isCurrentSession(started: SessionIdentity, current: SessionIdentity) {
    return !sessionChanged(started, current);
}

export function canRenderProtectedData(isReady: boolean, hasUser: boolean) {
    return isReady && hasUser;
}

export function createAccountStorage(storage: StateStorage, getAccountId: () => string | undefined, canWrite = () => true): AccountStorage {
    const pendingWrites = new Map<string, Promise<void>>();
    const enqueue = (key: string, operation: () => unknown | Promise<unknown>) => {
        const current = (pendingWrites.get(key) || Promise.resolve())
            .catch(() => {})
            .then(async () => {
                await operation();
            });
        pendingWrites.set(key, current);
        void current.then(
            () => {
                if (pendingWrites.get(key) === current) pendingWrites.delete(key);
            },
            () => {},
        );
        return current;
    };

    return {
        getItem: async (name) => {
            const accountId = getAccountId();
            if (!accountId) return null;
            const value = await storage.getItem(`${name}:${accountId}`);
            return getAccountId() === accountId ? value : null;
        },
        setItem: (name, value) => {
            const accountId = getAccountId();
            if (!accountId || !canWrite()) return;
            const key = `${name}:${accountId}`;
            return enqueue(key, () => storage.setItem(key, value));
        },
        removeItem: (name) => {
            const accountId = getAccountId();
            if (!accountId) return;
            const key = `${name}:${accountId}`;
            return enqueue(key, () => storage.removeItem(key));
        },
        flush: async (name) => {
            const accountId = getAccountId();
            if (!accountId) return;
            const key = `${name}:${accountId}`;
            while (true) {
                const pending = pendingWrites.get(key);
                if (!pending) return;
                await pending;
                if (pendingWrites.get(key) === pending) return;
            }
        },
    };
}
