import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_TOKEN_KEY } from "../src/services/api/auth.ts";
import { uploadBlob } from "../src/services/upload-blob.ts";
import { useUserStore } from "../src/stores/use-user-store.ts";

const user = {
    id: "user-a",
    username: "user-a",
    email: "",
    displayName: "User A",
    avatarUrl: "",
    role: "user" as const,
    credits: "0",
    createdAt: "",
    updatedAt: "",
};
const otherUser = { ...user, id: "user-b", username: "user-b", displayName: "User B" };

test("an upload keeps the current tab account when another window changes persisted auth", async () => {
    const originalFetch = globalThis.fetch;
    const originalLocalStorage = globalThis.localStorage;
    let authorization = "";

    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => (key === AUTH_TOKEN_KEY ? JSON.stringify({ state: { token: "token-b", user: otherUser } }) : null),
            setItem: () => {},
            removeItem: () => {},
        },
    });
    useUserStore.setState({ token: "token-a", user, isReady: true, isLoading: false });
    globalThis.fetch = (async (_input, init) => {
        authorization = new Headers(init?.headers).get("Authorization") || "";
        return { json: async () => ({ code: 1, msg: "captured upload request" }) } as Response;
    }) as typeof fetch;

    try {
        await assert.rejects(uploadBlob(new Blob(["image"], { type: "image/png" }), "images"), /captured upload request/);
        assert.equal(authorization, "Bearer token-a");
    } finally {
        useUserStore.setState({ token: "", user: null, isReady: true, isLoading: false });
        globalThis.fetch = originalFetch;
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
    }
});

test("an upload result is rejected when the tab account changes in flight", async () => {
    const originalFetch = globalThis.fetch;
    let authorization = "";
    let releaseResponse = () => {};
    const responseGate = new Promise<void>((resolve) => {
        releaseResponse = resolve;
    });

    useUserStore.setState({ token: "token-a", user, isReady: true, isLoading: false });
    globalThis.fetch = (async (_input, init) => {
        authorization = new Headers(init?.headers).get("Authorization") || "";
        return {
            json: async () => {
                await responseGate;
                return { code: 0, data: { id: "file-a", url: "https://example.test/file-a", mimeType: "image/png", bytes: 5 } };
            },
        } as Response;
    }) as typeof fetch;

    try {
        const pendingUpload = uploadBlob(new Blob(["image"], { type: "image/png" }), "images");
        useUserStore.setState({ token: "token-b", user: otherUser, isReady: true, isLoading: false });
        releaseResponse();

        await assert.rejects(pendingUpload);
        assert.equal(authorization, "Bearer token-a");
    } finally {
        useUserStore.setState({ token: "", user: null, isReady: true, isLoading: false });
        globalThis.fetch = originalFetch;
    }
});
