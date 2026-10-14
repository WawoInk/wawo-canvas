import "../../test/register-dom";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement } from "react";
import axios from "axios";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { type GenerationProfile } from "@/services/api/generations";
import i18n from "@/i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function profile(id: string, values?: string[], defaultResolution = "720p"): GenerationProfile {
    return {
        id,
        version: 1,
        displayName: id,
        credits: "1",
        adapterKey: "seedance",
        intents: ["video.generate"],
        capabilities: {
            settings: {
                aspectRatio: { type: "enum", values: ["16:9"], default: "16:9" },
                resolution: { type: "enum", values, default: defaultResolution },
                durationSeconds: { type: "duration", min: 2, max: 15, allowAuto: false, default: 6 },
            },
            cancellation: false,
            completion: ["polling"],
        },
    };
}

function resolutionButtons(container: HTMLDivElement) {
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((button) => /^\d+[pk]$/.test(button.textContent || ""));
}

async function withPanel(profiles: GenerationProfile[], run: (container: HTMLDivElement, render: (model: string, vquality?: string) => Promise<void>, changes: [string, string][]) => Promise<void>) {
    const { createRoot } = await import("react-dom/client");
    const { VideoSettingsPanel } = await import("./video-settings-panel");
    await i18n.changeLanguage("zh-CN");
    const previousAdapter = axios.defaults.adapter;
    const previousToken = useUserStore.getState().token;
    useUserStore.setState({ token: crypto.randomUUID() });
    axios.defaults.adapter = async (config) => {
        assert.equal(config.url, "/api/v1/model-profiles");
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, data: profiles } };
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const changes: [string, string][] = [];
    const render = async (model: string, vquality = "480p") => {
        await act(async () => {
            root.render(
                createElement(VideoSettingsPanel, {
                    config: { ...defaultConfig, model, vquality },
                    theme: canvasThemes.light,
                    allowAutoDuration: false,
                    onConfigChange: (key, value) => changes.push([key, value]),
                }),
            );
        });
    };
    try {
        await render(profiles[0]?.id || "unconfigured-model");
        await run(container, render, changes);
    } finally {
        await act(async () => root.unmount());
        container.remove();
        axios.defaults.adapter = previousAdapter;
        useUserStore.setState({ token: previousToken });
    }
}

test("canvas video resolutions contain only administrator choices in ascending numeric order", async () => {
    await withPanel([profile("custom", ["1080p", "540p", "720p"])], async (container, render, changes) => {
        const buttons = resolutionButtons(container);
        assert.deepEqual(
            buttons.map((button) => button.textContent),
            ["540p", "720p", "1080p"],
        );
        assert.ok(buttons.every((button) => !button.disabled));
        assert.equal(buttons.find((button) => button.getAttribute("aria-pressed") === "true")?.textContent, "720p");
        await act(async () => buttons[0].click());
        assert.deepEqual(changes, [["vquality", "540p"]]);
        await render("custom", "540p");
        assert.equal(resolutionButtons(container)[0].getAttribute("aria-pressed"), "true");
    });
});

test("removed standard resolutions disappear even when no custom value is added", async () => {
    await withPanel([profile("subset", ["1080p", "720p"])], async (container) => {
        assert.deepEqual(
            resolutionButtons(container).map((button) => button.textContent),
            ["720p", "1080p"],
        );
    });
});

test("mixed p and k resolutions sort numerically without mutating the profile catalog", async () => {
    const values = ["4k", "1080p", "2k", "540p"];
    await withPanel([profile("mixed", values, "1080p")], async (container) => {
        assert.deepEqual(
            resolutionButtons(container).map((button) => button.textContent),
            ["540p", "1080p", "2k", "4k"],
        );
        assert.deepEqual(values, ["4k", "1080p", "2k", "540p"]);
    });
});

test("unconfigured video resolutions retain the three existing defaults", async () => {
    for (const profiles of [[], [profile("no-values")], [profile("default-values", ["480p", "720p", "1080p"])]]) {
        await withPanel(profiles, async (container) => {
            const buttons = resolutionButtons(container);
            assert.deepEqual(
                buttons.map((button) => button.textContent),
                ["480p", "720p", "1080p"],
            );
            assert.ok(buttons.every((button) => !button.disabled));
        });
    }
});

test("short drama shows only its configured resolution and selects its valid default", async () => {
    const dramaProfile = profile("drama", ["1080p"], "1080p");
    dramaProfile.intents = ["video.short-drama"];
    dramaProfile.capabilities.settings.quality = { type: "enum", values: ["standard", "high"], default: "standard" };
    await withPanel([dramaProfile], async (container) => {
        const buttons = resolutionButtons(container);
        assert.deepEqual(
            buttons.map((button) => button.textContent),
            ["1080p"],
        );
        assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
        assert.equal(buttons[0].disabled, false);
    });
});

test("switching video models replaces choices and uses the new default for an unsupported saved value", async () => {
    await withPanel([profile("first", ["1080p", "540p", "720p"]), profile("second", ["1440p", "360p", "1080p"], "1080p")], async (container, render) => {
        await render("first", "540p");
        assert.equal(resolutionButtons(container).find((button) => button.getAttribute("aria-pressed") === "true")?.textContent, "540p");
        await render("second", "540p");
        const buttons = resolutionButtons(container);
        assert.deepEqual(
            buttons.map((button) => button.textContent),
            ["360p", "1080p", "1440p"],
        );
        assert.equal(buttons.find((button) => button.getAttribute("aria-pressed") === "true")?.textContent, "1080p");
        assert.ok(buttons.every((button) => !button.disabled));
    });
});
