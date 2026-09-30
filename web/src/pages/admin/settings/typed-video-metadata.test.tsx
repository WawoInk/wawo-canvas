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

test("administrator can save and reload typed video binding metadata", async () => {
    await i18n.changeLanguage("zh-CN");
    const previousRequest = axios.request;
    const previousUserState = useUserStore.getState();
    const settings = {
        public: {},
        private: {
            channels: [{ name: "video", baseUrl: "https://example.com", apiKey: "secret", models: ["video-model"], enabled: true }],
            generationProfiles: [{ id: "video-model", profileId: "seedance-1-5-pro", channelName: "video", upstreamModel: "video-model", enabled: true, limitOverrides: {}, metadata: { count: 7, enabled: true, mode: "fast", legacy: "9" } }],
        },
    };
    let saved: any;
    axios.request = (async (config: { method?: string; url?: string; data?: unknown }) => {
        assert.equal(config.url, "/api/admin/settings");
        if (config.method === "POST") saved = config.data;
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, msg: "", data: saved || settings } };
    }) as typeof axios.request;
    useUserStore.setState({ ...previousUserState, token: "admin-metadata-token", isReady: true, isLoading: false });

    const container = document.createElement("div");
    document.body.append(container);
    let root = createRoot(container);
    try {
        const render = async () => {
            await act(async () => root.render(createElement(ConfigProvider, null, createElement(App, null, createElement(AdminSettingsPage)))));
            await waitFor(() => [...container.querySelectorAll("[role=tab]")].some((tab) => tab.textContent?.includes("私有配置")));
            const privateTab = required([...container.querySelectorAll<HTMLElement>("[role=tab]")].find((tab) => tab.textContent?.includes("私有配置")));
            await act(async () => privateTab.click());
            await waitFor(() => !!container.querySelector('input[value="legacy"]'));
        };
        await render();
        const typeSelects = [...container.querySelectorAll<HTMLElement>('[aria-label="Value 类型"]')];
        assert.equal(typeSelects.length, 4);
        await act(async () => {
            typeSelects[3].focus();
            required(typeSelects[3].parentElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        });
        assert.equal(typeSelects[3].getAttribute("aria-expanded"), "true");
        const intOption = required([...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((option) => option.textContent === "int"));
        await act(async () => intOption.click());
        const saveButton = required([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("保存设置")));
        await act(async () => saveButton.click());
        await waitFor(() => !!saved);
        assert.deepEqual(saved.private.generationProfiles[0].metadata, { count: 7, enabled: true, mode: "fast", legacy: 9 });

        await act(async () => root.unmount());
        root = createRoot(container);
        await render();
        assert.deepEqual(
            [...container.querySelectorAll<HTMLElement>('[aria-label="Value 类型"]')].map((input) => input.parentElement?.textContent),
            ["int", "boolean", "string", "int"],
        );
        assert.equal(required(container.querySelector<HTMLInputElement>('input[value="legacy"]')).value, "legacy");
        const addButton = required([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "新增 Metadata"));
        await act(async () => addButton.click());
        assert.equal([...container.querySelectorAll<HTMLElement>('[aria-label="Value 类型"]')].at(-1)?.parentElement?.textContent, "string");
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
