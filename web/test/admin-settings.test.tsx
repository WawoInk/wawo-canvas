import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { test } from "bun:test";

GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const axios = (await import("axios")).default;
const { default: i18n } = await import("@/i18n");
const { useUserStore } = await import("@/stores/use-user-store");
const { default: AdminSettingsPage } = await import("../src/pages/admin/settings/index.tsx");

await i18n.changeLanguage("zh-CN");

test("普通视频（Sora）支持选择 480p、720p 和 1080p", async () => {
    const previousRequest = axios.request;
    const previousUserState = useUserStore.getState();
    let settingsLoaded = false;
    axios.request = (async (config: { url?: string }) => {
        if (config.url !== "/api/admin/settings") throw new Error(`unexpected admin request: ${config.url}`);
        settingsLoaded = true;
        return {
            status: 200,
            statusText: "OK",
            headers: {},
            config: {},
            data: {
                code: 0,
                msg: "",
                data: {
                    public: {
                        modelChannel: {
                            availableModels: ["sora-pro"],
                            modelCosts: [],
                            imageRequestFormats: [],
                            defaultModel: "",
                            defaultImageModel: "",
                            defaultVideoModel: "sora-pro",
                            defaultTextModel: "",
                            defaultAudioModel: "",
                            imageModels: [],
                            videoModels: ["sora-pro"],
                            textModels: [],
                            audioModels: [],
                            systemPrompt: "",
                            allowCustomChannel: false,
                        },
                        auth: { allowRegister: true, linuxDo: { enabled: false } },
                    },
                    private: {
                        channels: [{ protocol: "openai", name: "openai", baseUrl: "https://api.openai.com", apiKey: "", models: ["sora-2-pro"], weight: 1, enabled: true, remark: "" }],
                        generationProfiles: [
                            {
                                id: "sora-pro",
                                profileId: "sora-2",
                                upstreamModel: "sora-2-pro",
                                channelName: "openai",
                                billingMode: "per_call",
                                enabled: true,
                                limitOverrides: {},
                                metadata: {},
                            },
                        ],
                        promptSync: { enabled: true, cron: "*/5 * * * *" },
                        auth: { linuxDo: { clientId: "", clientSecret: "" } },
                        fileSizeLimits: { image: 1, video: 1, audio: 1, prompt: 1 },
                    },
                },
            },
        };
    }) as typeof axios.request;
    useUserStore.setState({
        token: "admin-settings-token",
        user: {
            id: "admin-settings-user",
            username: "admin-settings",
            email: "",
            displayName: "",
            avatarUrl: "",
            role: "admin",
            credits: "0",
            createdAt: "",
            updatedAt: "",
        },
        isReady: true,
        isLoading: false,
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
        await act(async () => {
            root.render(createElement(ConfigProvider, null, createElement(App, null, createElement(AdminSettingsPage))));
        });
        await waitFor(() => settingsLoaded);

        const privateTab = required(Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find((item) => item.textContent?.includes(i18n.t("admin.settings.tabs.private"))) || null);
        await act(async () => click(privateTab));
        await waitFor(() => container.textContent?.includes("sora-pro") === true);

        const binding = required(Array.from(container.querySelectorAll<HTMLElement>("section")).find((item) => item.textContent?.includes("sora-pro")) || null);
        const resolutionField = required(Array.from(binding.querySelectorAll<HTMLElement>(".ant-form-item")).find((item) => item.textContent?.includes(i18n.t("admin.settings.generationProfiles.form.resolutions"))) || null);
        assert.deepEqual(
            ["480p", "720p", "1080p"].filter((value) => resolutionField.textContent?.includes(value)),
            ["480p", "720p", "1080p"],
        );
    } finally {
        await act(async () => root.unmount());
        container.remove();
        axios.request = previousRequest;
        useUserStore.setState(previousUserState);
    }
});

test("保存图片请求格式时过滤非法分辨率并去重", async () => {
    const previousRequest = axios.request;
    const previousUserState = useUserStore.getState();
    let settingsLoaded = false;
    let postedSettings: any;
    axios.request = (async (config: { url?: string; method?: string; data?: any }) => {
        if (config.url !== "/api/admin/settings") throw new Error(`unexpected admin request: ${config.url}`);
        if (config.method === "POST") {
            postedSettings = config.data;
            return {
                status: 200,
                statusText: "OK",
                headers: {},
                config: {},
                data: { code: 0, msg: "", data: config.data },
            };
        }
        settingsLoaded = true;
        return {
            status: 200,
            statusText: "OK",
            headers: {},
            config: {},
            data: {
                code: 0,
                msg: "",
                data: {
                    public: {
                        modelChannel: {
                            availableModels: ["image-model"],
                            imageModels: ["image-model"],
                            imageRequestFormats: [{ model: "image-model", format: "default", canvasRequestMode: "split", resolutions: ["2k", "8k", "1k", "2k"] }],
                        },
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
                    private: { channels: [] },
                },
            },
        };
    }) as typeof axios.request;
    useUserStore.setState({ ...previousUserState, token: "admin-settings-token", isReady: true, isLoading: false });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
        await act(async () => {
            root.render(createElement(ConfigProvider, null, createElement(App, null, createElement(AdminSettingsPage))));
        });
        await waitFor(() => settingsLoaded);

        const saveButton = required(Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes(i18n.t("admin.settings.actions.saveSettings"))) || null);
        await act(async () => click(saveButton));
        await waitFor(() => Boolean(postedSettings));

        assert.deepEqual(postedSettings.public.modelChannel.imageRequestFormats[0].resolutions, ["1k", "2k"]);
        assert.deepEqual(postedSettings.public.navigation, {
            enabled: true,
            canvas: true,
            storyboard: true,
            image: true,
            video: false,
            assets: true,
            volcengineAssets: true,
            prompts: true,
            storyboardItems: { brainstormAgent: true, storyboard: false, scriptAgent: true },
        });
    } finally {
        await act(async () => root.unmount());
        container.remove();
        axios.request = previousRequest;
        useUserStore.setState(previousUserState);
    }
});

test("图片请求格式显示对齐的列标题并保留分辨率值", async () => {
    const previousRequest = axios.request;
    const previousUserState = useUserStore.getState();
    let settingsLoaded = false;
    axios.request = (async (config: { url?: string }) => {
        if (config.url !== "/api/admin/settings") throw new Error(`unexpected admin request: ${config.url}`);
        settingsLoaded = true;
        return {
            status: 200,
            statusText: "OK",
            headers: {},
            config: {},
            data: {
                code: 0,
                msg: "",
                data: {
                    public: {
                        modelChannel: {
                            availableModels: ["image-model"],
                            imageModels: ["image-model"],
                            imageRequestFormats: [{ model: "image-model", format: "default", canvasRequestMode: "split", resolutions: ["1k", "2k"] }],
                        },
                    },
                    private: { channels: [] },
                },
            },
        };
    }) as typeof axios.request;
    useUserStore.setState({ ...previousUserState, token: "admin-settings-token", isReady: true, isLoading: false });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
        await act(async () => {
            root.render(createElement(ConfigProvider, null, createElement(App, null, createElement(AdminSettingsPage))));
        });
        await waitFor(() => settingsLoaded);

        const resolutionLabel = i18n.t("admin.settings.public.imageRequestFormats.resolutionLabel");
        const resolutionField = required(Array.from(container.querySelectorAll<HTMLElement>(".ant-form-item")).find((item) => item.textContent?.includes(resolutionLabel)) || null);
        const formatRow = required(resolutionField.closest<HTMLElement>(".ant-row"));
        assert.deepEqual(
            Array.from(formatRow.querySelectorAll<HTMLElement>(".ant-form-item-label")).map((item) => item.textContent?.trim()),
            [i18n.t("admin.settings.public.imageRequestFormats.modelLabel"), i18n.t("admin.settings.public.imageRequestFormats.formatLabel"), i18n.t("admin.settings.public.imageRequestFormats.canvasModeLabel"), resolutionLabel],
        );
        assert.ok(resolutionField.querySelector(".ant-select-multiple"));
    } finally {
        await act(async () => root.unmount());
        container.remove();
        axios.request = previousRequest;
        useUserStore.setState(previousUserState);
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
