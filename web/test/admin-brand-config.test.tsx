import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "bun:test";

let act: typeof import("react").act;

test("分镜创作室关闭时子项归零、禁用并在父项内弱化展示", async () => {
    const registeredHere = typeof document === "undefined";
    if (registeredHere) GlobalRegistrator.register({ url: "http://localhost" });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const react = await import("react");
    act = react.act;
    const { createRoot } = await import("react-dom/client");
    const { App, ConfigProvider } = await import("antd");
    const axios = (await import("axios")).default;
    const { default: i18n } = await import("@/i18n");
    const { useUserStore } = await import("@/stores/use-user-store");
    const { default: AdminBrandConfigPage } = await import("../src/pages/admin/brand-config/index.tsx");
    await i18n.changeLanguage("zh-CN");

    const previousRequest = axios.request;
    const previousUserState = useUserStore.getState();
    const loadedSettings = {
        public: {
            modelChannel: { availableModels: ["keep-model"] },
            auth: { allowRegister: false, linuxDo: { enabled: false } },
            navigation: {
                enabled: true,
                canvas: true,
                storyboard: true,
                image: true,
                video: false,
                assets: true,
                volcengineAssets: true,
                prompts: true,
                storyboardItems: { brainstormAgent: true, storyboard: false, scriptAgent: true },
            },
        },
        private: { channels: [{ name: "keep-channel" }] },
    };
    let settingsLoaded = false;
    let postedSettings: typeof loadedSettings | undefined;

    axios.request = (async (config: { url?: string; method?: string; data?: typeof loadedSettings }) => {
        if (config.url !== "/api/admin/settings") throw new Error(`unexpected admin request: ${config.url}`);
        if (config.method === "POST") {
            postedSettings = config.data;
            return { status: 200, statusText: "OK", headers: {}, config: {}, data: { code: 0, msg: "", data: config.data } };
        }
        settingsLoaded = true;
        return { status: 200, statusText: "OK", headers: {}, config: {}, data: { code: 0, msg: "", data: loadedSettings } };
    }) as typeof axios.request;
    useUserStore.setState({ ...previousUserState, token: "admin-brand-config-token", isReady: true, isLoading: false });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
        await act(async () => {
            root.render(react.createElement(ConfigProvider, null, react.createElement(App, null, react.createElement(AdminBrandConfigPage))));
        });
        await waitFor(() => settingsLoaded && container.querySelectorAll('[role="switch"]').length === 11);

        const enabled = getSwitch(container, i18n.t("admin.brandConfig.fields.enabled"));
        const canvas = getSwitch(container, i18n.t("admin.brandConfig.fields.canvas"));
        const storyboard = getSwitch(container, i18n.t("admin.brandConfig.fields.storyboard"));
        const video = getSwitch(container, i18n.t("admin.brandConfig.fields.video"));
        const storyboardItem = required(container.querySelector<HTMLElement>('[data-navigation-item="storyboard"]'));
        const storyboardItemsGroup = required(container.querySelector<HTMLElement>(`[role="group"][aria-label="${i18n.t("admin.brandConfig.sections.storyboardItems")}"]`));
        const brainstormAgent = getSwitch(storyboardItemsGroup, i18n.t("admin.brandConfig.storyboardItems.brainstormAgent"));
        const storyboardStudio = getSwitch(storyboardItemsGroup, i18n.t("admin.brandConfig.storyboardItems.storyboard"));
        const scriptAgent = getSwitch(storyboardItemsGroup, i18n.t("admin.brandConfig.storyboardItems.scriptAgent"));
        assert.ok(storyboardItem.contains(storyboardItemsGroup));

        await act(async () => click(enabled));
        await waitFor(() => enabled.getAttribute("aria-checked") === "false" && canvas.hasAttribute("disabled"));
        assert.equal(canvas.getAttribute("aria-checked"), "true");
        assert.equal(brainstormAgent.getAttribute("aria-checked"), "true");
        assert.ok(brainstormAgent.hasAttribute("disabled"));

        await act(async () => click(enabled));
        await waitFor(() => !storyboard.hasAttribute("disabled"));
        await act(async () => click(storyboard));
        await waitFor(
            () =>
                storyboard.getAttribute("aria-checked") === "false" &&
                [brainstormAgent, storyboardStudio, scriptAgent].every((item) => item.getAttribute("aria-checked") === "false" && item.hasAttribute("disabled")) &&
                storyboardItemsGroup.style.opacity === "0.45",
        );

        await act(async () => click(video));
        const saveButton = required(Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(i18n.t("admin.brandConfig.actions.save"))) || null);
        await act(async () => click(saveButton));
        await waitFor(() => Boolean(postedSettings));

        assert.deepEqual(postedSettings, {
            ...loadedSettings,
            public: {
                ...loadedSettings.public,
                navigation: {
                    ...loadedSettings.public.navigation,
                    storyboard: false,
                    video: true,
                    storyboardItems: { brainstormAgent: false, storyboard: false, scriptAgent: false },
                },
            },
        });
    } finally {
        await act(async () => root.unmount());
        container.remove();
        axios.request = previousRequest;
        useUserStore.setState(previousUserState);
        if (registeredHere) await GlobalRegistrator.unregister();
    }
});

async function waitFor(check: () => boolean, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() >= deadline) throw new Error("condition was not met");
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    }
}

function getSwitch(container: HTMLElement, label: string) {
    return required(container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`));
}

function click(element: Element) {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function required<T>(value: T | null): T {
    assert.ok(value);
    return value;
}
