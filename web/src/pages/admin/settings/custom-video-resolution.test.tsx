import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "node:test";

if (typeof window === "undefined") GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const axios = (await import("axios")).default;
const { App, ConfigProvider } = await import("antd");
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: i18n } = await import("@/i18n");
const { useUserStore } = await import("@/stores/use-user-store");
const { default: AdminSettingsPage } = await import("./index");

test("administrator can save 540p as a selectable video binding resolution", async () => {
    await i18n.changeLanguage("zh-CN");
    const previousRequest = axios.request;
    const previousUserState = useUserStore.getState();
    const settings = {
        public: {},
        private: {
            channels: [{ name: "video", baseUrl: "https://example.com", apiKey: "secret", models: ["video-model"], enabled: true }],
            generationProfiles: [{ id: "video-model", profileId: "seedance-1-5-pro", channelName: "video", upstreamModel: "video-model", enabled: true, limitOverrides: {} }],
        },
    };
    let saved: any;
    axios.request = (async (config: { method?: string; url?: string; data?: unknown }) => {
        assert.equal(config.url, "/api/admin/settings");
        if (config.method === "POST") saved = config.data;
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, msg: "", data: saved || settings } };
    }) as typeof axios.request;
    useUserStore.setState({ ...previousUserState, token: "admin-resolution-token", isReady: true, isLoading: false });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(createElement(ConfigProvider, null, createElement(App, null, createElement(AdminSettingsPage)))));
        await waitFor(() => [...container.querySelectorAll("[role=tab]")].some((tab) => tab.textContent?.includes("私有配置")));
        const privateTab = required([...container.querySelectorAll<HTMLElement>("[role=tab]")].find((tab) => tab.textContent?.includes("私有配置")));
        await act(async () => privateTab.click());
        await waitFor(() => !![...container.querySelectorAll(".ant-form-item")].find((item) => item.textContent?.includes("支持分辨率")));
        const resolutionField = required([...container.querySelectorAll<HTMLElement>(".ant-form-item")].find((item) => item.querySelector(".ant-select") && item.textContent?.includes("支持分辨率")));
        const input = required(resolutionField.querySelector<HTMLInputElement>("input"));
        await act(async () => {
            input.focus();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "540p");
            input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "540p", inputType: "insertText" }));
        });
        const customOption = required([...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((item) => item.textContent === "540p"));
        await act(async () => customOption.click());
        const saveButton = required([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("保存设置")));
        await act(async () => saveButton.click());
        await waitFor(() => !!saved);
        assert.deepEqual(saved.private.generationProfiles[0].limitOverrides.resolutionValues, ["480p", "720p", "1080p", "540p"]);
        assert.match(resolutionField.textContent || "", /540p/);
    } finally {
        await act(async () => root.unmount());
        container.remove();
        axios.request = previousRequest;
        useUserStore.setState(previousUserState);
    }
});

function required<T>(value: T | null | undefined): T {
    if (value == null) throw new Error("required element missing");
    return value;
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() >= deadline) throw new Error("condition was not met");
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
}
