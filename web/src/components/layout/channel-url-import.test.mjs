import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { importChannelCredentials } from "./channel-url-import";

const first = { id: "first", name: "首个渠道", baseUrl: "https://first.example", apiKey: "first-secret", apiFormat: "gemini", models: ["first-model"] };
const second = { id: "second", name: "已有供应商", baseUrl: "https://provider.example/v1/", apiKey: "old-secret", apiFormat: "xvanai", models: ["second-model"] };
let original;
beforeEach(() => {
    original = { ...defaultConfig, channelMode: "remote", channels: [first, second] };
    useConfigStore.setState({ config: original, configHydrated: true, publicSettings: { modelChannel: { allowCustomChannel: true } }, isConfigOpen: false });
});

test("URL credentials update the normalized matching channel, not the first or active selection", () => {
    const result = importChannelCredentials({ baseUrl: " HTTPS://PROVIDER.EXAMPLE:443/#fragment ", apiKey: " new-secret " });
    assert.deepEqual(result, { status: "updated", channelName: "已有供应商" });
    assert.deepEqual(useConfigStore.getState().config, { ...original, channels: [first, { ...second, baseUrl: "https://provider.example", apiKey: "new-secret" }] });
});

test("an unmatched provider is appended without changing existing credentials or model selections", () => {
    const result = importChannelCredentials({ baseUrl: "https://api.new.example/v1/", apiKey: " new-key " });
    assert.deepEqual(result, { status: "created", channelName: "new.example" });
    const config = useConfigStore.getState().config;
    const added = config.channels[2];
    assert.ok(added.id && ![first.id, second.id].includes(added.id));
    assert.deepEqual(config, { ...original, channels: [first, second, { id: added.id, name: "new.example", baseUrl: "https://api.new.example/v1", apiKey: "new-key", apiFormat: "openai", models: [] }] });
});

test("missing or invalid HTTP Base URLs leave the entire configuration untouched", () => {
    for (const baseUrl of [undefined, null, "", "   ", "not-a-url", "/v1", "ftp://provider.example", "javascript:alert(1)", "https://"]) {
        const result = importChannelCredentials({ baseUrl, apiKey: "must-not-write" });
        assert.equal(result.status, baseUrl?.trim() ? "invalid-base-url" : "missing-base-url");
        assert.equal(useConfigStore.getState().config, original);
    }
});

test("platform denial or unavailable settings cannot be bypassed through imported credentials", () => {
    for (const publicSettings of [{ modelChannel: { allowCustomChannel: false } }, null]) {
        useConfigStore.setState({ publicSettings });
        assert.equal(importChannelCredentials({ baseUrl: "https://provider.example", apiKey: "blocked" }).status, publicSettings ? "disabled" : "pending");
        assert.equal(useConfigStore.getState().config, original);
        assert.equal(useConfigStore.getState().isConfigOpen, false);
    }
});

test("reimporting identical credentials or a blank key preserves the saved key and configuration", () => {
    original = { ...original, channels: [first, { ...second, baseUrl: "https://provider.example/v1" }] };
    useConfigStore.setState({ config: original });
    for (const apiKey of [undefined, null, "", "   ", " old-secret "]) {
        assert.equal(importChannelCredentials({ baseUrl: "https://provider.example/v1", apiKey }).status, "updated");
        assert.equal(useConfigStore.getState().config, original);
    }
});

test("a malformed saved URL does not block importing another provider", () => {
    const broken = { ...first, baseUrl: "unfinished" };
    original = { ...original, channels: [broken, second] };
    useConfigStore.setState({ config: original });
    assert.equal(importChannelCredentials({ baseUrl: "https://provider.example/V1/", apiKey: "replacement" }).status, "updated");
    assert.deepEqual(useConfigStore.getState().config, { ...original, channels: [broken, { ...second, baseUrl: "https://provider.example/V1", apiKey: "replacement" }] });
});
