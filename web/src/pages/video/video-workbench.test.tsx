import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof document === "undefined") GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const localforage = (await import("localforage")).default;
// Exercise real localforage persistence using HappyDOM's available storage driver.
await localforage.setDriver(localforage.LOCALSTORAGE);
const storage = window.localStorage;
const axios = (await import("axios")).default;
const { defaultConfig, useConfigStore } = await import("@/stores/use-config-store");
const { useUserStore } = await import("@/stores/use-user-store");
const { default: i18n } = await import("@/i18n");
const { default: VideoPage } = await import("./index");
import type { GenerationCommand, GenerationProfile } from "@/services/api/generations";

const profile: GenerationProfile = {
    id: "workbench-video",
    version: 1,
    displayName: "视频",
    credits: "1",
    adapterKey: "seedance",
    intents: ["video.generate"],
    capabilities: {
        settings: {
            aspectRatio: { type: "enum", values: ["16:9"], default: "16:9" },
            resolution: { type: "enum", values: ["720p"], default: "720p" },
            durationSeconds: { type: "duration", min: 2, max: 60, allowAuto: true, default: 8 },
            videoMode: { type: "enum", values: ["reference", "frames"], default: "reference" },
        },
        cancellation: false,
        completion: ["poll"],
    },
};

async function withWorkbench(run: (container: HTMLDivElement, commands: GenerationCommand[], remount: () => Promise<void>) => Promise<void>) {
    const previousAdapter = axios.defaults.adapter;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
        assert.match(String(input), /^\/api\/v1\/sync\?/);
        return new Response(JSON.stringify({ code: 0, data: {} }));
    }) as typeof fetch;
    const previousConfig = useConfigStore.getState();
    const previousUser = useUserStore.getState();
    storage.clear();
    await i18n.changeLanguage("en-US");
    useConfigStore.setState({ configHydrated: true, config: { ...defaultConfig, channelMode: "remote", model: profile.id, videoModel: profile.id, videoModels: [profile.id], videoSeconds: "55", videoMode: "frames" } });
    useUserStore.setState({ isReady: true, token: crypto.randomUUID(), user: { id: "video-owner", username: "video-owner", displayName: "Owner", role: "user", credits: "100", email: "", avatarUrl: "", createdAt: "", updatedAt: "" } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const commands: GenerationCommand[] = [];
    axios.defaults.adapter = async (config) => {
        let data: unknown;
        if (config.url === "/api/v1/model-profiles") data = [profile];
        else if (config.url?.startsWith("/api/v1/generation-tasks?"))
            data = {
                items: commands.map((command, index) => ({
                    id: `run-${index + 1}`,
                    title: command.intent.kind === "video.generate" ? command.intent.prompt : "",
                    prompt: command.intent.kind === "video.generate" ? command.intent.prompt : "",
                    model: profile.id,
                    modelProfileId: profile.id,
                    intentKind: "video.generate",
                    status: "failed",
                    credits: "0",
                    upstreamCredits: "0",
                    durationMs: 0,
                    createdAt: "2026-09-10T00:00:00Z",
                    error: "test failure",
                    videoSeconds: String(command.intent.settings?.durationSeconds),
                    size: "16:9",
                    vquality: "720p",
                })),
                total: commands.length,
            };
        else if (config.url === "/api/v1/generations" && config.method === "post") {
            commands.push(JSON.parse(config.data));
            data = { id: `run-${commands.length}`, status: "queued", modelProfileId: profile.id, intentKind: "video.generate" };
        } else if (config.url?.startsWith("/api/v1/generations/run-")) data = { id: config.url.split("/").at(-1), status: "failed", error: { code: "TEST_FAILURE", message: "test failure", retryable: false } };
        else throw new Error(`Unexpected request: ${config.method} ${config.url}`);
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, data } };
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const page = createElement(ConfigProvider, { theme: { token: { motion: false } } }, createElement(QueryClientProvider, { client: queryClient }, createElement(App, null, createElement(VideoPage))));
    const remount = async () => {
        await act(async () => root.render(null));
        await act(async () => root.render(page));
    };
    try {
        await act(async () => root.render(page));
        await run(container, commands, remount);
    } finally {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
        axios.defaults.adapter = previousAdapter;
        globalThis.fetch = previousFetch;
        useConfigStore.setState(previousConfig);
        useUserStore.setState(previousUser);
    }
}

async function clickButton(container: HTMLElement, key: string) {
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === i18n.t(key));
    assert.ok(button, `button ${key}`);
    await act(async () => button.click());
}

async function generate(container: HTMLElement) {
    const prompt = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(prompt);
    await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(prompt, "A 55-second video");
        prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickButton(container, "videoWorkbench.actions.generate");
}

test("workbench submits 55 seconds to a remote 60-second profile without the old 20-second cap", async () => {
    await withWorkbench(async (container, commands) => {
        await generate(container);
        assert.equal(commands.length, 1);
        assert.equal(commands[0].intent.settings?.durationSeconds, 55);
    });
});

test("history restores the original video mode after reopening the page before retrying a failed Generation Run", async () => {
    await withWorkbench(async (container, commands, remount) => {
        await generate(container);
        assert.equal(commands[0].intent.kind, "video.generate");
        if (commands[0].intent.kind === "video.generate") assert.equal(commands[0].intent.settings?.videoMode, "frames");
        await act(async () => useConfigStore.getState().updateConfig("videoMode", "reference"));
        await remount();
        const history = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find((item) => item.textContent?.includes("A 55-second"));
        assert.ok(history, "failed run is restored through the history card");
        await act(async () => history.click());
        await clickButton(container, "videoWorkbench.actions.retry");
        assert.equal(commands.length, 2);
        assert.equal(commands[1].intent.kind, "video.generate");
        if (commands[1].intent.kind === "video.generate") assert.equal(commands[1].intent.settings?.videoMode, "frames");
        assert.equal(commands[1].intent.settings?.durationSeconds, 55);
        assert.notEqual(commands[0].clientRequestId, commands[1].clientRequestId);
    });
});

test("server-only usage history without a mode restores reference instead of the current frames setting", async () => {
    await withWorkbench(async (container, commands, remount) => {
        await generate(container);
        storage.clear();
        await remount();
        const history = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find((item) => item.textContent?.includes("A 55-second"));
        assert.ok(history);
        await act(async () => history.click());
        await clickButton(container, "videoWorkbench.actions.retry");
        assert.equal(commands.length, 2);
        assert.equal(commands[1].intent.kind, "video.generate");
        if (commands[1].intent.kind === "video.generate") assert.equal(commands[1].intent.settings?.videoMode, "reference");
    });
});

test("remote workbench leaves auto and administrator duration bounds to the selected profile", async () => {
    await withWorkbench(async (container, commands) => {
        for (const [selected, expected] of [
            ["-1", -1],
            ["75", 60],
            ["1", 2],
        ] as const) {
            await act(async () => useConfigStore.getState().updateConfig("videoSeconds", selected));
            await generate(container);
            assert.equal(commands.at(-1)?.intent.settings?.durationSeconds, expected);
        }
        assert.equal(commands.length, 3);
    });
});

test("local workbench keeps the existing Seedance compatibility route and duration normalization", async () => {
    await withWorkbench(async (container, commands) => {
        const previousAdapter = axios.defaults.adapter;
        assert.equal(typeof previousAdapter, "function");
        const payloads: { duration: number }[] = [];
        axios.defaults.adapter = async (config) => {
            let data: unknown;
            if (config.url?.startsWith("https://video.example/v1/contents/generations/tasks")) {
                if (config.method === "post") payloads.push(JSON.parse(config.data));
                data = { id: "local-task", status: "failed", error: { code: "TEST_FAILURE", message: "test failure" } };
            } else if (config.url === "/api/v1/generation-tasks" && config.method === "post") data = { id: "local-log" };
            else {
                assert.ok(typeof previousAdapter === "function");
                return previousAdapter(config);
            }
            return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, data } };
        };
        await act(async () =>
            useConfigStore.setState({
                config: {
                    ...useConfigStore.getState().config,
                    channelMode: "local",
                    videoSeconds: "55",
                    channels: [{ id: "local", name: "Local", apiFormat: "openai", baseUrl: "https://video.example", apiKey: "test-only", models: [profile.id] }],
                },
            }),
        );
        await generate(container);
        assert.equal(commands.length, 0);
        assert.equal(payloads.length, 1);
        assert.equal(payloads[0].duration, 15);
    });
});
