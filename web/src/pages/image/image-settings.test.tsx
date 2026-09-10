import assert from "node:assert/strict";
import test from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";

if (typeof window === "undefined") GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router-dom");
const { default: ImagePage } = await import("./index");
const { defaultConfig, useConfigStore } = await import("@/stores/use-config-store");

test("image workbench settings follow selected imageModel instead of the unrelated default model", async () => {
    const previous = useConfigStore.getState();
    const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
    const container = document.createElement("div");
    const root = createRoot(container);
    useConfigStore.setState({
        configHydrated: false,
        config: {
            ...defaultConfig,
            channelMode: "remote",
            model: "image-A",
            imageModel: "image-B",
            size: "1024x1024",
            imageModels: ["image-A", "image-B"],
            imageRequestFormats: [
                { model: "image-A", format: "default", canvasRequestMode: "split", resolutions: ["4k"] },
                { model: "image-B", format: "default", canvasRequestMode: "split", resolutions: ["1k"] },
            ],
        },
    });
    try {
        await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(MemoryRouter, null, createElement(App, null, createElement(ImagePage))))));
        const labels = Array.from(container.querySelectorAll("button")).map((button) => button.textContent);
        assert.ok(labels.includes("1K"));
        assert.ok(!labels.includes("4K"));
        assert.equal(useConfigStore.getState().config.size, "1024x1024");
    } finally {
        await act(async () => root.unmount());
        useConfigStore.setState(previous);
        queryClient.clear();
    }
});
