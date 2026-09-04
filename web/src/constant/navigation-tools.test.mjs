import assert from "node:assert/strict";
import { test } from "node:test";

import { navigationTools, navigationToolsForUser } from "./navigation-tools.ts";

test("top navigation follows the requested product order", () => {
    assert.deepEqual(
        navigationTools.map((tool) => tool.slug),
        ["canvas", "storyboard", "image", "video", "assets", "volcengine-assets", "prompts"],
    );
});

test("top navigation visibility hides the configured entries", () => {
    assert.deepEqual(
        navigationToolsForUser(null, {
            enabled: true,
            canvas: true,
            storyboard: true,
            image: true,
            video: false,
            assets: true,
            volcengineAssets: false,
            prompts: true,
            storyboardItems: { brainstormAgent: true, storyboard: true, scriptAgent: true },
        }).map((tool) => tool.slug),
        ["canvas", "storyboard", "image", "assets", "prompts"],
    );
});

test("top navigation visibility supports a global off switch", () => {
    assert.deepEqual(navigationToolsForUser(null, { enabled: false }), []);
});
