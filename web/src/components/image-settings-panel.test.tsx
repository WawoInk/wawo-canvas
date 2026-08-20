import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import test from "node:test";
import { act, createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig } from "@/stores/use-config-store";
import { ImageSettingsPanel, normalizeImageSizeForResolutions, visibleImageAspectOptions } from "./image-settings-panel";

GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");

test("default image resolution keeps every existing size option", () => {
    assert.deepEqual(
        visibleImageAspectOptions(["default"]).map((option) => option.size || option.value),
        ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "2048x2048", "2560x1440", "1440x2560", "3840x2160", "2160x3840", "auto"],
    );
});

test("1k image resolution keeps the seven base aspect ratios", () => {
    assert.deepEqual(
        visibleImageAspectOptions(["1k"]).map((option) => option.size || option.value),
        ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
    );
});

test("2k image resolution keeps the existing 2k sizes", () => {
    assert.deepEqual(
        visibleImageAspectOptions(["2k"]).map((option) => option.size || option.value),
        ["2048x2048", "2560x1440", "1440x2560"],
    );
});

test("4k image resolution keeps the existing 4k sizes", () => {
    assert.deepEqual(
        visibleImageAspectOptions(["4k"]).map((option) => option.size || option.value),
        ["3840x2160", "2160x3840"],
    );
});

test("multiple image resolutions merge their existing size options", () => {
    assert.deepEqual(
        visibleImageAspectOptions(["1k", "4k"]).map((option) => option.size || option.value),
        ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "3840x2160", "2160x3840"],
    );
});

test("missing or invalid image resolutions fall back to default options", () => {
    const allSizes = visibleImageAspectOptions(["default"]).map((option) => option.size || option.value);
    assert.deepEqual(
        visibleImageAspectOptions().map((option) => option.size || option.value),
        allSizes,
    );
    assert.deepEqual(
        visibleImageAspectOptions(["8k"]).map((option) => option.size || option.value),
        allSizes,
    );
});

test("image size normalization keeps an allowed selection", () => {
    assert.equal(normalizeImageSizeForResolutions(["1k", "2k"], "2560x1440"), "2560x1440");
});

test("image size normalization replaces a hidden size with the same orientation", () => {
    assert.equal(normalizeImageSizeForResolutions(["1k", "2k"], "3840x2160"), "3:2");
});

test("image size normalization preserves custom dimensions", () => {
    assert.equal(normalizeImageSizeForResolutions(["2k"], "1504x1504"), "1504x1504");
    assert.equal(normalizeImageSizeForResolutions(["1k"], "1200x800"), "1200x800");
});

test("image settings panel only renders the current remote model resolution options", () => {
    const imageRequestFormat: (typeof defaultConfig.imageRequestFormats)[number] = {
        model: "image-model",
        format: "default",
        canvasRequestMode: "generations",
        resolutions: ["2k", "4k"],
    };
    const html = renderToStaticMarkup(
        createElement(ImageSettingsPanel, {
            config: {
                ...defaultConfig,
                channelMode: "remote",
                model: "image-model",
                imageRequestFormats: [imageRequestFormat],
            },
            onConfigChange: () => {},
            theme: canvasThemes.light,
        }),
    );

    assert.match(html, /16:9\(4k\)/);
    assert.match(html, /9:16\(4k\)/);
    assert.match(html, /1:1\(2k\)/);
    assert.doesNotMatch(html, /1:1<\/span>/);
});

test("selecting 16:9 2k writes the Canvas platform size", async () => {
    const changes: Array<[string, string]> = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
        await act(async () => {
            root.render(
                createElement(ImageSettingsPanel, {
                    config: {
                        ...defaultConfig,
                        channelMode: "remote",
                        model: "image-2k",
                        imageModel: "image-2k",
                        size: "2560x1440",
                        imageRequestFormats: [{ model: "image-2k", format: "default", canvasRequestMode: "split", resolutions: ["2k"] }],
                    },
                    onConfigChange: (key, value) => changes.push([key, value]),
                    theme: canvasThemes.light,
                }),
            );
        });
        const option = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("16:9(2k)"));
        assert.ok(option);
        await act(async () => option.dispatchEvent(new MouseEvent("click", { bubbles: true })));
        assert.deepEqual(changes, [["size", "2560x1440"]]);
    } finally {
        await act(async () => root.unmount());
    }
});

test("image settings panel normalizes a hidden size when the selected model changes tier", async () => {
    const changes: Array<[string, string]> = [];
    let selectModel!: (model: string) => void;

    function Harness() {
        const [model, setModel] = useState("image-4k");
        selectModel = setModel;
        return createElement(ImageSettingsPanel, {
            config: {
                ...defaultConfig,
                channelMode: "remote",
                model,
                imageModel: model,
                size: "3840x2160",
                imageRequestFormats: [
                    {
                        model: "image-4k",
                        format: "default",
                        canvasRequestMode: "generations",
                        resolutions: ["4k"],
                    } as (typeof defaultConfig.imageRequestFormats)[number],
                    {
                        model: "image-2k",
                        format: "default",
                        canvasRequestMode: "generations",
                        resolutions: ["1k", "2k"],
                    } as (typeof defaultConfig.imageRequestFormats)[number],
                ],
            },
            onConfigChange: (key, value) => changes.push([key, value]),
            theme: canvasThemes.light,
        });
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        await act(async () => root.render(createElement(Harness)));
        assert.deepEqual(changes, []);
        await act(async () => selectModel("image-2k"));
        assert.deepEqual(changes, [["size", "3:2"]]);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
