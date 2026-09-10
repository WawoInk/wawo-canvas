import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import test from "node:test";
import { act, createElement, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig } from "@/stores/use-config-store";
import { ImageSettingsPanel } from "./image-settings-panel";

GlobalRegistrator.register({ url: "http://localhost" });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");

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

    assert.match(html, />2K<\/button>/);
    assert.match(html, />4K<\/button>/);
    assert.doesNotMatch(html, />1K<\/button>/);
    assert.match(html, />21:9<\/span>/);
    assert.match(html, />1:1<\/span>/);
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
        const option = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "16:9");
        assert.ok(option);
        await act(async () => option.dispatchEvent(new MouseEvent("click", { bubbles: true })));
        assert.deepEqual(changes, [["size", "2048x1152"]]);
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
        assert.deepEqual(changes, [["size", "1536x864"]]);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

test("resolution and ratio controls write every upstream preset using only config.size", async () => {
    const changes: Array<[string, string]> = [];
    const container = document.createElement("div");
    const root = createRoot(container);
    function Harness() {
        const [size, setSize] = useState("auto");
        return createElement(ImageSettingsPanel, {
            config: { ...defaultConfig, channelMode: "local", size },
            onConfigChange: (key, value) => {
                changes.push([key, value]);
                if (key === "size") setSize(value);
            },
            theme: canvasThemes.light,
        });
    }
    const expected: Record<string, string[]> = {
        "1K": ["1024x1024", "1024x1536", "1536x1024", "1024x768", "768x1024", "1536x864", "864x1536", "2016x864", "864x2016"],
        "2K": ["2048x2048", "1360x2048", "2048x1360", "2048x1536", "1536x2048", "2048x1152", "1152x2048", "2688x1152", "1152x2688"],
        "4K": ["2880x2880", "2336x3520", "3520x2336", "3312x2480", "2480x3312", "3840x2160", "2160x3840", "3840x1648", "1648x3840"],
    };
    async function click(label: string) {
        const button = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label);
        assert.ok(button, label);
        await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    }
    try {
        await act(async () => root.render(createElement(Harness)));
        for (const resolution of ["1K", "2K", "4K"]) {
            await click(resolution);
            for (const [index, ratio] of ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21"].entries()) {
                await click(ratio);
                assert.deepEqual(changes.at(-1), ["size", expected[resolution][index]]);
            }
        }
    } finally {
        await act(async () => root.unmount());
    }
});

test("restricted models repair auto and disallowed custom dimensions, while default and local settings stay unrestricted", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
        for (const [channelMode, resolutions, size, expected] of [
            ["remote", ["2k"], "auto", "2048x2048"],
            ["remote", ["2k"], "1200x800", "2048x1360"],
            ["remote", ["2k"], "2560x1440", undefined],
            ["remote", ["default"], "1200x800", undefined],
            ["local", ["2k"], "1200x800", undefined],
        ] as const) {
            const changes: Array<[string, string]> = [];
            await act(async () =>
                root.render(
                    createElement(ImageSettingsPanel, {
                        config: { ...defaultConfig, channelMode, model: "image", imageModel: "image", size, imageRequestFormats: [{ model: "image", format: "default", canvasRequestMode: "split", resolutions: [...resolutions] }] },
                        onConfigChange: (key, value) => changes.push([key, value]),
                        theme: canvasThemes.light,
                    }),
                ),
            );
            assert.deepEqual(changes, expected ? [["size", expected]] : []);
            const labels = Array.from(container.querySelectorAll("button")).map((button) => button.textContent);
            assert.equal(labels.includes("1K"), channelMode === "local" || resolutions[0] === "default");
        }
    } finally {
        await act(async () => root.unmount());
    }
});
