import assert from "node:assert/strict";
import { test } from "node:test";

import { accountStoreName, canRenderProtectedData, createAccountStorage, isCurrentSession, sessionChanged } from "../src/lib/account-storage.ts";

test("browser business data follows the signed-in account", async () => {
    const values = new Map<string, string>();
    let accountId: string | undefined;
    const storage = createAccountStorage(
        {
            getItem: async (key) => values.get(key) ?? null,
            setItem: async (key, value) => void values.set(key, value),
            removeItem: async (key) => void values.delete(key),
        },
        () => accountId,
    );

    accountId = "enterprise-a";
    await storage.setItem("projects", "A projects");
    accountId = "enterprise-b";
    assert.equal(await storage.getItem("projects"), null);
    await storage.setItem("projects", "B projects");
    accountId = "personal";
    assert.equal(await storage.getItem("projects"), null);
    accountId = "enterprise-a";
    assert.equal(await storage.getItem("projects"), "A projects");
    accountId = "enterprise-b";
    assert.equal(await storage.getItem("projects"), "B projects");

    accountId = undefined;
    await storage.setItem("projects", "signed out");
    assert.equal(await storage.getItem("projects"), null);
});

test("protected query data expires when the account or session changes", () => {
    const enterpriseA = { token: "token-a", userId: "enterprise-a" };

    assert.equal(sessionChanged(enterpriseA, { token: "token-b", userId: "enterprise-b" }), true);
    assert.equal(sessionChanged(enterpriseA, { token: "", userId: undefined }), true);
    assert.equal(sessionChanged(enterpriseA, { token: "token-a-new", userId: "enterprise-a" }), true);
    assert.equal(sessionChanged(enterpriseA, enterpriseA), false);
});

test("protected pages wait for the authenticated account", () => {
    assert.equal(canRenderProtectedData(false, false), false);
    assert.equal(canRenderProtectedData(true, false), false);
    assert.equal(canRenderProtectedData(true, true), true);
});

test("a delayed browser read cannot hydrate the next account", async () => {
    let release!: (value: string) => void;
    let accountId: string | undefined = "enterprise-a";
    const storage = createAccountStorage(
        {
            getItem: () => new Promise((resolve) => (release = resolve)),
            setItem: () => undefined,
            removeItem: () => undefined,
        },
        () => accountId,
    );

    const pending = storage.getItem("projects");
    accountId = "enterprise-b";
    release("A projects");

    assert.equal(await pending, null);
});

test("a response from the previous account is rejected", () => {
    assert.equal(isCurrentSession({ token: "token-a", userId: "enterprise-a" }, { token: "token-b", userId: "enterprise-b" }), false);
    assert.equal(isCurrentSession({ token: "token-b", userId: "enterprise-b" }, { token: "token-b", userId: "enterprise-b" }), true);
});

test("workbench history stores are account scoped", () => {
    assert.equal(accountStoreName("image_generation_logs", "enterprise-a"), "image_generation_logs_enterprise-a");
    assert.equal(accountStoreName("image_generation_logs", "enterprise-b"), "image_generation_logs_enterprise-b");
});
