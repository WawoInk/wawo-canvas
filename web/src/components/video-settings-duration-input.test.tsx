import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const axios = (await import("axios")).default;
const { ConfigProvider } = await import("antd");
const { act, createElement, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { canvasThemes } = await import("@/lib/canvas-theme");
const { defaultConfig } = await import("@/stores/use-config-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { VideoSettingsPanel } = await import("./video-settings-panel");

test("video duration slider retains two-digit selections within the Profile maximum", async () => {
    const previousRequest = axios.request;
    const previousUserState = useUserStore.getState();
    axios.request = (async (config: { url?: string }) => {
        if (config.url !== "/api/v1/model-profiles") throw new Error(`unexpected request: ${config.url}`);
        return {
            status: 200,
            statusText: "OK",
            headers: {},
            config: {},
            data: {
                code: 0,
                msg: "",
                data: [
                    {
                        id: "video-profile-30",
                        intents: ["video.generate"],
                        capabilities: {
                            settings: {
                                aspectRatio: { type: "enum", values: ["16:9"], default: "16:9" },
                                resolution: { type: "enum", values: ["720p"], default: "720p" },
                                durationSeconds: { type: "duration", min: 4, max: 30, default: 5 },
                            },
                            cancellation: false,
                            completion: ["poll"],
                        },
                    },
                ],
            },
        };
    }) as typeof axios.request;
    useUserStore.setState({ ...previousUserState, token: "duration-input-token", isReady: true, isLoading: false });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let latestSeconds = "5";

    function Harness() {
        const [config, setConfig] = useState({ ...defaultConfig, channelMode: "remote" as const, model: "video-profile-30", videoModel: "video-profile-30", videoSeconds: "5" });
        latestSeconds = config.videoSeconds;
        return createElement(
            ConfigProvider,
            null,
            createElement(VideoSettingsPanel, {
                config,
                theme: canvasThemes.light,
                allowAutoDuration: false,
                onConfigChange: (key, value) => setConfig((current) => ({ ...current, [key]: value })),
            }),
        );
    }

    try {
        await act(async () => root.render(createElement(Harness)));
        await waitFor(() => container.querySelector<HTMLInputElement>('input[type="range"]')?.max === "30");

        const input = required(container.querySelector<HTMLInputElement>('input[type="range"]'));
        assert.equal(input.min, "4");
        assert.equal(input.max, "30");
        assert.equal(input.step, "1");
        await act(async () => setInputValue(input, "24"));
        assert.equal(latestSeconds, "24");
        assert.equal(input.value, "24");
        await act(async () => setInputValue(input, "30"));
        assert.equal(latestSeconds, "30");
        assert.equal(input.value, "30");
    } finally {
        await act(async () => root.unmount());
        container.remove();
        axios.request = previousRequest;
        useUserStore.setState(previousUserState);
    }
});

test("video settings offers a custom resolution from the published Profile", async () => {
    const previousRequest = axios.request;
    const previousUserState = useUserStore.getState();
    axios.request = (async () => ({
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
        data: { code: 0, msg: "", data: [{
            id: "custom-video",
            intents: ["video.generate"],
            capabilities: { settings: {
                aspectRatio: { type: "enum", values: ["16:9"], default: "16:9" },
                resolution: { type: "enum", values: ["720p", "540p"], default: "720p" },
                durationSeconds: { type: "duration", min: 4, max: 15, default: 5 },
            } },
        }] },
    })) as typeof axios.request;
    useUserStore.setState({ ...previousUserState, token: "resolution-input-token", isReady: true, isLoading: false });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let selectedResolution = "720p";

    function Harness() {
        const [config, setConfig] = useState({ ...defaultConfig, channelMode: "remote" as const, model: "custom-video", videoModel: "custom-video", vquality: "720p" });
        selectedResolution = config.vquality;
        return createElement(ConfigProvider, null, createElement(VideoSettingsPanel, {
            config,
            theme: canvasThemes.light,
            onConfigChange: (key, value) => setConfig((current) => ({ ...current, [key]: value })),
        }));
    }

    try {
        await act(async () => root.render(createElement(Harness)));
        await waitFor(() => [...container.querySelectorAll("button")].some((button) => button.textContent === "540p"));
        const option = required([...container.querySelectorAll("button")].find((button) => button.textContent === "540p"));
        await act(async () => option.click());
        assert.equal(selectedResolution, "540p");
        assert.equal(option.getAttribute("aria-pressed"), "true");
    } finally {
        await act(async () => root.unmount());
        container.remove();
        axios.request = previousRequest;
        useUserStore.setState(previousUserState);
    }
});

function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() >= deadline) throw new Error("condition was not met");
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
}

function required<T>(value: T | null | undefined): T {
    assert.ok(value);
    return value;
}
