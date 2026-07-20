import assert from "node:assert/strict";
import test from "node:test";

import { revalidateSession, startSessionMonitor } from "../src/services/session-monitor.ts";

test("clears an expired session without logging out on a network failure", async () => {
    let clears = 0;

    await revalidateSession("expired", async () => ({ role: "guest" }), () => {
        clears += 1;
    });
    await revalidateSession("offline", async () => Promise.reject(new Error("offline")), () => {
        clears += 1;
    });

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
