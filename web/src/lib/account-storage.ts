import type { StateStorage } from "zustand/middleware";

type SessionIdentity = { token: string; userId?: string };

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

export function createAccountStorage(storage: StateStorage, getAccountId: () => string | undefined, canWrite = () => true): StateStorage {
    return {
        getItem: async (name) => {
            const accountId = getAccountId();
            if (!accountId) return null;
            const value = await storage.getItem(`${name}:${accountId}`);
            return getAccountId() === accountId ? value : null;
        },
        setItem: (name, value) => {
            const accountId = getAccountId();
            return accountId && canWrite() ? storage.setItem(`${name}:${accountId}`, value) : undefined;
        },
        removeItem: (name) => {
            const accountId = getAccountId();
            return accountId ? storage.removeItem(`${name}:${accountId}`) : undefined;
        },
    };
}
