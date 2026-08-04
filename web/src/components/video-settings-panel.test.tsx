import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { VideoSettingsPanel } from "./video-settings-panel";

test("canvas video settings hide smart duration without changing the shared default", async () => {
    await i18n.changeLanguage("en-US");
    const render = (allowAutoDuration?: boolean) =>
        renderToStaticMarkup(
            createElement(VideoSettingsPanel, {
                config: defaultConfig,
                theme: canvasThemes.light,
                onConfigChange: () => {},
                allowAutoDuration,
            }),
        );

    assert.doesNotMatch(render(false), /Smart/);
    assert.match(render(), /Smart/);
});
