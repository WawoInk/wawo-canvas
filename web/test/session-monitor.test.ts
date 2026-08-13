import assert from "node:assert/strict";
import test from "node:test";

import { revalidateSession, startAuthStorageMonitor, startSessionMonitor } from "../src/services/session-monitor.ts";

test("clears an expired session without logging out on a network failure", async () => {
    let clears = 0;

    await revalidateSession(
        "expired",
        async () => ({ role: "guest" }),
        () => {
            clears += 1;
        },
    );
    await revalidateSession(
        "offline",
        async () => Promise.reject(new Error("offline")),
        () => {
            clears += 1;
        },
    );

    assert.equal(clears, 1);
});

test("revalidates a signed-in session periodically and when the page becomes visible", async () => {
    const listeners = new Map<string, () => void>();
    const originalDocument = globalThis.document;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let interval: (() => void) | undefined;
    let validations = 0;

    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            visibilityState: "visible",
            addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
            removeEventListener: (type: string) => listeners.delete(type),
        },
    });
    globalThis.setInterval = ((callback: () => void) => {
        interval = callback;
        return 1;
    }) as typeof setInterval;
    globalThis.clearInterval = (() => {}) as typeof clearInterval;

    try {
        const stop = startSessionMonitor(async () => {
            validations += 1;
        });

        interval?.();
        listeners.get("visibilitychange")?.();
        await Promise.resolve();

        assert.equal(validations, 2);
        stop();
        assert.equal(listeners.has("visibilitychange"), false);
    } finally {
        Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

test("notifies a stale window when another window changes the authenticated account", () => {
    const listeners = new Map<string, (event: StorageEvent) => void>();
    const originalWindow = globalThis.window;
    let changes = 0;

    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            addEventListener: (type: string, listener: (event: StorageEvent) => void) => listeners.set(type, listener),
            removeEventListener: (type: string) => listeners.delete(type),
        },
    });

    try {
        const stop = startAuthStorageMonitor(
            "auth",
            () => ({ token: "token-a", userId: "user-a" }),
            () => {
                changes += 1;
            },
        );

        listeners.get("storage")?.({ key: "other", newValue: null } as StorageEvent);
        listeners.get("storage")?.({ key: "auth", newValue: JSON.stringify({ state: { token: "token-a", user: { id: "user-a" } } }) } as StorageEvent);
        listeners.get("storage")?.({ key: "auth", newValue: JSON.stringify({ state: { token: "token-b", user: { id: "user-b" } } }) } as StorageEvent);

        assert.equal(changes, 1);
        stop();
        assert.equal(listeners.has("storage"), false);
    } finally {
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});
