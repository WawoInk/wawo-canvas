import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import { createGeneration } from "../src/services/api/generations.ts";
import { requestImageQuestion } from "../src/services/api/image.ts";
import { startCreditBalanceSync } from "../src/services/credit-balance-sync.ts";
import { defaultConfig } from "../src/stores/use-config-store.ts";
import { useUserStore } from "../src/stores/use-user-store.ts";

const user = {
    id: "user-1",
    username: "deploy-user",
    email: "",
    displayName: "Deploy User",
    avatarUrl: "",
    role: "user" as const,
    credits: 0,
    createdAt: "",
    updatedAt: "",
};

test("session hydration keeps the token on transient failures and clears an invalid JWT", async () => {
    const originalAdapter = axios.defaults.adapter;
    const reset = () => useUserStore.setState({ token: "persisted-jwt", user, isReady: false, isLoading: false });

    try {
        reset();
        axios.defaults.adapter = async () => {
            throw new Error("offline");
        };
        await useUserStore.getState().hydrateUser();
        assert.equal(useUserStore.getState().token, "persisted-jwt");

        reset();
        axios.defaults.adapter = async (config) => ({
            config,
            data: { code: 1, data: null, msg: "temporary upstream failure" },
            headers: {},
            status: 503,
            statusText: "Service Unavailable",
        });
        await useUserStore.getState().hydrateUser();
        assert.equal(useUserStore.getState().token, "persisted-jwt");

        reset();
        axios.defaults.adapter = async (config) => ({
            config,
            data: { code: 0, data: { ...user, id: "", role: "guest" }, msg: "" },
            headers: {},
            status: 200,
            statusText: "OK",
        });
        await useUserStore.getState().hydrateUser();
        assert.equal(useUserStore.getState().token, "");
    } finally {
        axios.defaults.adapter = originalAdapter;
    }
});

test("backend generation requests refresh the shared balance after charges and refunds", async () => {
    const originalAdapter = axios.defaults.adapter;
    const requests: string[] = [];
    const stopCreditBalanceSync = startCreditBalanceSync();
    let credits = 88;
    let generationStatus = 200;
    useUserStore.setState({ token: "credits-jwt", user: { ...user, credits: 100 }, isReady: true, isLoading: false });

    try {
        axios.defaults.adapter = async (config) => {
            requests.push(config.url || "");
            const isCurrentUser = config.url === "/api/auth/me";
            return {
                config,
                data: isCurrentUser
                    ? { code: 0, data: { ...user, credits }, msg: "" }
                    : generationStatus === 200
                      ? { code: 0, data: { id: "generation-1", status: "queued", modelProfileId: "profile-1", intentKind: "video.generate", createdAt: "" }, msg: "" }
                      : { code: 1, data: null, msg: "上游失败，积分已退回" },
                headers: {},
                status: isCurrentUser ? 200 : generationStatus,
                statusText: isCurrentUser || generationStatus === 200 ? "OK" : "Bad Gateway",
            };
        };

        const command = {
            commandVersion: 1,
            clientRequestId: "request-1",
            modelProfileId: "profile-1",
            source: "canvas",
            intent: { kind: "video.generate", prompt: "测试", references: { images: [], videos: [], audios: [] } },
        } as const;
        await createGeneration(command);
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(requests, ["/api/v1/generations", "/api/auth/me"]);
        assert.equal(useUserStore.getState().user?.credits, 88);

        requests.length = 0;
        credits = 100;
        generationStatus = 502;
        await assert.rejects(createGeneration(command), /上游失败/);
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(requests, ["/api/v1/generations", "/api/auth/me"]);
        assert.equal(useUserStore.getState().user?.credits, 100);
    } finally {
        stopCreditBalanceSync();
        axios.defaults.adapter = originalAdapter;
    }
});

test("remote text generation refreshes the shared credit balance after the stream ends", async () => {
    const originalAdapter = axios.defaults.adapter;
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    useUserStore.setState({ token: "text-credits-jwt", user: { ...user, credits: 100 }, isReady: true, isLoading: false });

    try {
        globalThis.fetch = (async (input) => {
            requests.push(String(input));
            return {
                ok: true,
                body: null,
                json: async () => ({ choices: [{ message: { content: "完成" } }] }),
            } as Response;
        }) as typeof fetch;
        axios.defaults.adapter = async (config) => {
            requests.push(config.url || "");
            return {
                config,
                data: { code: 0, data: { ...user, credits: 91 }, msg: "" },
                headers: {},
                status: 200,
                statusText: "OK",
            };
        };

        await requestImageQuestion({ ...defaultConfig, channelMode: "remote", model: "gpt-5.5", textModel: "gpt-5.5" }, [{ role: "user", content: "测试" }], () => {});
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(requests, ["/api/v1/chat/completions", "/api/auth/me"]);
        assert.equal(useUserStore.getState().user?.credits, 91);
    } finally {
        globalThis.fetch = originalFetch;
        axios.defaults.adapter = originalAdapter;
    }
});
