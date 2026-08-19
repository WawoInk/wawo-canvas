import assert from "node:assert/strict";
import test from "node:test";

import type { ImageRequestFormatSetting, PublicSettings } from "@/services/api/settings";

// @ts-expect-error Bun provides module mocking at test runtime.
import { mock } from "bun:test";

let publicSettings: PublicSettings = {
    modelChannel: {
        availableModels: ["video-allowed", "video-hidden"],
        modelCosts: [],
        defaultModel: "",
        defaultImageModel: "",
        defaultVideoModel: "",
        defaultTextModel: "",
        defaultAudioModel: "",
        imageModels: [],
        videoModels: ["video-allowed"],
        textModels: [],
        audioModels: [],
        imageRequestFormats: [],
        systemPrompt: "",
        allowCustomChannel: false,
    },
    auth: {
        allowRegister: true,
        linuxDo: { enabled: false },
    },
};

mock.module("@/services/api/settings", () => ({
    fetchPublicSettings: async () => publicSettings,
}));

const { defaultConfig, useConfigStore } = await import("./use-config-store");

test("public capability allowlists replace stale persisted selections", async () => {
    useConfigStore.setState({
        config: {
            ...defaultConfig,
            channelMode: "remote",
            model: "",
            videoModel: "video-hidden",
        },
    });

    await useConfigStore.getState().loadPublicSettings();

    assert.deepEqual(useConfigStore.getState().config.videoModels, ["video-allowed"]);
    assert.equal(useConfigStore.getState().config.videoModel, "video-allowed");
});

test("forced remote mode exposes no local models when the admin lists are empty", async () => {
    publicSettings = {
        ...publicSettings,
        modelChannel: {
            ...publicSettings.modelChannel,
            availableModels: [],
            videoModels: [],
        },
    };
    useConfigStore.setState({ config: { ...defaultConfig, channelMode: "local" } });

    await useConfigStore.getState().loadPublicSettings();

    assert.equal(useConfigStore.getState().config.channelMode, "remote");
    assert.deepEqual(useConfigStore.getState().config.models, []);
    assert.deepEqual(useConfigStore.getState().config.videoModels, []);
    assert.equal(useConfigStore.getState().config.videoModel, "");
});

test("public image request resolution propagates to forced remote config", async () => {
    const imageRequestFormats: ImageRequestFormatSetting[] = [{ model: "image-model", format: "default", canvasRequestMode: "split", resolution: "2k" }];
    publicSettings = {
        ...publicSettings,
        modelChannel: {
            ...publicSettings.modelChannel,
            availableModels: ["image-model"],
            imageModels: ["image-model"],
            imageRequestFormats,
            allowCustomChannel: false,
        },
    };
    useConfigStore.setState({ config: { ...defaultConfig, channelMode: "local", imageRequestFormats: [] } });

    await useConfigStore.getState().loadPublicSettings();

    assert.deepEqual(useConfigStore.getState().publicSettings?.modelChannel.imageRequestFormats, imageRequestFormats);
    assert.deepEqual(useConfigStore.getState().config.imageRequestFormats, imageRequestFormats);
});
