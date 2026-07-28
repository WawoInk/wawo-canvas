import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { canvasThemes } from "@/lib/canvas-theme";
import { defaultConfig } from "@/stores/use-config-store";
import { VideoSettingsPanel } from "./video-settings-panel";

test("canvas video settings hide smart duration without changing the shared default", () => {
    const render = (allowAutoDuration?: boolean) =>
        renderToStaticMarkup(
            createElement(VideoSettingsPanel, {
                config: defaultConfig,
                theme: canvasThemes.light,
                onConfigChange: () => {},
                allowAutoDuration,
            }),
        );

    assert.doesNotMatch(render(false), /智能/);
    assert.match(render(), /智能/);
});
