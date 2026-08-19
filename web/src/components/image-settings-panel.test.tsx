import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import test from "node:test";
import { act, createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig } from "@/stores/use-config-store";
import { ImageSettingsPanel, normalizeImageSizeForResolution, visibleImageAspectOptions } from "./image-settings-panel";

GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");

test("default image resolution keeps every existing size option", () => {
    assert.deepEqual(
        visibleImageAspectOptions("default").map((option) => option.size || option.value),
        ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "2048x2048", "2048x1152", "1152x2048", "3840x2160", "2160x3840", "auto"],
    );
});

test("1k image resolution keeps the seven base aspect ratios", () => {
    assert.deepEqual(
        visibleImageAspectOptions("1k").map((option) => option.size || option.value),
        ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
    );
});

test("2k image resolution keeps the existing 2k sizes", () => {
    assert.deepEqual(
        visibleImageAspectOptions("2k").map((option) => option.size || option.value),
        ["2048x2048", "2048x1152", "1152x2048"],
    );
});

test("4k image resolution keeps the existing 4k sizes", () => {
    assert.deepEqual(
        visibleImageAspectOptions("4k").map((option) => option.size || option.value),
        ["3840x2160", "2160x3840"],
    );
});

test("missing or invalid image resolution falls back to default options", () => {
    const allSizes = visibleImageAspectOptions("default").map((option) => option.size || option.value);
    assert.deepEqual(visibleImageAspectOptions().map((option) => option.size || option.value), allSizes);
    assert.deepEqual(visibleImageAspectOptions("8k").map((option) => option.size || option.value), allSizes);
});

test("image size normalization keeps an allowed selection", () => {
    assert.equal(normalizeImageSizeForResolution("2k", "2048x1152"), "2048x1152");
});

test("image size normalization replaces a hidden size with the same orientation", () => {
    assert.equal(normalizeImageSizeForResolution("2k", "3840x2160"), "2048x1152");
});

test("image size normalization preserves custom dimensions", () => {
    assert.equal(normalizeImageSizeForResolution("2k", "1504x1504"), "1504x1504");
    assert.equal(normalizeImageSizeForResolution("1k", "1200x800"), "1200x800");
});

test("image settings panel only renders the current remote model resolution options", () => {
    const imageRequestFormat = {
        model: "image-model",
        format: "default" as const,
        canvasRequestMode: "generations" as const,
        resolution: "4k" as const,
    };
    const html = renderToStaticMarkup(
        createElement(ImageSettingsPanel, {
            config: {
                ...defaultConfig,
                channelMode: "remote",
                model: "image-model",
                imageRequestFormats: [imageRequestFormat as (typeof defaultConfig.imageRequestFormats)[number]],
            },
            onConfigChange: () => {},
            theme: canvasThemes.light,
        }),
    );

    assert.match(html, /16:9\(4k\)/);
    assert.match(html, /9:16\(4k\)/);
    assert.doesNotMatch(html, /1:1\(2k\)/);
    assert.doesNotMatch(html, /1:1<\/span>/);
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
                        resolution: "4k",
                    } as (typeof defaultConfig.imageRequestFormats)[number],
                    {
                        model: "image-2k",
                        format: "default",
                        canvasRequestMode: "generations",
                        resolution: "2k",
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
        assert.deepEqual(changes, [["size", "2048x1152"]]);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
