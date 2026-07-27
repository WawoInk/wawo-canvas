import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

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
