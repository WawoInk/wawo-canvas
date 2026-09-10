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

const profile: GenerationProfile = {
    id: "duration-profile",
    version: 1,
    displayName: "视频",
    credits: "1",
    adapterKey: "seedance",
    intents: ["video.generate"],
    capabilities: {
        settings: {
            aspectRatio: { type: "enum", values: ["16:9"], default: "16:9" },
            resolution: { type: "enum", values: ["720p"], default: "720p" },
            durationSeconds: { type: "duration", min: 2, max: 60, allowAuto: false, default: 8 },
        },
        cancellation: false,
        completion: ["polling"],
    },
};

async function withPanel(run: (container: HTMLDivElement, changes: [string, string][]) => Promise<void>, selectedProfile: GenerationProfile | null = profile, videoSeconds = "40", allowAutoDuration = true) {
    const { createRoot } = await import("react-dom/client");
    const { VideoSettingsPanel } = await import("./video-settings-panel");
    await i18n.changeLanguage("en-US");
    const previousAdapter = axios.defaults.adapter;
    const previousToken = useUserStore.getState().token;
    useUserStore.setState({ token: crypto.randomUUID() });
    axios.defaults.adapter = async (config) => {
        assert.equal(config.url, "/api/v1/model-profiles");
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, data: selectedProfile ? [selectedProfile] : [] } };
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const changes: [string, string][] = [];
    try {
        await act(async () => {
            root.render(
                createElement(VideoSettingsPanel, {
                    config: { ...defaultConfig, model: selectedProfile?.id || profile.id, videoSeconds },
                    theme: canvasThemes.light,
                    allowAutoDuration,
                    onConfigChange: (key, value) => {
                        changes.push([key, value]);
                    },
                }),
            );
        });
        await run(container, changes);
    } finally {
        await act(async () => root.unmount());
        container.remove();
        axios.defaults.adapter = previousAdapter;
        useUserStore.setState({ token: previousToken });
    }
}

test("duration slider honors administrator bounds outside 4–30 seconds", async () => {
    await withPanel(async (container, changes) => {
        const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
        assert.ok(slider, "duration is edited with a slider");
        assert.equal(slider.min, "2");
        assert.equal(slider.max, "60");
        assert.equal(slider.step, "1");
        assert.equal(slider.value, "40");
        assert.equal(slider.getAttribute("aria-label"), i18n.t("videoSettings.duration"));
        assert.equal(container.querySelector('input[type="number"]'), null);
        assert.doesNotMatch(container.textContent || "", /Smart/);
        await act(async () => {
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(slider, "60");
            slider.dispatchEvent(new Event("input", { bubbles: true }));
        });
        assert.deepEqual(changes, [["videoSeconds", "60"]]);
    });
});

test("canvas duration restriction hides auto even when persisted settings request it", async () => {
    await withPanel(
        async (container) => {
            assert.doesNotMatch(container.textContent || "", /Smart/);
            const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
            assert.equal(slider.value, "2");
            assert.doesNotMatch(slider.getAttribute("aria-valuetext") || "", /Smart/);
        },
        { ...profile, capabilities: { ...profile.capabilities, settings: { ...profile.capabilities.settings, durationSeconds: { ...profile.capabilities.settings.durationSeconds, allowAuto: true } } } },
        "-1",
        false,
    );
});

test("video mode is exposed only by an explicit profile capability and defaults to reference", async () => {
    const withModes = { ...profile, capabilities: { ...profile.capabilities, settings: { ...profile.capabilities.settings, videoMode: { type: "enum" as const, values: ["frames", "reference"], default: "reference" } } } };
    await withPanel(async (container, changes) => {
        const frames = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === i18n.t("videoSettings.modes.frames", { defaultValue: "首尾帧" }));
        const reference = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === i18n.t("videoSettings.modes.reference", { defaultValue: "全能参考" }));
        assert.ok(frames);
        assert.ok(reference);
        assert.equal(defaultConfig.videoMode, "reference");
        assert.equal(reference.getAttribute("aria-pressed"), "true");
        await act(async () => frames.click());
        assert.deepEqual(changes, [["videoMode", "frames"]]);
    }, withModes);
    for (const unsupportedProfile of [null, profile, { ...profile, id: "sora-2" }]) {
        await withPanel(async (container) => {
            assert.ok(!Array.from(container.querySelectorAll("button")).some((button) => button.textContent === i18n.t("videoSettings.modes.frames", { defaultValue: "首尾帧" })));
        }, unsupportedProfile);
    }
});

test("auto remains a separate choice and the slider returns to numeric duration", async () => {
    const autoProfile = { ...profile, capabilities: { ...profile.capabilities, settings: { ...profile.capabilities.settings, durationSeconds: { ...profile.capabilities.settings.durationSeconds, allowAuto: true } } } };
    await withPanel(
        async (container, changes) => {
            const auto = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Smart");
            assert.ok(auto);
            assert.equal(auto.getAttribute("aria-pressed"), "true");
            const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
            assert.equal(slider.min, "2");
            assert.equal(slider.value, "2");
            await act(async () => {
                Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(slider, "3");
                slider.dispatchEvent(new Event("input", { bubbles: true }));
                auto.click();
            });
            assert.deepEqual(changes, [
                ["videoSeconds", "3"],
                ["videoSeconds", "-1"],
            ]);
        },
        autoProfile,
        "-1",
    );
});

test("short drama retains its auto duration and administrator bounds", async () => {
    const dramaProfile: GenerationProfile = {
        ...profile,
        intents: ["video.short-drama"],
        capabilities: {
            ...profile.capabilities,
            settings: {
                ...profile.capabilities.settings,
                resolution: { type: "enum", values: ["1080p"], default: "1080p" },
                durationSeconds: { type: "duration", min: 30, max: 180, allowAuto: true, default: "auto" },
                quality: { type: "enum", values: ["standard", "high"], default: "standard" },
            },
        },
    };
    await withPanel(
        async (container) => {
            const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
            assert.equal(slider.min, "30");
            assert.equal(slider.max, "180");
            assert.equal(slider.value, "30");
            assert.equal(slider.getAttribute("aria-valuetext"), "Smart");
            assert.doesNotMatch(container.textContent || "", /首尾帧|全能参考/);
        },
        dramaProfile,
        "-1",
    );
});
