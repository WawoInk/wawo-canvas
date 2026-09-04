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

test("video duration input keeps a multi-digit draft and commits within the Profile maximum", async () => {
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
        await waitFor(() => container.querySelector<HTMLInputElement>('input[type="number"]')?.max === "30");

        let input = required(container.querySelector<HTMLInputElement>('input[type="number"]'));
        await act(async () => input.focus());
        await act(async () => setInputValue(input, ""));
        await act(async () => setInputValue(input, "2"));
        input = required(container.querySelector<HTMLInputElement>('input[type="number"]'));
        await act(async () => setInputValue(input, `${input.value}4`));
        await act(async () => input.blur());
        assert.equal(latestSeconds, "24");
        assert.equal(required(container.querySelector<HTMLInputElement>('input[type="number"]')).value, "24");

        input = required(container.querySelector<HTMLInputElement>('input[type="number"]'));
        await act(async () => input.focus());
        await act(async () => setInputValue(input, "31"));
        await act(async () => input.blur());
        assert.equal(latestSeconds, "30");
        assert.equal(required(container.querySelector<HTMLInputElement>('input[type="number"]')).value, "30");
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

function required<T>(value: T | null): T {
    assert.ok(value);
    return value;
}
